#!/usr/bin/env bash
# One-time (and safe to re-run): 301-redirect turtlebox.app, turtlebox.io and turtlebox.co
# (apex and www) to https://turtlebox.studio, keeping the path.
# One certificate, one CloudFront distribution with a CloudFront Function that answers every request
# with a redirect, and A/AAAA alias records. A domain is skipped (and reported) if it has no Route 53
# zone in this account, or its apex/www already has address records pointing somewhere else.
set -euo pipefail

CANDIDATES=(turtlebox.app turtlebox.io turtlebox.co)
TARGET=https://turtlebox.studio
FUNC=turtlebox-redirect
COMMENT=turtlebox-redirects
CF_ZONE=Z2FDTNDATAQYW2                              # CloudFront alias hosted zone
CACHE_POLICY=658327ea-f89d-4fab-a63d-7e88639e58f6   # Managed-CachingOptimized
export AWS_DEFAULT_REGION=us-east-1
note() { echo "::notice title=$1::$2"; }

EXISTING_DIST=$(aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='$COMMENT'].Id | [0]" --output text)
EXISTING_CF=""
if [ -n "$EXISTING_DIST" ] && [ "$EXISTING_DIST" != "None" ]; then
  EXISTING_CF=$(aws cloudfront get-distribution --id "$EXISTING_DIST" --query Distribution.DomainName --output text)
fi

echo "== 1. Find zones and check existing records =="
declare -A ZONE
DOMAINS=()
for d in "${CANDIDATES[@]}"; do
  z=$(aws route53 list-hosted-zones-by-name --dns-name "$d" \
      --query "HostedZones[?Name=='$d.' && Config.PrivateZone==\`false\`].Id | [0]" --output text)
  if [ -z "$z" ] || [ "$z" = "None" ]; then note "skipped $d" "no public Route 53 zone in this account"; continue; fi
  z=${z##*/}
  # Address records at apex or www that are not already our redirect distribution
  clash=$(aws route53 list-resource-record-sets --hosted-zone-id "$z" --output json |
    jq -r --arg a "$d." --arg w "www.$d." --arg cf "${EXISTING_CF}." '
      [.ResourceRecordSets[] | select((.Name==$a or .Name==$w) and (.Type=="A" or .Type=="AAAA" or .Type=="CNAME"))
       | select((.AliasTarget.DNSName // "" | ascii_downcase) != ($cf | ascii_downcase))] | length')
  if [ "$clash" != "0" ]; then note "skipped $d" "apex or www already has A/AAAA/CNAME records; left alone"; continue; fi
  ZONE[$d]=$z
  DOMAINS+=("$d")
  echo "$d -> zone $z"
done
if [ ${#DOMAINS[@]} -eq 0 ]; then note "stopped" "no domains to redirect"; exit 1; fi

ALIASES=()
for d in "${DOMAINS[@]}"; do ALIASES+=("$d" "www.$d"); done
echo "aliases: ${ALIASES[*]}"

echo "== 2. Certificate =="
PRIMARY=${DOMAINS[0]}
CERT_ARN=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$PRIMARY'].CertificateArn | [0]" --output text)
if [ -n "$CERT_ARN" ] && [ "$CERT_ARN" != "None" ]; then
  have=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.SubjectAlternativeNames' --output json)
  for a in "${ALIASES[@]}"; do
    echo "$have" | jq -e --arg a "$a" 'index($a)' >/dev/null || { CERT_ARN=""; break; }
  done
fi
if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
  SANS=("${ALIASES[@]:1}")
  CERT_ARN=$(aws acm request-certificate --domain-name "$PRIMARY" --subject-alternative-names "${SANS[@]}" \
    --validation-method DNS --query CertificateArn --output text)
fi
for i in $(seq 1 30); do
  n=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
    --query 'length(Certificate.DomainValidationOptions[?ResourceRecord!=null])' --output text)
  [ "$n" -ge ${#ALIASES[@]} ] && break
  sleep 5
done
aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.DomainValidationOptions' --output json > /tmp/dvo.json
for d in "${DOMAINS[@]}"; do
  jq --arg d "$d" '{Changes: ([.[] | select(.DomainName==$d or .DomainName==("www."+$d)) | .ResourceRecord]
      | unique_by(.Name) | map({Action:"UPSERT", ResourceRecordSet:{Name:.Name,Type:.Type,TTL:300,ResourceRecords:[{Value:.Value}]}}))}' \
    /tmp/dvo.json > /tmp/val-$d.json
  aws route53 change-resource-record-sets --hosted-zone-id "${ZONE[$d]}" --change-batch file:///tmp/val-$d.json >/dev/null
done
aws acm wait certificate-validated --certificate-arn "$CERT_ARN"
echo "certificate issued"

echo "== 3. Redirect function =="
cat > /tmp/redirect.js <<JS
function handler(event) {
  var r = event.request, qs = [];
  for (var k in r.querystring) {
    var v = r.querystring[k];
    if (v.multiValue) { v.multiValue.forEach(function (m) { qs.push(k + '=' + m.value); }); }
    else { qs.push(v.value === '' ? k : k + '=' + v.value); }
  }
  var loc = '$TARGET' + r.uri + (qs.length ? '?' + qs.join('&') : '');
  return { statusCode: 301, statusDescription: 'Moved Permanently',
    headers: { location: { value: loc }, 'cache-control': { value: 'max-age=86400' } } };
}
JS
if aws cloudfront describe-function --name $FUNC >/dev/null 2>&1; then
  ETAG=$(aws cloudfront describe-function --name $FUNC --query ETag --output text)
  aws cloudfront update-function --name $FUNC --if-match "$ETAG" \
    --function-config Comment=turtlebox-redirect,Runtime=cloudfront-js-2.0 --function-code fileb:///tmp/redirect.js >/dev/null
else
  aws cloudfront create-function --name $FUNC \
    --function-config Comment=turtlebox-redirect,Runtime=cloudfront-js-2.0 --function-code fileb:///tmp/redirect.js >/dev/null
fi
ETAG=$(aws cloudfront describe-function --name $FUNC --query ETag --output text)
aws cloudfront publish-function --name $FUNC --if-match "$ETAG" >/dev/null
FUNC_ARN=$(aws cloudfront describe-function --name $FUNC --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)

echo "== 4. CloudFront distribution =="
ALIASES_JSON=$(printf '%s\n' "${ALIASES[@]}" | jq -R . | jq -sc .)
if [ -z "$EXISTING_DIST" ] || [ "$EXISTING_DIST" = "None" ]; then
  jq -n --argjson al "$ALIASES_JSON" --arg cert "$CERT_ARN" --arg fn "$FUNC_ARN" --arg cp $CACHE_POLICY --arg c $COMMENT '{
    CallerReference: ("turtlebox-redirects-" + (now|tostring)), Comment: $c, Enabled: true,
    PriceClass: "PriceClass_100", HttpVersion: "http2and3", IsIPV6Enabled: true,
    Aliases: {Quantity: ($al|length), Items: $al},
    Origins: {Quantity: 1, Items: [{Id: "unused", DomainName: "turtlebox.studio",
      CustomOriginConfig: {HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only"}}]},
    DefaultCacheBehavior: {TargetOriginId: "unused", ViewerProtocolPolicy: "redirect-to-https", Compress: true,
      CachePolicyId: $cp, AllowedMethods: {Quantity: 2, Items: ["GET","HEAD"]},
      FunctionAssociations: {Quantity: 1, Items: [{EventType: "viewer-request", FunctionARN: $fn}]}},
    ViewerCertificate: {ACMCertificateArn: $cert, SSLSupportMethod: "sni-only", MinimumProtocolVersion: "TLSv1.2_2021"}
  }' > /tmp/rdist.json
  DIST_ID=$(aws cloudfront create-distribution --distribution-config file:///tmp/rdist.json --query Distribution.Id --output text)
else
  DIST_ID=$EXISTING_DIST
  aws cloudfront get-distribution-config --id "$DIST_ID" > /tmp/rcf.json
  ETAG=$(jq -r .ETag /tmp/rcf.json)
  jq --argjson al "$ALIASES_JSON" --arg cert "$CERT_ARN" --arg fn "$FUNC_ARN" '.DistributionConfig
    | .Aliases = {Quantity: ($al|length), Items: $al}
    | .ViewerCertificate = {ACMCertificateArn: $cert, SSLSupportMethod: "sni-only", MinimumProtocolVersion: "TLSv1.2_2021"}
    | .DefaultCacheBehavior.FunctionAssociations = {Quantity: 1, Items: [{EventType: "viewer-request", FunctionARN: $fn}]}' \
    /tmp/rcf.json > /tmp/rcf-new.json
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file:///tmp/rcf-new.json >/dev/null
fi
CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)

echo "== 5. DNS =="
for d in "${DOMAINS[@]}"; do
  jq -n --arg cf "$CF_DOMAIN" --arg zone $CF_ZONE --arg d "$d" '
    {Changes: [ ($d, "www."+$d) as $n | ("A","AAAA") as $t |
      {Action:"UPSERT", ResourceRecordSet:{Name:$n, Type:$t, AliasTarget:{HostedZoneId:$zone, DNSName:$cf, EvaluateTargetHealth:false}}} ]}' \
    > /tmp/rdns-$d.json
  aws route53 change-resource-record-sets --hosted-zone-id "${ZONE[$d]}" --change-batch file:///tmp/rdns-$d.json >/dev/null
done

note "result" "DIST_ID=$DIST_ID domains=${DOMAINS[*]}"
echo "== 6. Wait for CloudFront =="
aws cloudfront wait distribution-deployed --id "$DIST_ID"
