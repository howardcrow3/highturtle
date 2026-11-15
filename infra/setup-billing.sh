#!/usr/bin/env bash
# One-time (safe to re-run) setup for Turtlebox billing: Paddle webhooks, the subscription mirror and the
# customer portal (billing/). Region us-east-2.
# Creates, only if missing:
#   - DynamoDB tables highturtle-billing-customers / -subscriptions / -transactions, with deletion
#     protection and point-in-time recovery on (they mirror live billing state)
#   - Secrets Manager secret highturtle/billing holding PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, SESSION_SECRET
#   - Lambda role, the turtlebox-billing function (Node 22) + function URL
#   - CloudFront route /api/billing/* on turtlebox.studio, placed BEFORE /api/*
# Secret values come from the PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET environment variables (GitHub
# secrets in the workflow). An empty value keeps whatever the secret already holds. SESSION_SECRET is
# generated once and kept. This script never deletes anything.
set -euo pipefail
REGION=us-east-2
DIST_ID=E3AFT58QXC1DZ0
FN=turtlebox-billing
FN_ROLE=turtlebox-billing-lambda
SECRET_ID=highturtle/billing
T_CUST=highturtle-billing-customers
T_SUBS=highturtle-billing-subscriptions
T_TXN=highturtle-billing-transactions
CONFIG_SET=highturtle
DEPLOY_ROLE=turtlebox-github-deploy
export AWS_DEFAULT_REGION=$REGION
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "== 1. Tables =="
make_table() { # name key [gsi-name gsi-key]
  local name=$1 key=$2 gname=${3:-} gkey=${4:-}
  if ! aws dynamodb describe-table --table-name "$name" >/dev/null 2>&1; then
    local attrs="AttributeName=$key,AttributeType=S" gsi=()
    if [ -n "$gname" ]; then
      attrs="$attrs AttributeName=$gkey,AttributeType=S"
      gsi=(--global-secondary-indexes "IndexName=$gname,KeySchema=[{AttributeName=$gkey,KeyType=HASH}],Projection={ProjectionType=ALL}")
    fi
    # shellcheck disable=SC2086
    aws dynamodb create-table --table-name "$name" --billing-mode PAY_PER_REQUEST \
      --attribute-definitions $attrs --key-schema AttributeName=$key,KeyType=HASH "${gsi[@]}" \
      --deletion-protection-enabled >/dev/null
    aws dynamodb wait table-exists --table-name "$name"
  fi
  aws dynamodb update-continuous-backups --table-name "$name" \
    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true >/dev/null
}
make_table $T_CUST customer_id email-index email_lc
make_table $T_SUBS subscription_id customer-index customer_id
make_table $T_TXN transaction_id

echo "== 2. Secret =="
CURRENT='{}'; EXISTS=no
if aws secretsmanager describe-secret --secret-id $SECRET_ID >/dev/null 2>&1; then
  EXISTS=yes
  # Must succeed: never overwrite a stored secret with a partial one.
  CURRENT=$(aws secretsmanager get-secret-value --secret-id $SECRET_ID --query SecretString --output text)
fi
SESSION=$(echo "$CURRENT" | jq -r '.SESSION_SECRET // empty')
[ -z "$SESSION" ] && SESSION=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
NEW=$(echo "$CURRENT" | jq -c --arg a "${PADDLE_API_KEY:-}" --arg w "${PADDLE_WEBHOOK_SECRET:-}" --arg s "$SESSION" '
  . + {SESSION_SECRET:$s}
    + (if $a != "" then {PADDLE_API_KEY:$a} else {} end)
    + (if $w != "" then {PADDLE_WEBHOOK_SECRET:$w} else {} end)')
# Take the ARN from the write itself: a describe right after create can miss the new secret.
if [ "$EXISTS" = no ]; then
  SECRET_ARN=$(aws secretsmanager create-secret --name $SECRET_ID --secret-string "$NEW" --query ARN --output text)
else
  SECRET_ARN=$(aws secretsmanager put-secret-value --secret-id $SECRET_ID --secret-string "$NEW" --query ARN --output text)
fi
echo "secret keys present: $(echo "$NEW" | jq -r 'to_entries | map(select(.value != "") | .key) | join(", ")')"

echo "== 3. Lambda role =="
cat > /tmp/lambda-trust.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
aws iam get-role --role-name $FN_ROLE >/dev/null 2>&1 || { aws iam create-role --role-name $FN_ROLE --assume-role-policy-document file:///tmp/lambda-trust.json >/dev/null; sleep 12; }
aws iam attach-role-policy --role-name $FN_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
T="arn:aws:dynamodb:$REGION:$ACCOUNT:table"
cat > /tmp/lambda-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:UpdateItem","dynamodb:GetItem","dynamodb:Query"],
  "Resource":["$T/$T_CUST","$T/$T_CUST/index/*","$T/$T_SUBS","$T/$T_SUBS/index/*","$T/$T_TXN"]},
 {"Effect":"Allow","Action":["secretsmanager:GetSecretValue"],"Resource":"$SECRET_ARN"},
 {"Effect":"Allow","Action":["ses:SendEmail"],"Resource":["arn:aws:ses:$REGION:$ACCOUNT:identity/*","arn:aws:ses:$REGION:$ACCOUNT:configuration-set/$CONFIG_SET"]}
]}
JSON
aws iam put-role-policy --role-name $FN_ROLE --policy-name billing --policy-document file:///tmp/lambda-policy.json
ROLE_ARN=$(aws iam get-role --role-name $FN_ROLE --query Role.Arn --output text)

echo "== 4. Lambda function =="
(cd billing && npm ci --no-audit --no-fund >/dev/null && npm test >/dev/null && npm run build >/dev/null)
rm -f /tmp/billing.zip; (cd billing/dist && zip -q /tmp/billing.zip index.mjs)
ENVJSON=$(jq -nc --arg s "$SECRET_ARN" --arg c $CONFIG_SET --arg a $T_CUST --arg b $T_SUBS --arg t $T_TXN '{Variables:{
  BILLING_SECRET_ID:$s, PADDLE_ENVIRONMENT:"production", SITE:"https://turtlebox.studio",
  FROM_ADDR:"Turtlebox <account@turtlebox.studio>", REPLY_TO:"info@turtlebox.studio", CONFIG_SET:$c,
  CUSTOMERS_TABLE:$a, SUBSCRIPTIONS_TABLE:$b, TRANSACTIONS_TABLE:$t, ACCESS_PAST_DUE:"grant"}}')
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb:///tmp/billing.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVJSON" --timeout 15 >/dev/null
else
  for i in 1 2 3 4 5 6; do
    aws lambda create-function --function-name $FN --runtime nodejs22.x --handler index.handler --role "$ROLE_ARN" \
      --zip-file fileb:///tmp/billing.zip --timeout 15 --memory-size 256 --environment "$ENVJSON" >/dev/null 2>/tmp/err.txt && break
    cat /tmp/err.txt; sleep 10
  done
fi
aws lambda wait function-active --function-name $FN

echo "== 5. Function URL =="
URL=$(aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text 2>/dev/null || true)
if [ -z "$URL" ] || [ "$URL" = "None" ]; then URL=$(aws lambda create-function-url-config --function-name $FN --auth-type NONE --query FunctionUrl --output text); fi
aws lambda add-permission --function-name $FN --statement-id url-invoke --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name $FN --statement-id url-invoke-fn --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
URL_HOST=$(echo "$URL" | sed -E 's#https://([^/]+)/?#\1#')

echo "== 6. CloudFront: /api/billing/* before /api/* =="
CP=$(aws cloudfront list-cache-policies --type managed --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingDisabled'].CachePolicy.Id | [0]" --output text)
ORP=$(aws cloudfront list-origin-request-policies --type managed --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='Managed-AllViewerExceptHostHeader'].OriginRequestPolicy.Id | [0]" --output text)
aws cloudfront get-distribution-config --id $DIST_ID > /tmp/cf.json
ETAG=$(jq -r .ETag /tmp/cf.json)
jq --arg dom "$URL_HOST" --arg cp "$CP" --arg orp "$ORP" '
  .DistributionConfig
  | .Origins.Items = ((.Origins.Items | map(select(.Id != "billing-lambda"))) + [{
      Id:"billing-lambda", DomainName:$dom, OriginPath:"", CustomHeaders:{Quantity:0},
      CustomOriginConfig:{HTTPPort:80, HTTPSPort:443, OriginProtocolPolicy:"https-only",
        OriginSslProtocols:{Quantity:1, Items:["TLSv1.2"]}, OriginReadTimeout:30, OriginKeepaliveTimeout:5}}])
  | .Origins.Quantity = (.Origins.Items | length)
  | .CacheBehaviors.Items = ([(.DefaultCacheBehavior + {
      PathPattern:"/api/billing/*", TargetOriginId:"billing-lambda", ViewerProtocolPolicy:"redirect-to-https", Compress:true, SmoothStreaming:false,
      AllowedMethods:{Quantity:7, Items:["GET","HEAD","OPTIONS","PUT","PATCH","POST","DELETE"], CachedMethods:{Quantity:2, Items:["GET","HEAD"]}},
      CachePolicyId:$cp, OriginRequestPolicyId:$orp, FunctionAssociations:{Quantity:0}})]
      + ((.CacheBehaviors.Items // []) | map(select(.PathPattern != "/api/billing/*"))))
  | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)' /tmp/cf.json > /tmp/cf-new.json
aws cloudfront update-distribution --id $DIST_ID --if-match "$ETAG" --distribution-config file:///tmp/cf-new.json >/dev/null

echo "== 7. Deploy role may update the function =="
cat > /tmp/deploy-billing.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode","lambda:GetFunction"],"Resource":"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"}]}
JSON
aws iam put-role-policy --role-name $DEPLOY_ROLE --policy-name deploy-billing --policy-document file:///tmp/deploy-billing.json

echo "== 8. Wait for CloudFront =="
aws cloudfront wait distribution-deployed --id $DIST_ID
echo "::notice title=result::Webhook URL for Paddle: https://turtlebox.studio/api/billing/webhook"
