"""Backer "Report an issue": validates a report from the website form and files it as a GitHub issue.

  POST /api/report   JSON or form body. Returns {"ok": true, "ref": <issue number>}.

Safeguards: honeypot field, per-visitor and daily limits (DynamoDB with TTL), field length limits,
a refusal to file into a public repository (reports can contain an email address), and neutralised
@mentions, issue references and markup in user text. The GitHub token is read from SSM Parameter Store.
"""
import base64
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs

import boto3
from botocore.exceptions import ClientError

REGION = os.environ["AWS_REGION"]
REPO = os.environ["REPO"]                    # owner/name
PARAM = os.environ["TOKEN_PARAM"]            # SSM SecureString holding the GitHub token
TABLE = os.environ["TABLE"]
SALT = os.environ["SALT"]
ALLOW_PUBLIC = os.environ.get("ALLOW_PUBLIC") == "1"
PER_IP_PER_HOUR = int(os.environ.get("PER_IP_PER_HOUR", "5"))
PER_DAY = int(os.environ.get("PER_DAY", "100"))

ddb = boto3.client("dynamodb", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)

_token = None
_repo_ok = None

PLATFORMS = {"macOS", "Windows", "Not sure"}
EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")
VERSION_RE = re.compile(r"^[0-9A-Za-z.+\- ]{0,40}$")
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def respond(status, obj=None, headers=None):
    h = {"content-type": "application/json", "cache-control": "no-store"}
    h.update(headers or {})
    return {"statusCode": status, "headers": h, "body": json.dumps(obj if obj is not None else {})}


def parse_body(event):
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    if len(raw) > 20000:
        return None
    ctype = {k.lower(): v for k, v in (event.get("headers") or {}).items()}.get("content-type", "")
    if "application/json" in ctype:
        try:
            d = json.loads(raw)
            return d if isinstance(d, dict) else None
        except ValueError:
            return None
    return {k: v[0] for k, v in parse_qs(raw).items()}


def clean(value, limit, multiline=False):
    s = str(value or "")
    s = CTRL_RE.sub("", s).replace("\r\n", "\n").replace("\r", "\n")
    if not multiline:
        s = " ".join(s.split())
    return s.strip()[: limit + 1]


def safe_text(s):
    """Make user text harmless in GitHub markdown: no mentions, no issue links, no markup, no images."""
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = s.replace("[", "\\[").replace("]", "\\]").replace("`", "'")
    s = re.sub(r"@(?=[A-Za-z0-9])", "@\u200b", s)
    s = re.sub(r"(?<![\w&])#(?=\d)", "#\u200b", s)
    return s


def quote(s):
    return "\n".join("> " + line if line.strip() else ">" for line in safe_text(s).split("\n"))


def cell(s, mentions=True):
    t = safe_text(s) if mentions else s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("`", "'")
    return t.replace("|", "\\|").replace("\n", " ") or "_not given_"


def viewer_ip(event):
    h = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    xff = h.get("x-forwarded-for", "")
    return (xff.split(",")[0].strip() if xff else event.get("requestContext", {}).get("http", {}).get("sourceIp", "")) or "unknown"


def hit(key, limit, ttl_seconds):
    """Count one use of `key`. Returns True while the count is within `limit`."""
    r = ddb.update_item(
        TableName=TABLE, Key={"pk": {"S": key}},
        UpdateExpression="ADD n :one SET #t = if_not_exists(#t, :ttl)",
        ExpressionAttributeNames={"#t": "ttl"},
        ExpressionAttributeValues={":one": {"N": "1"}, ":ttl": {"N": str(int(time.time()) + ttl_seconds)}},
        ReturnValues="UPDATED_NEW",
    )
    return int(r["Attributes"]["n"]["N"]) <= limit


def github(method, path, body=None):
    global _token
    if _token is None:
        _token = ssm.get_parameter(Name=PARAM, WithDecryption=True)["Parameter"]["Value"].strip()
    req = urllib.request.Request(
        "https://api.github.com" + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + _token, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "backer-report-form",
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode() or "{}")


def repo_allowed():
    global _repo_ok
    if _repo_ok is None:
        info = github("GET", f"/repos/{REPO}")
        _repo_ok = bool(info.get("private")) or ALLOW_PUBLIC
        if not _repo_ok:
            print("refusing: repository is public; set ALLOW_PUBLIC=1 only if reports may be public")
    return _repo_ok


def build_issue(f):
    rows = [("Platform", f["platform"]), ("Backer version", f["version"]), ("NAS", f["nas"])]
    if f["email"]:
        rows.append(("Contact email", f["email"]))
    table = "| | |\n|---|---|\n" + "\n".join(f"| {k} | {cell(v, k != 'Contact email')} |" for k, v in rows)
    body = (
        "_Sent through the report form on the Backer website._\n\n"
        f"### What happened\n{quote(f['details'])}\n\n"
        f"### Steps to reproduce\n{quote(f['steps']) if f['steps'] else '_Not given_'}\n\n"
        f"### Details\n{table}\n"
    )
    return {"title": "[Report] " + safe_text(f["summary"])[:120], "body": body, "labels": ["user-report"]}


def _handle(event, context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath", "")
    if method != "POST" or path.rstrip("/") not in ("/api/report", "/report"):
        return respond(404, {"ok": False, "error": "not_found"})
    data = parse_body(event)
    if data is None:
        return respond(400, {"ok": False, "error": "bad_request"})
    if clean(data.get("website"), 50):                       # honeypot: pretend it worked
        return respond(200, {"ok": True})

    f = {
        "summary": clean(data.get("summary"), 120),
        "details": clean(data.get("details"), 3000, True),
        "steps": clean(data.get("steps"), 2000, True),
        "platform": clean(data.get("platform"), 20),
        "version": clean(data.get("version"), 40),
        "nas": clean(data.get("nas"), 100),
        "email": clean(data.get("email"), 254).lower(),
    }
    errors = {}
    if not f["summary"] or len(f["summary"]) > 120: errors["summary"] = "Add a short summary (up to 120 characters)."
    if not f["details"] or len(f["details"]) > 3000: errors["details"] = "Describe what happened (up to 3,000 characters)."
    if len(f["steps"]) > 2000: errors["steps"] = "Keep the steps under 2,000 characters."
    if f["platform"] not in PLATFORMS: errors["platform"] = "Choose macOS, Windows or Not sure."
    if not VERSION_RE.match(f["version"]): errors["version"] = "Use only letters, numbers, dots and dashes."
    if len(f["nas"]) > 100: errors["nas"] = "Keep this under 100 characters."
    if f["email"] and (len(f["email"]) > 254 or not EMAIL_RE.match(f["email"])): errors["email"] = "That email address does not look right."
    if errors:
        return respond(400, {"ok": False, "error": "invalid", "fields": errors})

    try:
        ip = hashlib.sha256((SALT + viewer_ip(event)).encode()).hexdigest()[:24]
        if not hit(f"ip#{ip}#{int(time.time() // 3600)}", PER_IP_PER_HOUR, 2 * 3600) or \
           not hit(f"day#{int(time.time() // 86400)}", PER_DAY, 2 * 86400):
            return respond(429, {"ok": False, "error": "rate_limited"})
        if not repo_allowed():
            return respond(503, {"ok": False, "error": "unavailable"})
        issue = github("POST", f"/repos/{REPO}/issues", build_issue(f))
        return respond(200, {"ok": True, "ref": issue.get("number")})
    except urllib.error.HTTPError as e:
        print("github error", e.code)
        return respond(502, {"ok": False, "error": "upstream"})
    except Exception as e:
        print("error", type(e).__name__, str(e)[:200])
        return respond(500, {"ok": False, "error": "server"})


def lambda_handler(event, context):
    """JSON clients get JSON. A plain HTML form post (no scripting) gets a redirect to a result page."""
    res = _handle(event, context)
    ctype = {k.lower(): v for k, v in (event.get("headers") or {}).items()}.get("content-type", "")
    if "application/json" in ctype or res["statusCode"] == 404:
        return res
    ok = res["statusCode"] == 200
    loc = "/backer/report-sent.html" if ok else "/backer/report.html?problem=1"
    return {"statusCode": 303, "headers": {"location": loc, "cache-control": "no-store"}, "body": ""}
