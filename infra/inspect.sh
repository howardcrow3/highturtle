#!/usr/bin/env bash
set -uo pipefail
: > /tmp/records.txt
for r in us-east-1 us-east-2 us-west-2 us-west-1 eu-west-1 eu-central-1 ap-southeast-2; do
  ids=$(aws sesv2 list-email-identities --region $r --query 'EmailIdentities[].IdentityName' --output text 2>&1 | cut -c1-80)
  prod=$(aws sesv2 get-account --region $r --query 'ProductionAccessEnabled' --output text 2>&1 | cut -c1-30)
  echo "$r ids=[$ids] prod=$prod" >> /tmp/records.txt
done
