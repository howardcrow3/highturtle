#!/usr/bin/env bash
# One-time (and safe to re-run): make highturtle.ai the primary domain of the High Turtle site.
#  - adds highturtle.ai and www.highturtle.ai to the existing highturtle.com CloudFront distribution,
#    with one certificate covering all four names
#  - a CloudFront Function 301-redirects every other host (highturtle.com, www.*) to https://highturtle.ai,
#    keeping path and query. /api/* is never redirected, so signup, confirm and unsubscribe links keep working.
#  - A/AAAA alias records for highturtle.ai and www.highturtle.ai
# Email records on either domain are never touched. Stops without changes if highturtle.ai has no
# Route 53 zone in this account, or its apex/www already points somewhere else.
set -euo pipefail

PRIMARY=highturtle.ai
OLD=highturtle.com
OLD_ZONE=Z06718022U4OGOJU3B5U4
DIST_ID=E3GVOW0DH898BT
FUNC=highturtle-primary-domain
CF_ZONE=Z2FDTNDATAQYW2                              # CloudFront alias hosted zone
export AWS_DEFAULT_REGION=us-east-1
note() { echo "::notice title=$1::$2"; }

CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)

echo "== 1. Zone for $PRIMARY =="
NEW_ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$PRIMARY" \
  --query "HostedZones[?Name=='$PRIMARY.' && Config.PrivateZone==\`false\`].Id | [0]" --output text)
if [ -z "$NEW_ZONE" ] || [ "$NEW_ZONE" = "None" ]; then note "stopped" "no public Route 53 zone for $PRIMARY in this account"; exit 1; fi
NEW_ZONE=${NEW_ZONE##*/}
clash=$(aws route53 list-resource-record-sets --hosted-zone-id "$NEW_ZONE" --output json |
  jq -r --arg a "$PRIMARY." --arg w "www.$PRIMARY." --arg cf "$CF_DOMAIN." '
    [.ResourceRecordSets[] | select((.Name==$a or .Name==$w) and (.Type=="A" or .Type=="AAAA" or .Type=="CNAME"))
     | select((.AliasTarget.DNSName // "" | ascii_downcase) != ($cf | ascii_downcase))] | length')
if [ "$clash" != "0" ]; then note "stopped" "$PRIMARY apex or www already has address records pointing elsewhere; nothing changed"; exit 1; fi
echo "$PRIMARY -> zone $NEW_ZONE"

ALIASES=("$PRIMARY" "www.$PRIMARY" "$OLD" "www.$OLD")

echo "== 2. Certificate =="
CERT_ARN=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$PRIMARY'].CertificateArn | [0]" --output text)
if [ -n "$CERT_ARN" ] && [ "$CERT_ARN" != "None" ]; then
  have=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.SubjectAlternativeNames' --output json)
  for a in "${ALIASES[@]}"; do echo "$have" | jq -e --arg a "$a" 'index($a)' >/dev/null || { CERT_ARN=""; break; }; done
fi
if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
  CERT_ARN=$(aws acm request-certificate --domain-name "$PRIMARY" --subject-alternative-names "${ALIASES[@]:1}" \
    --validation-method DNS --query CertificateArn --output text)
fi
for i in $(seq 1 30); do
  n=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
    --query 'length(Certificate.DomainValidationOptions[?ResourceRecord!=null])' --output text)
  [ "$n" -ge ${#ALIASES[@]} ] && break
  sleep 5
done
aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.DomainValidationOptions' --output json > /tmp/dvo.json
for pair in "$PRIMARY:$NEW_ZONE" "$OLD:$OLD_ZONE"; do
  d=${pair%%:*}; z=${pair##*:}
  jq --arg d "$d" '{Changes: ([.[] | select(.DomainName==$d or .DomainName==("www."+$d)) | .ResourceRecord]
      | unique_by(.Name) | map({Action:"UPSERT", ResourceRecordSet:{Name:.Name,Type:.Type,TTL:300,ResourceRecords:[{Value:.Value}]}}))}' \
    /tmp/dvo.json > /tmp/val-$d.json
  aws route53 change-resource-record-sets --hosted-zone-id "$z" --change-batch file:///tmp/val-$d.json >/dev/null
done
aws acm wait certificate-validated --certificate-arn "$CERT_ARN"
echo "certificate issued: $CERT_ARN"

echo "== 3. DNS for $PRIMARY (before the redirect goes live) =="
jq -n --arg cf "$CF_DOMAIN" --arg zone $CF_ZONE --arg d "$PRIMARY" '
  {Changes: [ ($d, "www."+$d) as $n | ("A","AAAA") as $t |
    {Action:"UPSERT", ResourceRecordSet:{Name:$n, Type:$t, AliasTarget:{HostedZoneId:$zone, DNSName:$cf, EvaluateTargetHealth:false}}} ]}' \
  > /tmp/dns.json
aws route53 change-resource-record-sets --hosted-zone-id "$NEW_ZONE" --change-batch file:///tmp/dns.json >/dev/null

echo "== 4. Redirect function =="
cat > /tmp/primary.js <<JS
function handler(event) {
  var r = event.request;
  var host = (r.headers.host && r.headers.host.value || '').toLowerCase();
  if (host === '$PRIMARY' || r.uri.indexOf('/api/') === 0) { return r; }
  var qs = [];
  for (var k in r.querystring) {
    var v = r.querystring[k];
    if (v.multiValue) { v.multiValue.forEach(function (m) { qs.push(k + '=' + m.value); }); }
    else { qs.push(v.value === '' ? k : k + '=' + v.value); }
  }
  var loc = 'https://$PRIMARY' + r.uri + (qs.length ? '?' + qs.join('&') : '');
  return { statusCode: 301, statusDescription: 'Moved Permanently',
    headers: { location: { value: loc }, 'cache-control': { value: 'max-age=3600' } } };
}
JS
if aws cloudfront describe-function --name $FUNC >/dev/null 2>&1; then
  ETAG=$(aws cloudfront describe-function --name $FUNC --query ETag --output text)
  aws cloudfront update-function --name $FUNC --if-match "$ETAG" \
    --function-config Comment=highturtle-primary-domain,Runtime=cloudfront-js-2.0 --function-code fileb:///tmp/primary.js >/dev/null
else
  aws cloudfront create-function --name $FUNC \
    --function-config Comment=highturtle-primary-domain,Runtime=cloudfront-js-2.0 --function-code fileb:///tmp/primary.js >/dev/null
fi
ETAG=$(aws cloudfront describe-function --name $FUNC --query ETag --output text)
aws cloudfront publish-function --name $FUNC --if-match "$ETAG" >/dev/null
FUNC_ARN=$(aws cloudfront describe-function --name $FUNC --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)

echo "== 5. CloudFront distribution $DIST_ID =="
aws cloudfront get-distribution-config --id "$DIST_ID" > /tmp/cf.json
ETAG=$(jq -r .ETag /tmp/cf.json)
other=$(jq -r --arg fn "$FUNC_ARN" '[.DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items // [] | .[]
  | select(.EventType=="viewer-request" and (.FunctionARN | test("function/highturtle-primary-domain$") | not))] | length' /tmp/cf.json)
if [ "$other" != "0" ]; then note "stopped" "the default behavior already has another viewer-request function; nothing changed on the distribution"; exit 1; fi
ALIASES_JSON=$(printf '%s\n' "${ALIASES[@]}" | jq -R . | jq -sc .)
jq --argjson al "$ALIASES_JSON" --arg cert "$CERT_ARN" --arg fn "$FUNC_ARN" '.DistributionConfig
  | .Aliases = {Quantity: ($al|length), Items: $al}
  | .ViewerCertificate = {ACMCertificateArn: $cert, SSLSupportMethod: "sni-only", MinimumProtocolVersion: "TLSv1.2_2021"}
  | .DefaultCacheBehavior.FunctionAssociations.Items = (((.DefaultCacheBehavior.FunctionAssociations.Items // [])
      | map(select(.EventType != "viewer-request"))) + [{EventType: "viewer-request", FunctionARN: $fn}])
  | .DefaultCacheBehavior.FunctionAssociations.Quantity = (.DefaultCacheBehavior.FunctionAssociations.Items | length)' \
  /tmp/cf.json > /tmp/cf-new.json
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file:///tmp/cf-new.json >/dev/null

note "result" "DIST_ID=$DIST_ID primary=$PRIMARY cert=$CERT_ARN"
echo "== 6. Wait for CloudFront =="
aws cloudfront wait distribution-deployed --id "$DIST_ID"
note "done" "highturtle.ai is live; other hosts redirect to it"
