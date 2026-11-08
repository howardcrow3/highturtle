#!/usr/bin/env bash
# One-time (and safe to re-run) AWS setup for montoya.ai.
# Creates: Route 53 hosted zone (if missing), ACM certificate, private S3 bucket,
# CloudFront distribution, apex and www DNS records, and a GitHub OIDC deploy role.
# If montoya.ai is registered in this AWS account, the name servers are pointed at the new zone.
# Otherwise the script prints the four name servers: set them at the registrar and the
# certificate validates on its own once they propagate (the script waits up to 50 minutes).
set -euo pipefail

DOMAIN=montoya.ai
BUCKET=montoya.ai
BUCKET_REGION=us-east-2
REPO=howardcrow3/highturtle
ROLE=montoya-github-deploy
CACHE_POLICY=658327ea-f89d-4fab-a63d-7e88639e58f6   # Managed-CachingOptimized
CF_ZONE=Z2FDTNDATAQYW2                              # CloudFront alias hosted zone

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
note() { echo "::notice title=$1::$2"; }

echo "== 1. Hosted zone =="
ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" \
  --query "HostedZones[?Name=='$DOMAIN.'].Id | [0]" --output text | sed 's#/hostedzone/##')
if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "None" ]; then
  ZONE_ID=$(aws route53 create-hosted-zone --name "$DOMAIN" --caller-reference "montoya-$(date +%s)" \
    --query HostedZone.Id --output text | sed 's#/hostedzone/##')
  echo "created zone $ZONE_ID"
fi
NS=$(aws route53 get-hosted-zone --id "$ZONE_ID" --query 'DelegationSet.NameServers' --output text)
note "name-servers" "Set these at the registrar for $DOMAIN: $NS"
if aws route53domains get-domain-detail --region us-east-1 --domain-name "$DOMAIN" >/dev/null 2>&1; then
  echo "registered in this account: pointing the domain at the zone"
  ARGS=$(for n in $NS; do printf 'Name=%s ' "$n"; done)
  aws route53domains update-domain-nameservers --region us-east-1 --domain-name "$DOMAIN" --nameservers $ARGS >/dev/null || true
fi

echo "== 2. Certificate (us-east-1) =="
CERT_ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)
if [ -z "$CERT_ARN" ] || [ "$CERT_ARN" = "None" ]; then
  CERT_ARN=$(aws acm request-certificate --region us-east-1 --domain-name "$DOMAIN" \
    --subject-alternative-names "www.$DOMAIN" --validation-method DNS \
    --query CertificateArn --output text)
fi
for i in $(seq 1 24); do
  n=$(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
    --query 'length(Certificate.DomainValidationOptions[?ResourceRecord!=null])' --output text)
  [ "$n" -ge 2 ] && break
  sleep 5
done
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord' --output json |
  jq '{Changes: (unique_by(.Name) | map({Action:"UPSERT", ResourceRecordSet:{Name:.Name,Type:.Type,TTL:300,ResourceRecords:[{Value:.Value}]}}))}' \
  > /tmp/validation.json
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file:///tmp/validation.json >/dev/null
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT_ARN"
echo "certificate issued"

echo "== 3. Bucket (private) =="
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || aws s3api create-bucket --bucket "$BUCKET" --region "$BUCKET_REGION" \
  --create-bucket-configuration LocationConstraint="$BUCKET_REGION"
aws s3api put-public-access-block --bucket "$BUCKET" --region "$BUCKET_REGION" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "== 4. Origin access control =="
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='montoya-oac'].Id | [0]" --output text)
if [ -z "$OAC_ID" ] || [ "$OAC_ID" = "None" ]; then
  OAC_ID=$(aws cloudfront create-origin-access-control --origin-access-control-config \
    Name=montoya-oac,Description=montoya.ai,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 \
    --query OriginAccessControl.Id --output text)
fi

echo "== 5. CloudFront distribution =="
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items!=null && contains(Aliases.Items,'$DOMAIN')].Id | [0]" --output text)
if [ -z "$DIST_ID" ] || [ "$DIST_ID" = "None" ]; then
  cat > /tmp/dist.json <<JSON
{
  "CallerReference": "montoya-$(date +%s)",
  "Comment": "montoya.ai",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "PriceClass": "PriceClass_100",
  "HttpVersion": "http2and3",
  "IsIPV6Enabled": true,
  "Aliases": {"Quantity": 2, "Items": ["$DOMAIN", "www.$DOMAIN"]},
  "Origins": {"Quantity": 1, "Items": [{
    "Id": "site-bucket",
    "DomainName": "$BUCKET.s3.$BUCKET_REGION.amazonaws.com",
    "OriginAccessControlId": "$OAC_ID",
    "S3OriginConfig": {"OriginAccessIdentity": ""}
  }]},
  "DefaultCacheBehavior": {
    "TargetOriginId": "site-bucket",
    "ViewerProtocolPolicy": "redirect-to-https",
    "Compress": true,
    "CachePolicyId": "$CACHE_POLICY",
    "AllowedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}
  },
  "CustomErrorResponses": {"Quantity": 2, "Items": [
    {"ErrorCode": 403, "ResponsePagePath": "/404.html", "ResponseCode": "404", "ErrorCachingMinTTL": 10},
    {"ErrorCode": 404, "ResponsePagePath": "/404.html", "ResponseCode": "404", "ErrorCachingMinTTL": 10}
  ]},
  "ViewerCertificate": {
    "ACMCertificateArn": "$CERT_ARN",
    "SSLSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  }
}
JSON
  DIST_ID=$(aws cloudfront create-distribution --distribution-config file:///tmp/dist.json \
    --query Distribution.Id --output text)
fi
CF_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)

echo "== 6. Bucket policy for CloudFront only =="
cat > /tmp/policy.json <<JSON
{"Version":"2012-10-17","Statement":[{
  "Sid":"AllowCloudFrontRead","Effect":"Allow",
  "Principal":{"Service":"cloudfront.amazonaws.com"},
  "Action":"s3:GetObject","Resource":"arn:aws:s3:::$BUCKET/*",
  "Condition":{"StringEquals":{"AWS:SourceArn":"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID"}}
}]}
JSON
aws s3api put-bucket-policy --bucket "$BUCKET" --region "$BUCKET_REGION" --policy file:///tmp/policy.json

echo "== 7. DNS: apex and www to CloudFront =="
jq -n --arg cf "$CF_DOMAIN" --arg zone "$CF_ZONE" --arg d "$DOMAIN" '
  {Changes: [ ($d, "www."+$d) as $n | ("A","AAAA") as $t |
    {Action:"UPSERT", ResourceRecordSet:{Name:$n, Type:$t,
      AliasTarget:{HostedZoneId:$zone, DNSName:$cf, EvaluateTargetHealth:false}}} ]}' \
  > /tmp/dns.json
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" --change-batch file:///tmp/dns.json >/dev/null

echo "== 8. GitHub deploy role (OIDC) =="
OIDC_ARN="arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_ARN" >/dev/null 2>&1 ||
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
cat > /tmp/trust.json <<JSON
{"Version":"2012-10-17","Statement":[{
  "Effect":"Allow","Principal":{"Federated":"$OIDC_ARN"},
  "Action":"sts:AssumeRoleWithWebIdentity",
  "Condition":{"StringEquals":{
    "token.actions.githubusercontent.com:aud":"sts.amazonaws.com",
    "token.actions.githubusercontent.com:sub":"repo:$REPO:ref:refs/heads/main"}}
}]}
JSON
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$ROLE" --policy-document file:///tmp/trust.json
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document file:///tmp/trust.json >/dev/null
fi
cat > /tmp/role-policy.json <<JSON
{"Version":"2012-10-17","Statement":[
  {"Effect":"Allow","Action":["s3:ListBucket"],"Resource":"arn:aws:s3:::$BUCKET"},
  {"Effect":"Allow","Action":["s3:PutObject","s3:DeleteObject"],"Resource":"arn:aws:s3:::$BUCKET/*"},
  {"Effect":"Allow","Action":["cloudfront:CreateInvalidation"],"Resource":"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID"},
  {"Effect":"Allow","Action":["cloudfront:ListDistributions"],"Resource":"*"}
]}
JSON
aws iam put-role-policy --role-name "$ROLE" --policy-name deploy-site --policy-document file:///tmp/role-policy.json
ROLE_ARN=$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)

echo "== 9. First upload =="
aws s3 sync montoya "s3://$BUCKET" --delete --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

note "result" "DIST_ID=$DIST_ID CF_DOMAIN=$CF_DOMAIN ROLE_ARN=$ROLE_ARN CERT_ARN=$CERT_ARN ZONE_ID=$ZONE_ID"
