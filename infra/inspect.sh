#!/usr/bin/env bash
set -uo pipefail
ZONE_ID=Z06718022U4OGOJU3B5U4
aws sts get-caller-identity --query Arn --output text
aws route53 list-resource-record-sets --hosted-zone-id $ZONE_ID \
  --query "ResourceRecordSets[?Type!='NS' && Type!='SOA'].[Name,Type,to_string(ResourceRecords[].Value)]" --output text | cut -c1-220 > /tmp/records.txt
echo "$(wc -l </tmp/records.txt) records"
aws sesv2 get-account --region us-east-1 --query '{prod:ProductionAccessEnabled,sending:SendingEnabled,quota:SendQuota}' --output json 2>&1 | tr -d '\n '
echo
aws sesv2 list-email-identities --region us-east-1 --output json 2>&1 | tr -d '\n ' | cut -c1-300
echo
aws lambda list-functions --region us-east-1 --query 'Functions[].FunctionName' --output text 2>&1 | cut -c1-200
