#!/usr/bin/env bash
# One-time (and safe to re-run) setup for turtlebox.studio app downloads, in us-east-2.
# Creates: private S3 bucket for apps, SES identity for turtlebox.studio (DKIM, MAIL FROM, DMARC),
# the downloads Lambda + function URL, and a CloudFront /api/* route on turtlebox.studio.
# Existing records in the turtlebox.studio zone are not changed.
set -euo pipefail

DOMAIN=turtlebox.studio
MAILFROM=bounce.$DOMAIN
REGION=us-east-2
ZONE_ID=Z10129731J68Q270CHC29
DIST_ID=E3AFT58QXC1DZ0
BUCKET=turtlebox-downloads
FN=turtlebox-downloads
FN_ROLE=turtlebox-downloads-lambda
SUB_FN=highturtle-subscribe
TABLE=highturtle-pending
LIST=highturtle-subscribers
CONFIG_SET=highturtle
FROM_ADDR="Turtlebox <downloads@$DOMAIN>"
REPLY_TO="hello@highturtle.com"
DEPLOY_ROLE=turtlebox-github-deploy
export AWS_DEFAULT_REGION=$REGION

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
r53() { aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$1" >/dev/null; }

echo "== 1. Private bucket for apps =="
aws s3api head-bucket --bucket $BUCKET 2>/dev/null || aws s3api create-bucket --bucket $BUCKET --region $REGION \
  --create-bucket-configuration LocationConstraint=$REGION
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $BUCKET \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

echo "== 2. SES identity for $DOMAIN =="
aws sesv2 get-email-identity --email-identity $DOMAIN >/dev/null 2>&1 || aws sesv2 create-email-identity --email-identity $DOMAIN >/dev/null
TOKENS=$(aws sesv2 get-email-identity --email-identity $DOMAIN --query 'DkimAttributes.Tokens' --output json)
jq -n --argjson t "$TOKENS" --arg d $DOMAIN '{Changes: ($t | map({Action:"UPSERT", ResourceRecordSet:{Name:(.+"._domainkey."+$d), Type:"CNAME", TTL:300, ResourceRecords:[{Value:(.+".dkim.amazonses.com")}]}}))}' > /tmp/dkim.json
r53 file:///tmp/dkim.json
aws sesv2 put-email-identity-mail-from-attributes --email-identity $DOMAIN --mail-from-domain $MAILFROM --behavior-on-mx-failure USE_DEFAULT_VALUE
cat > /tmp/mailfrom.json <<JSON
{"Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$MAILFROM","Type":"MX","TTL":300,"ResourceRecords":[{"Value":"10 feedback-smtp.$REGION.amazonses.com"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$MAILFROM","Type":"TXT","TTL":300,"ResourceRecords":[{"Value":"\"v=spf1 include:amazonses.com ~all\""}]}}
]}
JSON
r53 file:///tmp/mailfrom.json
HAS_DMARC=$(aws route53 list-resource-record-sets --hosted-zone-id $ZONE_ID --query "ResourceRecordSets[?Name=='_dmarc.$DOMAIN.'] | length(@)" --output text)
if [ "$HAS_DMARC" = "0" ]; then
  cat > /tmp/dmarc.json <<JSON
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"_dmarc.$DOMAIN","Type":"TXT","TTL":300,"ResourceRecords":[{"Value":"\"v=DMARC1; p=none; rua=mailto:howardcrow@gmail.com\""}]}}]}
JSON
  r53 file:///tmp/dmarc.json
fi

echo "== 3. Lambda role =="
cat > /tmp/lambda-trust.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
aws iam get-role --role-name $FN_ROLE >/dev/null 2>&1 || {
  aws iam create-role --role-name $FN_ROLE --assume-role-policy-document file:///tmp/lambda-trust.json >/dev/null
  sleep 12
}
aws iam attach-role-policy --role-name $FN_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
cat > /tmp/lambda-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:PutItem","dynamodb:GetItem","dynamodb:DeleteItem"],"Resource":"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE"},
 {"Effect":"Allow","Action":["ses:SendEmail"],"Resource":["arn:aws:ses:$REGION:$ACCOUNT:identity/*","arn:aws:ses:$REGION:$ACCOUNT:configuration-set/$CONFIG_SET"]},
 {"Effect":"Allow","Action":["ses:CreateContact"],"Resource":"arn:aws:ses:$REGION:$ACCOUNT:contact-list/$LIST"},
 {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::$BUCKET/*"},
 {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::$BUCKET"}
]}
JSON
aws iam put-role-policy --role-name $FN_ROLE --policy-name downloads --policy-document file:///tmp/lambda-policy.json
FN_ROLE_ARN=$(aws iam get-role --role-name $FN_ROLE --query Role.Arn --output text)

echo "== 4. Lambda function =="
rm -f /tmp/downloads.zip
(cd lambda && zip -q /tmp/downloads.zip downloads.py)
SECRET=$(aws lambda get-function-configuration --function-name $SUB_FN --query 'Environment.Variables.SECRET' --output text)
ENVJSON=$(jq -nc --arg s "$SECRET" --arg t $TABLE --arg l $LIST --arg f "$FROM_ADDR" --arg c $CONFIG_SET --arg b $BUCKET --arg r "$REPLY_TO" \
  '{Variables:{SECRET:$s,TABLE:$t,CONTACT_LIST:$l,FROM_ADDR:$f,CONFIG_SET:$c,BUCKET:$b,REPLY_TO:$r,SITE:"https://turtlebox.studio",LIST_SITE:"https://highturtle.com"}}')
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb:///tmp/downloads.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVJSON" --timeout 10 >/dev/null
else
  for i in 1 2 3 4 5 6; do
    aws lambda create-function --function-name $FN --runtime python3.12 --handler downloads.lambda_handler \
      --role "$FN_ROLE_ARN" --zip-file fileb:///tmp/downloads.zip --timeout 10 --memory-size 128 \
      --environment "$ENVJSON" >/dev/null 2>/tmp/err.txt && break
    cat /tmp/err.txt; sleep 10
  done
fi
aws lambda wait function-active --function-name $FN

echo "== 5. Function URL =="
URL=$(aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text 2>/dev/null || true)
if [ -z "$URL" ] || [ "$URL" = "None" ]; then
  URL=$(aws lambda create-function-url-config --function-name $FN --auth-type NONE --query FunctionUrl --output text)
fi
aws lambda add-permission --function-name $FN --statement-id url-invoke --action lambda:InvokeFunctionUrl \
  --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name $FN --statement-id url-invoke-fn --action lambda:InvokeFunction \
  --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
URL_HOST=$(echo "$URL" | sed -E 's#https://([^/]+)/?#\1#')

echo "== 6. CloudFront: route /api/* on $DOMAIN =="
CP=$(aws cloudfront list-cache-policies --type managed --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingDisabled'].CachePolicy.Id | [0]" --output text)
ORP=$(aws cloudfront list-origin-request-policies --type managed --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='Managed-AllViewerExceptHostHeader'].OriginRequestPolicy.Id | [0]" --output text)
aws cloudfront get-distribution-config --id $DIST_ID > /tmp/cf.json
ETAG=$(jq -r .ETag /tmp/cf.json)
jq --arg dom "$URL_HOST" --arg cp "$CP" --arg orp "$ORP" '
  .DistributionConfig
  | .Origins.Items = ((.Origins.Items | map(select(.Id != "api-lambda"))) + [{
      Id:"api-lambda", DomainName:$dom, OriginPath:"", CustomHeaders:{Quantity:0},
      CustomOriginConfig:{HTTPPort:80, HTTPSPort:443, OriginProtocolPolicy:"https-only",
        OriginSslProtocols:{Quantity:1, Items:["TLSv1.2"]}, OriginReadTimeout:30, OriginKeepaliveTimeout:5}}])
  | .Origins.Quantity = (.Origins.Items | length)
  | .CacheBehaviors.Items = (((.CacheBehaviors.Items // []) | map(select(.PathPattern != "/api/*"))) + [(.DefaultCacheBehavior + {
      PathPattern:"/api/*", TargetOriginId:"api-lambda", ViewerProtocolPolicy:"redirect-to-https", Compress:true, SmoothStreaming:false,
      AllowedMethods:{Quantity:7, Items:["GET","HEAD","OPTIONS","PUT","PATCH","POST","DELETE"], CachedMethods:{Quantity:2, Items:["GET","HEAD"]}},
      CachePolicyId:$cp, OriginRequestPolicyId:$orp, FunctionAssociations:{Quantity:0}})])
  | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)' /tmp/cf.json > /tmp/cf-new.json
aws cloudfront update-distribution --id $DIST_ID --if-match "$ETAG" --distribution-config file:///tmp/cf-new.json >/dev/null

echo "== 7. Deploy role may update the function =="
cat > /tmp/deploy-lambda.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode","lambda:GetFunction"],"Resource":"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"}]}
JSON
aws iam put-role-policy --role-name $DEPLOY_ROLE --policy-name deploy-lambda --policy-document file:///tmp/deploy-lambda.json

echo "== 8. Wait for CloudFront =="
aws cloudfront wait distribution-deployed --id $DIST_ID
echo "::notice title=result::URL=$URL"
