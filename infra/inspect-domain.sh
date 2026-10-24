#!/usr/bin/env bash
set -uo pipefail
D=turtlebox.studio
: > /tmp/o.txt
echo "zones: $(aws route53 list-hosted-zones --query "HostedZones[].[Name,Id]" --output text | tr '\t\n' '  ')" >> /tmp/o.txt
echo "registered: $(aws route53domains list-domains --region us-east-1 --query 'Domains[].DomainName' --output text 2>&1 | head -c 300)" >> /tmp/o.txt
echo "buckets: $(aws s3api list-buckets --query 'Buckets[].Name' --output text | head -c 400)" >> /tmp/o.txt
echo "avail: $(aws route53domains check-domain-availability --region us-east-1 --domain-name $D --query Availability --output text 2>&1 | head -c 200)" >> /tmp/o.txt
echo "dns: $(dig +short NS $D | tr '\n' ' ') A: $(dig +short A $D | tr '\n' ' ')" >> /tmp/o.txt
