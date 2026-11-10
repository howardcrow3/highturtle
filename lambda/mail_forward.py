"""Forward mail sent to info@turtlebox.studio to a personal inbox.

SES receives the message, stores it in S3 (incoming/<message-id>), then invokes this function.
SES can only send from verified addresses, so the forward is sent From info@turtlebox.studio
with the original sender in Reply-To, and "Name via Turtlebox" as the display name.
Messages SES flags as spam or virus are not forwarded (they stay in S3 until the lifecycle expiry).
"""
import email
import email.policy
import email.utils
import os

import boto3

REGION = os.environ["AWS_REGION"]
BUCKET = os.environ["BUCKET"]
PREFIX = os.environ.get("PREFIX", "incoming/")
FORWARD_TO = [a.strip() for a in os.environ["FORWARD_TO"].split(",") if a.strip()]
FROM_ADDR = os.environ["FROM_ADDR"]          # e.g. info@turtlebox.studio
BRAND = os.environ.get("BRAND", "Turtlebox")

s3 = boto3.client("s3", region_name=REGION)
ses = boto3.client("sesv2", region_name=REGION)

DROP_HEADERS = {"return-path", "sender", "message-id", "dkim-signature", "domainkey-signature",
                "authentication-results", "arc-seal", "arc-message-signature",
                "arc-authentication-results", "received-spf", "x-ses-receipt", "x-ses-dkim-signature"}


def _failed(verdict):
    return (verdict or {}).get("status") == "FAIL"


def rewrite(raw: bytes) -> bytes:
    msg = email.message_from_bytes(raw, policy=email.policy.compat32)
    orig_from = msg.get("From", "")
    name, addr = email.utils.parseaddr(orig_from)
    reply_to = msg.get("Reply-To") or orig_from
    for h in list(msg.keys()):
        if h.lower() in DROP_HEADERS or h.lower() in ("from", "reply-to"):
            del msg[h]
    label = f"{name or addr or 'Unknown'} via {BRAND}"
    msg["From"] = email.utils.formataddr((label, FROM_ADDR))
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["X-Original-From"] = orig_from
    return msg.as_bytes()


def lambda_handler(event, context):
    for record in event.get("Records", []):
        mail = record["ses"]["mail"]
        receipt = record["ses"]["receipt"]
        if _failed(receipt.get("spamVerdict")) or _failed(receipt.get("virusVerdict")):
            print(f"skipped {mail['messageId']}: spam/virus verdict")
            continue
        raw = s3.get_object(Bucket=BUCKET, Key=PREFIX + mail["messageId"])["Body"].read()
        ses.send_email(
            FromEmailAddress=FROM_ADDR,
            Destination={"ToAddresses": FORWARD_TO},
            Content={"Raw": {"Data": rewrite(raw)}},
        )
        print(f"forwarded {mail['messageId']}")
    return {"ok": True}
