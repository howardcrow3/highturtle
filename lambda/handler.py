"""High Turtle subscriptions: signup, double opt-in confirmation, unsubscribe.

One Lambda function behind a function URL, reached through CloudFront at /api/*.
  POST /api/subscribe     save a pending signup and send the confirmation email
  GET  /api/confirm       confirm the address and add it to the SES contact list
  GET  /api/unsubscribe   show an unsubscribe button (so link scanners do not unsubscribe people)
  POST /api/unsubscribe   unsubscribe (also the RFC 8058 one-click target)
Storage: DynamoDB table for pending signups (expire after 48 hours), SES contact list for subscribers.
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import time
from urllib.parse import parse_qs, quote

import boto3
from botocore.exceptions import ClientError

REGION = os.environ["AWS_REGION"]
TABLE = os.environ["TABLE"]
LIST_NAME = os.environ["CONTACT_LIST"]
FROM_ADDR = os.environ["FROM_ADDR"]
SITE = os.environ["SITE"].rstrip("/")
SECRET = os.environ["SECRET"].encode()
CONFIG_SET = os.environ.get("CONFIG_SET", "")

ses = boto3.client("sesv2", region_name=REGION)
ddb = boto3.client("dynamodb", region_name=REGION)

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
PENDING_TTL = 48 * 3600
THROTTLE_SECONDS = 600


def sign(email):
    return hmac.new(SECRET, ("unsub:" + email).encode(), hashlib.sha256).hexdigest()[:32]


def unsubscribe_url(email):
    return f"{SITE}/api/unsubscribe?e={quote(email)}&s={sign(email)}"


def respond(status, body="", headers=None, ctype="text/html; charset=utf-8"):
    h = {"content-type": ctype, "cache-control": "no-store"}
    h.update(headers or {})
    return {"statusCode": status, "headers": h, "body": body}


def redirect(path):
    return respond(303, "", {"location": SITE + path})


def page(title, heading, text, button=None):
    btn = button or f'<a class="btn" href="/">Back to High Turtle</a>'
    return respond(200, f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">
<title>{html.escape(title)} | High Turtle</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css?v=graphite2"></head>
<body><header class="site-header"><div class="wrap bar"><a class="brand" href="/" style="font-family:var(--font-head);font-size:1.4rem;text-decoration:none">High Turtle</a></div></header>
<main class="simple wrap"><h1>{html.escape(heading)}</h1><p>{html.escape(text)}</p>{btn}</main></body></html>""")


def wants_json(event):
    h = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    return "application/json" in h.get("accept", "")


def parse_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    h = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if "application/json" in h.get("content-type", ""):
        try:
            return json.loads(raw)
        except ValueError:
            return {}
    return {k: v[0] for k, v in parse_qs(raw).items()}


def contact_state(email):
    """Return 'subscribed', 'unsubscribed' or None."""
    try:
        c = ses.get_contact(ContactListName=LIST_NAME, EmailAddress=email)
    except ClientError as e:
        if e.response["Error"]["Code"] == "NotFoundException":
            return None
        raise
    return "unsubscribed" if c.get("UnsubscribeAll") else "subscribed"


def send_confirmation(email, token):
    link = f"{SITE}/api/confirm?t={token}"
    text = (
        "Confirm your email to join the High Turtle list.\n\n"
        f"{link}\n\n"
        "If you did not ask for this, ignore this email and nothing will happen.\n\n"
        "High Turtle\nhttps://highturtle.com\n"
    )
    body = f"""<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#2e3033;max-width:32rem">
<p>Confirm your email to join the High Turtle list.</p>
<p><a href="{link}" style="display:inline-block;background:#17181a;color:#f6f6f5;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:3px">Confirm my email</a></p>
<p style="color:#66686b;font-size:14px">If the button does not work, paste this into your browser:<br>{link}</p>
<p style="color:#66686b;font-size:14px">If you did not ask for this, ignore this email and nothing will happen.</p></div>"""
    args = dict(
        FromEmailAddress=FROM_ADDR,
        Destination={"ToAddresses": [email]},
        Content={"Simple": {
            "Subject": {"Data": "Confirm your email for High Turtle", "Charset": "UTF-8"},
            "Body": {"Text": {"Data": text, "Charset": "UTF-8"}, "Html": {"Data": body, "Charset": "UTF-8"}},
        }},
    )
    if CONFIG_SET:
        args["ConfigurationSetName"] = CONFIG_SET
    ses.send_email(**args)


def subscribe(event):
    data = parse_body(event)
    ok = (lambda: respond(200, json.dumps({"ok": True}), ctype="application/json")) if wants_json(event) \
        else (lambda: redirect("/thanks.html"))
    if (data.get("_gotcha") or "").strip():
        return ok()  # bot: pretend it worked
    email = (data.get("email") or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        if wants_json(event):
            return respond(400, json.dumps({"ok": False, "error": "invalid_email"}), ctype="application/json")
        return page("Check the address", "That address doesn't look right.", "Check it and try again.",
                    '<a class="btn" href="/#signup">Try again</a>')
    now = int(time.time())
    # one confirmation email per address per ten minutes
    try:
        ddb.put_item(
            TableName=TABLE,
            Item={"pk": {"S": "t#" + hashlib.sha256(email.encode()).hexdigest()}, "ttl": {"N": str(now + THROTTLE_SECONDS)}},
            ConditionExpression="attribute_not_exists(pk) OR #t < :now",
            ExpressionAttributeNames={"#t": "ttl"},
            ExpressionAttributeValues={":now": {"N": str(now)}},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return ok()
        raise
    if contact_state(email) == "subscribed":
        return ok()  # already on the list; say nothing so addresses cannot be probed
    token = secrets.token_urlsafe(24)
    ddb.put_item(TableName=TABLE, Item={
        "pk": {"S": "p#" + token}, "email": {"S": email}, "ttl": {"N": str(now + PENDING_TTL)},
    })
    send_confirmation(email, token)
    return ok()


def confirm(event):
    token = ((event.get("queryStringParameters") or {}).get("t") or "").strip()
    if not token or len(token) > 100:
        return redirect("/link-problem.html")
    item = ddb.get_item(TableName=TABLE, Key={"pk": {"S": "p#" + token}}).get("Item")
    if not item or int(item["ttl"]["N"]) < int(time.time()):
        return redirect("/link-problem.html")
    email = item["email"]["S"]
    attrs = json.dumps({"source": "website", "confirmedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    try:
        ses.create_contact(ContactListName=LIST_NAME, EmailAddress=email, UnsubscribeAll=False, AttributesData=attrs)
    except ClientError as e:
        if e.response["Error"]["Code"] != "AlreadyExistsException":
            raise
        ses.update_contact(ContactListName=LIST_NAME, EmailAddress=email, UnsubscribeAll=False, AttributesData=attrs)
    ddb.delete_item(TableName=TABLE, Key={"pk": {"S": "p#" + token}})
    return redirect("/confirmed.html")


def unsubscribe(event, method):
    q = event.get("queryStringParameters") or {}
    email = (q.get("e") or "").strip().lower()
    sig = q.get("s") or ""
    if not email or not hmac.compare_digest(sig, sign(email)):
        return redirect("/link-problem.html")
    if method == "GET":
        action = f"/api/unsubscribe?e={quote(email)}&s={sig}"
        btn = f'<form method="POST" action="{html.escape(action)}"><button class="btn" type="submit">Unsubscribe</button></form>'
        return page("Unsubscribe", "Unsubscribe from High Turtle?",
                    f"{email} will stop receiving email from us.", btn)
    try:
        ses.update_contact(ContactListName=LIST_NAME, EmailAddress=email, UnsubscribeAll=True)
    except ClientError as e:
        if e.response["Error"]["Code"] != "NotFoundException":
            raise
    h = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    if "text/html" in h.get("accept", ""):
        return redirect("/unsubscribed.html")
    return respond(200, "Unsubscribed", ctype="text/plain")


def lambda_handler(event, context):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "GET")
    path = event.get("rawPath", "/")
    if path.startswith("/api"):
        path = path[4:]
    try:
        if path == "/subscribe" and method == "POST":
            return subscribe(event)
        if path == "/confirm" and method == "GET":
            return confirm(event)
        if path == "/unsubscribe" and method in ("GET", "POST"):
            return unsubscribe(event, method)
    except Exception as e:  # keep the real error in the logs, show a plain message
        print("error", type(e).__name__, str(e)[:300])
        return respond(500, "Something went wrong. Please try again.", ctype="text/plain")
    return respond(400, "Not found", ctype="text/plain")
