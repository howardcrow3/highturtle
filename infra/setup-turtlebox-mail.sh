#!/usr/bin/env bash
# One-time (and safe to re-run) setup so info@turtlebox.studio receives mail, in us-east-2.
# SES inbound -> private S3 bucket (kept 30 days) -> forwarder Lambda -> FORWARD_TO inbox.
# Adds an MX record on the turtlebox.studio apex. Refuses to run if the apex already has
# an MX record pointing somewhere else, so an existing mail host is never replaced.
set -euo pipefail

DOMAIN=turtlebox.studio
ADDRESS=info@$DOMAIN
FORWARD_TO=howardcrow@gmail.com
REGION=us-east-2
ZONE_ID=Z10129731J68Q270CHC29
FN=turtlebox-mail-forward
FN_ROLE=turtlebox-mail-forward-lambda
RULE_SET_DEFAULT=turtlebox-inbound
RULE=turtlebox-info
MX_VALUE="10 inbound-smtp.$REGION.amazonaws.com"
export AWS_DEFAULT_REGION=$REGION

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=turtlebox-inbound-mail-$ACCOUNT
note() { echo "::notice title=$1::$2"; }

echo "== 0. Existing apex MX check =="
EXISTING_MX=$(aws route53 list-resource-record-sets --hosted-zone-id $ZONE_ID \
  --query "ResourceRecordSets[?Name=='$DOMAIN.' && Type=='MX'].ResourceRecords[].Value" --output text)
if [ -n "$EXISTING_MX" ] && [ "$EXISTING_MX" != "$MX_VALUE" ]; then
  note "stopped" "$DOMAIN already has MX '$EXISTING_MX'. Not replacing it."
  exit 1
fi

echo "== 1. Private bucket for incoming mail =="
aws s3api head-bucket --bucket $BUCKET 2>/dev/null || aws s3api create-bucket --bucket $BUCKET --region $REGION \
  --create-bucket-configuration LocationConstraint=$REGION
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $BUCKET \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-lifecycle-configuration --bucket $BUCKET --lifecycle-configuration \
  '{"Rules":[{"ID":"expire-30d","Status":"Enabled","Filter":{"Prefix":"incoming/"},"Expiration":{"Days":30}}]}'
cat > /tmp/mail-bucket-policy.json <<JSON
{"Version":"2012-10-17","Statement":[{"Sid":"AllowSESPuts","Effect":"Allow",
 "Principal":{"Service":"ses.amazonaws.com"},"Action":"s3:PutObject","Resource":"arn:aws:s3:::$BUCKET/incoming/*",
 "Condition":{"StringEquals":{"AWS:SourceAccount":"$ACCOUNT"}}}]}
JSON
aws s3api put-bucket-policy --bucket $BUCKET --policy file:///tmp/mail-bucket-policy.json

echo "== 2. Lambda role =="
cat > /tmp/lambda-trust.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
aws iam get-role --role-name $FN_ROLE >/dev/null 2>&1 || {
  aws iam create-role --role-name $FN_ROLE --assume-role-policy-document file:///tmp/lambda-trust.json >/dev/null
  sleep 12
}
aws iam attach-role-policy --role-name $FN_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
cat > /tmp/fwd-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::$BUCKET/incoming/*"},
 {"Effect":"Allow","Action":["ses:SendEmail","ses:SendRawEmail"],"Resource":"arn:aws:ses:$REGION:$ACCOUNT:identity/*"}
]}
JSON
aws iam put-role-policy --role-name $FN_ROLE --policy-name forward --policy-document file:///tmp/fwd-policy.json
FN_ROLE_ARN=$(aws iam get-role --role-name $FN_ROLE --query Role.Arn --output text)

echo "== 3. Forwarder function =="
rm -f /tmp/forward.zip
(cd lambda && zip -q /tmp/forward.zip mail_forward.py)
ENVJSON=$(jq -nc --arg b $BUCKET --arg t "$FORWARD_TO" --arg f "$ADDRESS" \
  '{Variables:{BUCKET:$b,PREFIX:"incoming/",FORWARD_TO:$t,FROM_ADDR:$f,BRAND:"Turtlebox"}}')
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb:///tmp/forward.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVJSON" --timeout 30 --memory-size 256 >/dev/null
else
  for i in 1 2 3 4 5 6; do
    aws lambda create-function --function-name $FN --runtime python3.12 --handler mail_forward.lambda_handler \
      --role "$FN_ROLE_ARN" --zip-file fileb:///tmp/forward.zip --timeout 30 --memory-size 256 \
      --environment "$ENVJSON" >/dev/null 2>/tmp/err.txt && break
    cat /tmp/err.txt; sleep 10
  done
fi
aws lambda wait function-active --function-name $FN
FN_ARN=$(aws lambda get-function --function-name $FN --query Configuration.FunctionArn --output text)
aws lambda add-permission --function-name $FN --statement-id ses-invoke --action lambda:InvokeFunction \
  --principal ses.amazonaws.com --source-account $ACCOUNT >/dev/null 2>&1 || true

echo "== 4. SES receipt rule =="
RULE_SET=$(aws ses describe-active-receipt-rule-set --query Metadata.Name --output text 2>/dev/null || true)
if [ -z "$RULE_SET" ] || [ "$RULE_SET" = "None" ]; then
  RULE_SET=$RULE_SET_DEFAULT
  aws ses create-receipt-rule-set --rule-set-name $RULE_SET 2>/dev/null || true
  aws ses set-active-receipt-rule-set --rule-set-name $RULE_SET
fi
cat > /tmp/rule.json <<JSON
{"Name":"$RULE","Enabled":true,"TlsPolicy":"Optional","ScanEnabled":true,"Recipients":["$ADDRESS"],
 "Actions":[
  {"S3Action":{"BucketName":"$BUCKET","ObjectKeyPrefix":"incoming/"}},
  {"LambdaAction":{"FunctionArn":"$FN_ARN","InvocationType":"Event"}}
 ]}
JSON
if aws ses describe-receipt-rule --rule-set-name $RULE_SET --rule-name $RULE >/dev/null 2>&1; then
  aws ses update-receipt-rule --rule-set-name $RULE_SET --rule file:///tmp/rule.json
else
  aws ses create-receipt-rule --rule-set-name $RULE_SET --rule file:///tmp/rule.json
fi

echo "== 5. MX record on $DOMAIN =="
cat > /tmp/mx.json <<JSON
{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"$DOMAIN","Type":"MX","TTL":300,"ResourceRecords":[{"Value":"$MX_VALUE"}]}}]}
JSON
aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID --change-batch file:///tmp/mx.json >/dev/null

note "result" "rule set=$RULE_SET bucket=$BUCKET function=$FN"
