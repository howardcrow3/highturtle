#!/usr/bin/env bash
# One-time (and safe to re-run) setup for the email list, in us-east-2.
# Creates: SES identity settings (custom MAIL FROM, DKIM records), contact list, configuration set,
# DynamoDB table for pending signups, the subscription Lambda + function URL, a CloudFront /api/* route,
# and IAM roles for deploying the Lambda and for sending issues from GitHub Actions.
# The apex MX, SPF, DMARC and the existing DKIM records are never changed.
set -euo pipefail

DOMAIN=highturtle.com
MAILFROM=bounce.$DOMAIN
REGION=us-east-2
ZONE_ID=Z06718022U4OGOJU3B5U4
REPO=howardcrow3/highturtle
DIST_ID=E3GVOW0DH898BT
FN=highturtle-subscribe
FN_ROLE=highturtle-subscribe-lambda
SEND_ROLE=highturtle-github-send
DEPLOY_ROLE=highturtle-github-deploy
TABLE=highturtle-pending
LIST=highturtle-subscribers
CONFIG_SET=highturtle
FROM_ADDR="High Turtle <hello@$DOMAIN>"
export AWS_DEFAULT_REGION=$REGION

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
note() { echo "::notice title=$1::$2"; }
r53() { aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch "$1" >/dev/null; }

echo "== 1. SES identity: DKIM records and custom MAIL FROM =="
aws sesv2 get-email-identity --email-identity $DOMAIN >/dev/null 2>&1 || aws sesv2 create-email-identity --email-identity $DOMAIN >/dev/null
TOKENS=$(aws sesv2 get-email-identity --email-identity $DOMAIN --query 'DkimAttributes.Tokens' --output json)
jq -n --argjson t "$TOKENS" --arg d $DOMAIN '{Changes: ($t | map({Action:"UPSERT", ResourceRecordSet:{Name:(.+"._domainkey."+$d), Type:"CNAME", TTL:300, ResourceRecords:[{Value:(.+".dkim.amazonses.com")}]}}))}' > /tmp/dkim.json
r53 file:///tmp/dkim.json
aws sesv2 put-email-identity-mail-from-attributes --email-identity $DOMAIN \
  --mail-from-domain $MAILFROM --behavior-on-mx-failure USE_DEFAULT_VALUE
cat > /tmp/mailfrom.json <<JSON
{"Changes":[
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$MAILFROM","Type":"MX","TTL":300,"ResourceRecords":[{"Value":"10 feedback-smtp.$REGION.amazonses.com"}]}},
 {"Action":"UPSERT","ResourceRecordSet":{"Name":"$MAILFROM","Type":"TXT","TTL":300,"ResourceRecords":[{"Value":"\"v=spf1 include:amazonses.com ~all\""}]}}
]}
JSON
r53 file:///tmp/mailfrom.json

echo "== 2. SES: suppression list, configuration set, contact list =="
aws sesv2 put-account-suppression-attributes --suppressed-reasons BOUNCE COMPLAINT
aws sesv2 get-configuration-set --configuration-set-name $CONFIG_SET >/dev/null 2>&1 ||
  aws sesv2 create-configuration-set --configuration-set-name $CONFIG_SET \
    --reputation-options ReputationMetricsEnabled=true --sending-options SendingEnabled=true
aws sesv2 get-contact-list --contact-list-name $LIST >/dev/null 2>&1 ||
  aws sesv2 create-contact-list --contact-list-name $LIST --description "High Turtle subscribers"

echo "== 3. DynamoDB table for pending signups =="
if ! aws dynamodb describe-table --table-name $TABLE >/dev/null 2>&1; then
  aws dynamodb create-table --table-name $TABLE --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH >/dev/null
  aws dynamodb wait table-exists --table-name $TABLE
fi
aws dynamodb update-time-to-live --table-name $TABLE --time-to-live-specification Enabled=true,AttributeName=ttl >/dev/null 2>&1 || true

echo "== 4. Lambda role =="
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
 {"Effect":"Allow","Action":["ses:SendEmail"],"Resource":["arn:aws:ses:$REGION:$ACCOUNT:identity/$DOMAIN","arn:aws:ses:$REGION:$ACCOUNT:configuration-set/$CONFIG_SET"]},
 {"Effect":"Allow","Action":["ses:GetContact","ses:CreateContact","ses:UpdateContact"],"Resource":"arn:aws:ses:$REGION:$ACCOUNT:contact-list/$LIST"}
]}
JSON
aws iam put-role-policy --role-name $FN_ROLE --policy-name subscribe --policy-document file:///tmp/lambda-policy.json
FN_ROLE_ARN=$(aws iam get-role --role-name $FN_ROLE --query Role.Arn --output text)

echo "== 5. Lambda function =="
rm -f /tmp/lambda.zip
(cd lambda && zip -q /tmp/lambda.zip handler.py)
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  SECRET=$(aws lambda get-function-configuration --function-name $FN --query 'Environment.Variables.SECRET' --output text)
else
  SECRET=$(openssl rand -hex 32)
fi
ENVJSON=$(jq -nc --arg s "$SECRET" --arg t $TABLE --arg l $LIST --arg f "$FROM_ADDR" --arg c $CONFIG_SET \
  '{Variables:{SECRET:$s,TABLE:$t,CONTACT_LIST:$l,FROM_ADDR:$f,CONFIG_SET:$c,SITE:"https://highturtle.com"}}')
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb:///tmp/lambda.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVJSON" --timeout 10 >/dev/null
else
  for i in 1 2 3 4 5 6; do
    aws lambda create-function --function-name $FN --runtime python3.12 --handler handler.lambda_handler \
      --role "$FN_ROLE_ARN" --zip-file fileb:///tmp/lambda.zip --timeout 10 --memory-size 128 \
      --environment "$ENVJSON" >/dev/null 2>/tmp/err.txt && break
    cat /tmp/err.txt; sleep 10
  done
fi
aws lambda wait function-active --function-name $FN
aws lambda put-function-concurrency --function-name $FN --reserved-concurrent-executions 5 >/dev/null 2>&1 ||
  echo "reserved concurrency not available on this account yet; skipping"

echo "== 6. Function URL =="
URL=$(aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text 2>/dev/null || true)
if [ -z "$URL" ] || [ "$URL" = "None" ]; then
  URL=$(aws lambda create-function-url-config --function-name $FN --auth-type NONE --query FunctionUrl --output text)
fi
aws lambda add-permission --function-name $FN --statement-id url-invoke --action lambda:InvokeFunctionUrl \
  --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name $FN --statement-id url-invoke-fn --action lambda:InvokeFunction \
  --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
URL_HOST=$(echo "$URL" | sed -E 's#https://([^/]+)/?#\1#')
echo "function url host: $URL_HOST"

echo "== 7. CloudFront: route /api/* to the function =="
CP=$(aws cloudfront list-cache-policies --type managed --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingDisabled'].CachePolicy.Id | [0]" --output text)
ORP=$(aws cloudfront list-origin-request-policies --type managed --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='Managed-AllViewerExceptHostHeader'].OriginRequestPolicy.Id | [0]" --output text)
echo "cache policy $CP, origin request policy $ORP"
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
      CachePolicyId:$cp, OriginRequestPolicyId:$orp})])
  | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)' /tmp/cf.json > /tmp/cf-new.json
aws cloudfront update-distribution --id $DIST_ID --if-match "$ETAG" --distribution-config file:///tmp/cf-new.json >/dev/null

echo "== 8. IAM: deploy role may update the Lambda; send role for GitHub Actions =="
cat > /tmp/deploy-lambda.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode","lambda:GetFunction"],"Resource":"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"}]}
JSON
aws iam put-role-policy --role-name $DEPLOY_ROLE --policy-name deploy-lambda --policy-document file:///tmp/deploy-lambda.json
OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
cat > /tmp/send-trust.json <<JSON
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow","Principal":{"Federated":"$OIDC_ARN"},"Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{"StringEquals":{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
  "token.actions.githubusercontent.com:sub":"repo:$REPO:ref:refs/heads/main"}}}]}
JSON
if aws iam get-role --role-name $SEND_ROLE >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name $SEND_ROLE --policy-document file:///tmp/send-trust.json
else
  aws iam create-role --role-name $SEND_ROLE --assume-role-policy-document file:///tmp/send-trust.json >/dev/null
fi
cat > /tmp/send-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["ses:SendEmail"],"Resource":["arn:aws:ses:$REGION:$ACCOUNT:identity/*","arn:aws:ses:$REGION:$ACCOUNT:configuration-set/$CONFIG_SET"]},
 {"Effect":"Allow","Action":["ses:ListContacts","ses:GetContact"],"Resource":"arn:aws:ses:$REGION:$ACCOUNT:contact-list/$LIST"},
 {"Effect":"Allow","Action":["ses:GetAccount"],"Resource":"*"},
 {"Effect":"Allow","Action":["lambda:GetFunctionConfiguration"],"Resource":"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"}
]}
JSON
aws iam put-role-policy --role-name $SEND_ROLE --policy-name send-issues --policy-document file:///tmp/send-policy.json

echo "== 9. Wait for CloudFront =="
aws cloudfront wait distribution-deployed --id $DIST_ID

note "result" "URL=$URL SEND_ROLE_ARN=arn:aws:iam::$ACCOUNT:role/$SEND_ROLE"
