#!/usr/bin/env bash
# Adds a CloudFront Function to turtlebox.studio so /apps/ serves /apps/index.html. Safe to re-run.
set -euo pipefail
DIST_ID=E3AFT58QXC1DZ0
NAME=turtlebox-index-rewrite
cat > /tmp/fn.js <<'JS'
function handler(event) {
  var r = event.request;
  var u = r.uri;
  if (u.charAt(u.length - 1) === '/') { r.uri = u + 'index.html'; }
  else if (u.indexOf('.') === -1) { r.uri = u + '/index.html'; }
  return r;
}
JS
CFG='Comment=Serve index.html for folder paths,Runtime=cloudfront-js-2.0'
if aws cloudfront describe-function --name $NAME >/dev/null 2>&1; then
  ET=$(aws cloudfront describe-function --name $NAME --query ETag --output text)
  ET=$(aws cloudfront update-function --name $NAME --if-match "$ET" --function-config "$CFG" --function-code fileb:///tmp/fn.js --query ETag --output text)
else
  ET=$(aws cloudfront create-function --name $NAME --function-config "$CFG" --function-code fileb:///tmp/fn.js --query ETag --output text)
fi
aws cloudfront publish-function --name $NAME --if-match "$ET" >/dev/null
FN_ARN=$(aws cloudfront describe-function --name $NAME --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)
aws cloudfront get-distribution-config --id $DIST_ID > /tmp/cf.json
ETAG=$(jq -r .ETag /tmp/cf.json)
jq --arg arn "$FN_ARN" '.DistributionConfig | .DefaultCacheBehavior.FunctionAssociations = {Quantity:1, Items:[{EventType:"viewer-request", FunctionARN:$arn}]}' /tmp/cf.json > /tmp/cf-new.json
aws cloudfront update-distribution --id $DIST_ID --if-match "$ETAG" --distribution-config file:///tmp/cf-new.json >/dev/null
aws cloudfront wait distribution-deployed --id $DIST_ID
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*" >/dev/null
echo "::notice title=done::rewrite function attached"
