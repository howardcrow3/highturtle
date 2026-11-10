#!/usr/bin/env bash
# One-time (safe to re-run) setup for the Backer "Report an issue" endpoint on turtlebox.studio.
# Creates: DynamoDB rate-limit table, Lambda role, backer-report function + URL, and a CloudFront
# route /api/report (placed BEFORE /api/*). The GitHub token is NOT handled here: you store it yourself
# (see REPORT.md). Until it exists the endpoint answers 502 and nothing is created on GitHub.
set -euo pipefail
REGION=us-east-2
DIST_ID=E3AFT58QXC1DZ0
FN=backer-report
FN_ROLE=backer-report-lambda
TABLE=backer-report-limits
DEPLOY_ROLE=turtlebox-github-deploy
REPO="${REPORT_REPO:?set REPORT_REPO to owner/name of the private issues repo}"
TOKEN_PARAM=/backer/github-issues-token
export AWS_DEFAULT_REGION=$REGION
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

echo "== 1. Rate-limit table =="
aws dynamodb describe-table --table-name $TABLE >/dev/null 2>&1 || {
  aws dynamodb create-table --table-name $TABLE --billing-mode PAY_PER_REQUEST \
    --attribute-definitions AttributeName=pk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH >/dev/null
  aws dynamodb wait table-exists --table-name $TABLE
  aws dynamodb update-time-to-live --table-name $TABLE --time-to-live-specification Enabled=true,AttributeName=ttl >/dev/null
}

echo "== 2. Lambda role =="
cat > /tmp/lambda-trust.json <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
aws iam get-role --role-name $FN_ROLE >/dev/null 2>&1 || { aws iam create-role --role-name $FN_ROLE --assume-role-policy-document file:///tmp/lambda-trust.json >/dev/null; sleep 12; }
aws iam attach-role-policy --role-name $FN_ROLE --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
cat > /tmp/lambda-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:UpdateItem"],"Resource":"arn:aws:dynamodb:$REGION:$ACCOUNT:table/$TABLE"},
 {"Effect":"Allow","Action":["ssm:GetParameter"],"Resource":"arn:aws:ssm:$REGION:$ACCOUNT:parameter$TOKEN_PARAM"}
]}
JSON
aws iam put-role-policy --role-name $FN_ROLE --policy-name report --policy-document file:///tmp/lambda-policy.json
ROLE_ARN=$(aws iam get-role --role-name $FN_ROLE --query Role.Arn --output text)

echo "== 3. Lambda function =="
rm -f /tmp/report.zip; (cd lambda && zip -q /tmp/report.zip report.py)
SALT=$(aws lambda get-function-configuration --function-name $FN --query 'Environment.Variables.SALT' --output text 2>/dev/null || true)
{ [ -z "$SALT" ] || [ "$SALT" = "None" ]; } && SALT=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
ENVJSON=$(jq -nc --arg r "$REPO" --arg p $TOKEN_PARAM --arg t $TABLE --arg s "$SALT" '{Variables:{REPO:$r,TOKEN_PARAM:$p,TABLE:$t,SALT:$s}}')
if aws lambda get-function --function-name $FN >/dev/null 2>&1; then
  aws lambda update-function-code --function-name $FN --zip-file fileb:///tmp/report.zip >/dev/null
  aws lambda wait function-updated --function-name $FN
  aws lambda update-function-configuration --function-name $FN --environment "$ENVJSON" --timeout 10 >/dev/null
else
  for i in 1 2 3 4 5 6; do
    aws lambda create-function --function-name $FN --runtime python3.12 --handler report.lambda_handler --role "$ROLE_ARN" \
      --zip-file fileb:///tmp/report.zip --timeout 10 --memory-size 128 --environment "$ENVJSON" >/dev/null 2>/tmp/err.txt && break
    cat /tmp/err.txt; sleep 10
  done
fi
aws lambda wait function-active --function-name $FN
aws lambda put-function-concurrency --function-name $FN --reserved-concurrent-executions 5 >/dev/null 2>&1 || echo "note: reserved concurrency not set"

echo "== 4. Function URL =="
URL=$(aws lambda get-function-url-config --function-name $FN --query FunctionUrl --output text 2>/dev/null || true)
if [ -z "$URL" ] || [ "$URL" = "None" ]; then URL=$(aws lambda create-function-url-config --function-name $FN --auth-type NONE --query FunctionUrl --output text); fi
aws lambda add-permission --function-name $FN --statement-id url-invoke --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name $FN --statement-id url-invoke-fn --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
URL_HOST=$(echo "$URL" | sed -E 's#https://([^/]+)/?#\1#')

echo "== 5. CloudFront: /api/report before /api/* =="
CP=$(aws cloudfront list-cache-policies --type managed --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='Managed-CachingDisabled'].CachePolicy.Id | [0]" --output text)
ORP=$(aws cloudfront list-origin-request-policies --type managed --query "OriginRequestPolicyList.Items[?OriginRequestPolicy.OriginRequestPolicyConfig.Name=='Managed-AllViewerExceptHostHeader'].OriginRequestPolicy.Id | [0]" --output text)
aws cloudfront get-distribution-config --id $DIST_ID > /tmp/cf.json
ETAG=$(jq -r .ETag /tmp/cf.json)
jq --arg dom "$URL_HOST" --arg cp "$CP" --arg orp "$ORP" '
  .DistributionConfig
  | .Origins.Items = ((.Origins.Items | map(select(.Id != "report-lambda"))) + [{
      Id:"report-lambda", DomainName:$dom, OriginPath:"", CustomHeaders:{Quantity:0},
      CustomOriginConfig:{HTTPPort:80, HTTPSPort:443, OriginProtocolPolicy:"https-only",
        OriginSslProtocols:{Quantity:1, Items:["TLSv1.2"]}, OriginReadTimeout:30, OriginKeepaliveTimeout:5}}])
  | .Origins.Quantity = (.Origins.Items | length)
  | .CacheBehaviors.Items = ([(.DefaultCacheBehavior + {
      PathPattern:"/api/report", TargetOriginId:"report-lambda", ViewerProtocolPolicy:"redirect-to-https", Compress:true, SmoothStreaming:false,
      AllowedMethods:{Quantity:7, Items:["GET","HEAD","OPTIONS","PUT","PATCH","POST","DELETE"], CachedMethods:{Quantity:2, Items:["GET","HEAD"]}},
      CachePolicyId:$cp, OriginRequestPolicyId:$orp, FunctionAssociations:{Quantity:0}})]
      + ((.CacheBehaviors.Items // []) | map(select(.PathPattern != "/api/report"))))
  | .CacheBehaviors.Quantity = (.CacheBehaviors.Items | length)' /tmp/cf.json > /tmp/cf-new.json
aws cloudfront update-distribution --id $DIST_ID --if-match "$ETAG" --distribution-config file:///tmp/cf-new.json >/dev/null

echo "== 6. Deploy role may update the function =="
cat > /tmp/deploy-report.json <<JSON
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["lambda:UpdateFunctionCode","lambda:GetFunction"],"Resource":"arn:aws:lambda:$REGION:$ACCOUNT:function:$FN"}]}
JSON
aws iam put-role-policy --role-name $DEPLOY_ROLE --policy-name deploy-report --policy-document file:///tmp/deploy-report.json

echo "== 7. Wait for CloudFront =="
aws cloudfront wait distribution-deployed --id $DIST_ID
echo "::notice title=result::URL=$URL"
