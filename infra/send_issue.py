#!/usr/bin/env python3
"""Send a High Turtle issue written in Markdown.

  python3 infra/send_issue.py issues/2026-11-05-first.md --test you@example.com
  python3 infra/send_issue.py issues/2026-11-05-first.md --send

The file starts with a front matter block:
  ---
  subject: The subject line
  ---
Each recipient gets their own signed unsubscribe link and the one-click List-Unsubscribe headers.
A real send needs "postal_address" set in infra/mail-config.json (a legal requirement for marketing email).
"""
import argparse
import hashlib
import hmac
import html
import json
import os
import sys
import time
from urllib.parse import quote

import boto3
import markdown

cfg = json.load(open(os.path.join(os.path.dirname(__file__), "mail-config.json")))
ses = boto3.client("sesv2", region_name=cfg["region"])


def sign(secret, email):
    return hmac.new(secret.encode(), ("unsub:" + email).encode(), hashlib.sha256).hexdigest()[:32]


def load(path):
    raw = open(path, encoding="utf-8").read()
    if not raw.startswith("---"):
        sys.exit("The file needs a front matter block with a subject.")
    _, fm, body = raw.split("---", 2)
    meta = {}
    for line in fm.strip().splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    if not meta.get("subject"):
        sys.exit("The front matter needs a subject.")
    return meta, body.strip()


def render(body_md, unsub, address):
    body = markdown.markdown(body_md, extensions=["extra", "sane_lists"])
    addr = html.escape(cfg["postal_address"] or address).replace("\n", "<br>")
    page = f"""<!doctype html><html><body style="margin:0;background:#f6f6f5">
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:17px;line-height:1.6;color:#2e3033;max-width:36rem;margin:0 auto;padding:32px 20px">
{body}
<hr style="border:0;border-top:1px solid #d6d6d3;margin:40px 0 20px">
<p style="font-size:13px;line-height:1.6;color:#66686b">You are getting this because you joined the High Turtle list.<br>
<a href="{unsub}" style="color:#2f5c8f">Unsubscribe</a><br>{addr}</p>
</div></body></html>"""
    text = markdown_to_text(body_md) + f"\n\n--\nYou are getting this because you joined the High Turtle list.\nUnsubscribe: {unsub}\n{cfg['postal_address'] or address}\n"
    return page, text


def markdown_to_text(md):
    return md  # Markdown reads fine as plain text


def send(to, subject, page, text, unsub):
    ses.send_email(
        FromEmailAddress=cfg["from"],
        Destination={"ToAddresses": [to]},
        ConfigurationSetName=cfg["configuration_set"],
        Content={"Simple": {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Html": {"Data": page, "Charset": "UTF-8"}, "Text": {"Data": text, "Charset": "UTF-8"}},
            "Headers": [
                {"Name": "List-Unsubscribe", "Value": f"<{unsub}>"},
                {"Name": "List-Unsubscribe-Post", "Value": "List-Unsubscribe=One-Click"},
            ],
        }},
    )


def subscribers():
    token = None
    while True:
        kw = {"ContactListName": cfg["contact_list"], "PageSize": 100}
        if token:
            kw["NextToken"] = token
        r = ses.list_contacts(**kw)
        for c in r["Contacts"]:
            if not c.get("UnsubscribeAll"):
                yield c["EmailAddress"].lower()
        token = r.get("NextToken")
        if not token:
            return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--test", metavar="ADDRESS")
    g.add_argument("--send", action="store_true")
    a = ap.parse_args()
    secret = os.environ.get("UNSUBSCRIBE_SECRET", "")
    if not secret:
        sys.exit("UNSUBSCRIBE_SECRET is not set.")
    meta, body = load(a.file)
    placeholder = "(add your postal address in infra/mail-config.json)"

    def one(to, subject):
        unsub = f"{cfg['site']}/api/unsubscribe?e={quote(to)}&s={sign(secret, to)}"
        page, text = render(body, unsub, placeholder)
        send(to, subject, page, text, unsub)

    if a.test:
        one(a.test.lower(), "[Test] " + meta["subject"])
        print("test sent to", a.test)
        return
    if not cfg["postal_address"].strip():
        sys.exit("Set postal_address in infra/mail-config.json before sending to the list.")
    rate = float(ses.get_account()["SendQuota"]["MaxSendRate"])
    sent = failed = 0
    for to in subscribers():
        try:
            one(to, meta["subject"])
            sent += 1
        except Exception as e:
            failed += 1
            print("failed", to, type(e).__name__)
        time.sleep(1.0 / max(rate, 1.0))
    print(f"sent {sent}, failed {failed}")
    if failed:
        sys.exit(1)


main()
