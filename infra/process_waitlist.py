#!/usr/bin/env python3
"""Send confirmation emails to signups that were queued while SES was in the sandbox.
Reads w# items from the pending table, creates a normal pending confirmation for each, sends it, then removes the queue item."""
import os, sys, time, secrets
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lambda"))
import boto3
region = "us-east-2"
os.environ.update({"AWS_REGION": region, "TABLE": "highturtle-pending", "CONTACT_LIST": "highturtle-subscribers",
                   "FROM_ADDR": "High Turtle <hello@highturtle.com>", "SITE": "https://highturtle.com",
                   "SECRET": "unused", "CONFIG_SET": "highturtle"})
import handler
ddb = boto3.client("dynamodb", region_name=region)
items, kw = [], {"TableName": "highturtle-pending", "FilterExpression": "begins_with(pk, :p)", "ExpressionAttributeValues": {":p": {"S": "w#"}}}
while True:
    r = ddb.scan(**kw); items += r["Items"]
    if "LastEvaluatedKey" not in r: break
    kw["ExclusiveStartKey"] = r["LastEvaluatedKey"]
sent = failed = skipped = 0
for it in items:
    email = it["email"]["S"]
    if handler.contact_state(email) == "subscribed":
        skipped += 1
    else:
        token = secrets.token_urlsafe(24)
        ddb.put_item(TableName="highturtle-pending", Item={"pk": {"S": "p#" + token}, "email": {"S": email}, "ttl": {"N": str(int(time.time()) + 7 * 86400)}})
        try:
            handler.send_confirmation(email, token); sent += 1
        except Exception as e:
            failed += 1; print("failed", type(e).__name__); continue
    ddb.delete_item(TableName="highturtle-pending", Key={"pk": it["pk"]})
    time.sleep(1.1)
print(f"queued {len(items)}, sent {sent}, already subscribed {skipped}, failed {failed}")
