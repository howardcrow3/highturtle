"""Turtlebox app downloads: email gate, emailed link, short-lived download URL, add to the shared list.

  POST /api/download   body: email, app. Sends an email with a download link.
  GET  /api/get?t=...  checks the link, adds the address to the High Turtle list, redirects to a 5-minute S3 URL.

Apps live in a private S3 bucket as <app-slug>/<file>. The newest file under a slug is the one served.
Uses the same SES contact list as highturtle.com. Someone who unsubscribed earlier is not re-subscribed.
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
BUCKET = os.environ["BUCKET"]
LIST_NAME = os.environ["CONTACT_LIST"]
FROM_ADDR = os.environ["FROM_ADDR"]
REPLY_TO = os.environ.get("REPLY_TO", "")
SITE = os.environ["SITE"].rstrip("/")
LIST_SITE = os.environ["LIST_SITE"].rstrip("/")   # where the unsubscribe page lives
SECRET = os.environ["SECRET"].encode()
CONFIG_SET = os.environ.get("CONFIG_SET", "")

ses = boto3.client("sesv2", region_name=REGION)
ddb = boto3.client("dynamodb", region_name=REGION)
s3 = boto3.client("s3", region_name=REGION, endpoint_url=f"https://s3.{REGION}.amazonaws.com",
                  config=boto3.session.Config(signature_version="s3v4", s3={"addressing_style": "virtual"}))

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
LINK_TTL = 7 * 24 * 3600
THROTTLE_SECONDS = 600
URL_SECONDS = 300


def sign(email):
    return hmac.new(SECRET, ("unsub:" + email).encode(), hashlib.sha256).hexdigest()[:32]


def respond(status, body="", headers=None, ctype="application/json"):
    h = {"content-type": ctype, "cache-control": "no-store"}
    h.update(headers or {})
    return {"statusCode": status, "headers": h, "body": body}


def redirect(url):
    return respond(303, "", {"location": url})


def headers_of(event):
    return {k.lower(): v for k, v in (event.get("headers") or {}).items()}


def wants_json(event):
    return "application/json" in headers_of(event).get("accept", "")


def parse_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    if "application/json" in headers_of(event).get("content-type", ""):
        try:
            return json.loads(raw)
        except ValueError:
            return {}
    return {k: v[0] for k, v in parse_qs(raw).items()}


def newest_object(slug):
    """Newest file under <slug>/, or None."""
    r = s3.list_objects_v2(Bucket=BUCKET, Prefix=slug + "/", MaxKeys=50)
    items = [o for o in r.get("Contents", []) if not o["Key"].endswith("/")]
    if not items:
        return None
    return max(items, key=lambda o: o["LastModified"])


def title_for(obj, slug):
    try:
        meta = s3.head_object(Bucket=BUCKET, Key=obj["Key"]).get("Metadata", {})
        if meta.get("title"):
            return meta["title"]
    except ClientError:
        pass
    return slug.replace("-", " ").capitalize()


def send_link(email, title, link):
    unsub = f"{LIST_SITE}/api/unsubscribe?e={quote(email)}&s={sign(email)}"
    text = (
        f"Here is your download: {title}\n\n{link}\n\n"
        "The link works for 7 days.\n\n"
        "You'll also get occasional news from High Turtle about new releases. "
        f"Unsubscribe any time: {unsub}\n\nTurtlebox\nhttps://turtlebox.studio\n"
    )
    body = f"""<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:16px;line-height:1.6;color:#2e3033;max-width:32rem">
<p>Here is your download: <strong>{html.escape(title)}</strong></p>
<p><a href="{link}" style="display:inline-block;background:#17181a;color:#f6f6f5;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:3px">Download</a></p>
<p style="color:#66686b;font-size:14px">The link works for 7 days. If the button does not work, paste this into your browser:<br>{link}</p>
<p style="color:#66686b;font-size:14px">You'll also get occasional news from High Turtle about new releases. <a href="{unsub}" style="color:#2f5c8f">Unsubscribe</a> any time.</p></div>"""
    args = dict(
        FromEmailAddress=FROM_ADDR,
        Destination={"ToAddresses": [email]},
        Content={"Simple": {
            "Subject": {"Data": f"Your download: {title}", "Charset": "UTF-8"},
            "Body": {"Text": {"Data": text, "Charset": "UTF-8"}, "Html": {"Data": body, "Charset": "UTF-8"}},
            "Headers": [
                {"Name": "List-Unsubscribe", "Value": f"<{unsub}>"},
                {"Name": "List-Unsubscribe-Post", "Value": "List-Unsubscribe=One-Click"},
            ],
        }},
    )
    if REPLY_TO:
        args["ReplyToAddresses"] = [REPLY_TO]
    if CONFIG_SET:
        args["ConfigurationSetName"] = CONFIG_SET
    ses.send_email(**args)


def request_download(event):
    data = parse_body(event)
    as_json = wants_json(event)
    ok = (lambda: respond(200, json.dumps({"ok": True}))) if as_json else (lambda: redirect(SITE + "/download-sent.html"))
    bad = lambda code: respond(400, json.dumps({"ok": False, "error": code})) if as_json else redirect(SITE + "/download-problem.html")
    if (data.get("_gotcha") or "").strip():
        return ok()
    email = (data.get("email") or "").strip().lower()
    slug = (data.get("app") or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        return bad("invalid_email")
    if not SLUG_RE.match(slug):
        return bad("unknown_app")
    obj = newest_object(slug)
    if not obj:
        return bad("unknown_app")
    now = int(time.time())
    try:
        ddb.put_item(
            TableName=TABLE,
            Item={"pk": {"S": "dt#" + hashlib.sha256((email + "|" + slug).encode()).hexdigest()}, "ttl": {"N": str(now + THROTTLE_SECONDS)}},
            ConditionExpression="attribute_not_exists(pk) OR #t < :now",
            ExpressionAttributeNames={"#t": "ttl"},
            ExpressionAttributeValues={":now": {"N": str(now)}},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return ok()
        raise
    token = secrets.token_urlsafe(24)
    ddb.put_item(TableName=TABLE, Item={
        "pk": {"S": "d#" + token}, "email": {"S": email}, "app": {"S": slug}, "ttl": {"N": str(now + LINK_TTL)},
    })
    send_link(email, title_for(obj, slug), f"{SITE}/api/get?t={token}")
    return ok()


def get_download(event):
    token = ((event.get("queryStringParameters") or {}).get("t") or "").strip()
    if not token or len(token) > 100:
        return redirect(SITE + "/download-problem.html")
    item = ddb.get_item(TableName=TABLE, Key={"pk": {"S": "d#" + token}}).get("Item")
    if not item or int(item["ttl"]["N"]) < int(time.time()):
        return redirect(SITE + "/download-problem.html")
    email, slug = item["email"]["S"], item["app"]["S"]
    obj = newest_object(slug)
    if not obj:
        return redirect(SITE + "/download-problem.html")
    attrs = json.dumps({"source": "turtlebox:" + slug, "joinedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    try:
        ses.create_contact(ContactListName=LIST_NAME, EmailAddress=email, UnsubscribeAll=False, AttributesData=attrs)
    except ClientError as e:
        if e.response["Error"]["Code"] != "AlreadyExistsException":
            raise
    filename = obj["Key"].split("/")[-1]
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": obj["Key"], "ResponseContentDisposition": f'attachment; filename="{filename}"'},
        ExpiresIn=URL_SECONDS,
    )
    return redirect(url)


def lambda_handler(event, context):
    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "GET")
    path = event.get("rawPath", "/")
    if path.startswith("/api"):
        path = path[4:]
    try:
        if path == "/download" and method == "POST":
            return request_download(event)
        if path == "/get" and method == "GET":
            return get_download(event)
    except Exception as e:
        print("error", type(e).__name__, str(e)[:300])
        return respond(500, "Something went wrong. Please try again.", ctype="text/plain")
    return respond(400, "Not found", ctype="text/plain")
