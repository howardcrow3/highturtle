#!/usr/bin/env bash
# Safe to re-run. Sets which domain is High Turtle's primary: PRIMARY=highturtle.ai (default) or PRIMARY=highturtle.com.
#  - PRIMARY=highturtle.ai: every other host 301-redirects to https://highturtle.ai.
#  - PRIMARY=highturtle.com: highturtle.com and highturtle.ai both serve the site (no redirect between them,
#    so browsers that cached the earlier .com -> .ai redirect cannot loop); www hosts redirect to https://highturtle.com.
#  - adds highturtle.ai and www.highturtle.ai to the existing highturtle.com CloudFront distribution,
#    with one certificate covering all four names
#  - a CloudFront Function 301-redirects every other host (highturtle.com, www.*) to https://highturtle.ai,
#    keeping path and query. /api/* is never redirected, so signup, confirm and unsubscribe links keep working.
#  - A/AAAA alias records for highturtle.ai and www.highturtle.ai
# Email records on either domain are never touched. Stops without changes if highturtle.ai has no
# Route 53 zone in this account, or its apex/www already points somewhere else.
set -euo pipefail

AI=highturtle.ai
COM=highturtle.com
PRIMARY=${PRIMARY:-$AI}
case "$PRIMARY" in $AI) SERVE="'$AI'" ;; $COM) SERVE="'$COM', '$AI'" ;; *) echo "PRIMARY must be $AI or $COM"; exit 1 ;; esac
COM_ZONE=Z06718022U4OGOJU3B5U4
DIST_ID=E3GVOW0DH898BT
FUNC=highturtle-primary-domain
CF_ZONE=Z2FDTNDATAQYW2                              # CloudFront alias hosted zone
export AWS_DEFAULT_REGION=us-east-1
note() { echo "::notice title=$1::$2"; }

CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)

echo "== 1. Zone for $AI =="
NEW_ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$AI" \
  --query "HostedZones[?Name=='$AI.' && Config.PrivateZone==\`false\`].Id | [0]" --output text)
if [ -z "$NEW_ZONE" ] || [ "$NEW_ZONE" = "None" ]; then note "stopped" "no public Route 53 zone for $AI in this account"; exit 1; fi
NEW_ZONE=${NEW_ZONE##*/}
clash=$(aws route53 list-resource-record-sets --hosted-zone-id "$NEW_ZONE" --output json |
  jq -r --arg a "$AI." --arg w "www.$AI." --arg cf "$CF_DOMAIN." '
    [.ResourceRecordSets[] | select((.Name==$a or .Name==$w) and (.Type=="A" or .Type=="AAAA" or .Type=="CNAME"))
     | select((.AliasTarget.DNSName // "" | ascii_downcase) != ($cf | ascii_downcase))] | length')
if [ "$clash" != "0" ]; then note "stopped" "$AI apex or www already has address records pointing elsewhere; nothing changed"; exit 1; fi
echo "$AI -> zone $NEW_ZONE"
ZONE_NS=$(aws route53 get-hosted-zone --id "$NEW_ZONE" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n' | sed 's/\.$//' | tr 'A-Z' 'a-z' | sort | tr '\n' ' ')
# Ask the .ai registry's own servers, so a resolver cache of the old delegation does not matter.
TLD_NS=$(dig +short NS "${AI#*.}." @8.8.8.8 | head -1)
PUBLIC_NS=$(dig +norec NS "$AI" @"$TLD_NS" | awk '$4=="NS"{print $5}' | sed 's/\.$//' | tr 'A-Z' 'a-z' | sort -u | tr '\n' ' ')
echo "zone name servers:   $ZONE_NS"
echo "public name servers: $PUBLIC_NS"
if [ "$ZONE_NS" != "$PUBLIC_NS" ]; then
  note "stopped: $AI is not delegated to Route 53" "At the registrar, set the name servers to: $ZONE_NS(currently: ${PUBLIC_NS:-none}). Then run this again. Nothing was changed."
  exit 1
fi

ALIASES=("$AI" "www.$AI" "$COM" "www.$COM")

echo "== 2. Certificate =="
CERT_ARN=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='$AI'].CertificateArn | [0]" --output text)
if [ -n "$CERT_ARN" ] && [ "$CERT_ARN" != "None" ]; then
  have=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.SubjectAlternativeNames' --output json)
  for a in "${ALIASES[@]}"; do echo "$have" | jq -e --arg a "$a" 'index($a)' >/dev/null || { CERT_ARN=""; break; }; done
fi
if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
  CERT_ARN=$(aws acm request-certificate --domain-name "$AI" --subject-alternative-names "${ALIASES[@]:1}" \
    --validation-method DNS --query CertificateArn --output text)
fi
for i in $(seq 1 30); do
  n=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" \
    --query 'length(Certificate.DomainValidationOptions[?ResourceRecord!=null])' --output text)
  [ "$n" -ge ${#ALIASES[@]} ] && break
  sleep 5
done
aws acm describe-certificate --certificate-arn "$CERT_ARN" --query 'Certificate.DomainValidationOptions' --output json > /tmp/dvo.json
for pair in "$AI:$NEW_ZONE" "$COM:$COM_ZONE"; do
  d=${pair%%:*}; z=${pair##*:}
  jq --arg d "$d" '{Changes: ([.[] | select(.DomainName==$d or .DomainName==("www."+$d)) | .ResourceRecord]
      | unique_by(.Name) | map({Action:"UPSERT", ResourceRecordSet:{Name:.Name,Type:.Type,TTL:300,ResourceRecords:[{Value:.Value}]}}))}' \
    /tmp/dvo.json > /tmp/val-$d.json
  aws route53 change-resource-record-sets --hosted-zone-id "$z" --change-batch file:///tmp/val-$d.json >/dev/null
done
# Resolvers can hold the old delegation for up to an hour after a name server change, so wait up to 45 minutes.
for i in $(seq 1 90); do
  st=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --query Certificate.Status --output text)
  [ "$st" = "ISSUED" ] && break
  [ "$st" = "PENDING_VALIDATION" ] || { note "stopped" "certificate status $st"; exit 1; }
  sleep 30
done
[ "$st" = "ISSUED" ] || { note "stopped" "certificate still pending after 45 minutes; run this again later"; exit 1; }
echo "certificate issued: $CERT_ARN"

echo "== 3. DNS for $AI (before the redirect goes live) =="
jq -n --arg cf "$CF_DOMAIN" --arg zone $CF_ZONE --arg d "$AI" '
  {Changes: [ ($d, "www."+$d) as $n | ("A","AAAA") as $t |
    {Action:"UPSERT", ResourceRecordSet:{Name:$n, Type:$t, AliasTarget:{HostedZoneId:$zone, DNSName:$cf, EvaluateTargetHealth:false}}} ]}' \
  > /tmp/dns.json
aws route53 change-resource-record-sets --hosted-zone-id "$NEW_ZONE" --change-batch file:///tmp/dns.json >/dev/null

echo "== 4. Redirect function =="
cat > /tmp/primary.js <<JS
function handler(event) {
  var r = event.request;
  var host = (r.headers.host && r.headers.host.value || '').toLowerCase();
  if ([$SERVE].indexOf(host) !== -1 || r.uri.indexOf('/api/') === 0) { return r; }
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
note "done" "primary is $PRIMARY; served hosts: $SERVE"
