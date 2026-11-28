"""Shared business details for the High Turtle and Turtlebox sites (Paddle website requirements).

Values come from legal/config.json. An empty value renders as a highlighted [placeholder] so it is
obvious on the page and easy to find: run `python3 legal/build.py --check` to list what is still missing.
"""
import html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json")))

TODO_STYLE = "background:#ffe08a;color:#1c1c1c;padding:0 .25em;border-radius:2px"

LABELS = {
    "legal_name": "Legal business name",
    "address": "Registered business address",
    "governing_law": "Governing law, e.g. the State of X, USA",
    "refund_days": "Refund window: 14 to 90",
}

SITES = {
    "highturtle": {"brand": "High Turtle", "domain": "highturtle.com", "email_key": "highturtle_email"},
    "turtlebox": {"brand": "Turtlebox", "domain": "turtlebox.studio", "email_key": "turtlebox_email"},
}


def todo(label):
    return f'<span class="todo" style="{TODO_STYLE}">[{html.escape(label)}]</span>'


def v(key):
    """A config value as HTML, or a visible placeholder when it is not filled in yet."""
    val = str(CFG.get(key, "")).strip()
    if key == "refund_days" and val:
        if not val.isdigit() or not 14 <= int(val) <= 90:
            raise SystemExit("legal/config.json: refund_days must be a whole number from 14 to 90 (Paddle's range)")
    return html.escape(val) if val else todo(LABELS.get(key, key))


def email(site):
    e = CFG[SITES[site]["email_key"]]
    return f'<a href="mailto:{html.escape(e)}">{html.escape(e)}</a>'


def policy_links():
    return ('<a href="/terms.html">Terms</a> &middot; <a href="/refund.html">Refunds</a> &middot; '
            '<a href="/privacy.html">Privacy</a> &middot; <a href="/contact.html">Contact</a>')


def legal_line(site):
    brand = SITES[site]["brand"]
    return f"&copy; 2026 {v('legal_name')}. {brand} is a trading name of {v('legal_name')}."


PADDLE_FOOTNOTE = ('<p class="fine paddle-note">Checkout and payment are processed by Paddle.com, our Merchant of Record, '
                   'which also handles billing questions, sales tax and refunds.</p>')


def footer_block(site):
    """The policy links and legal name that every footer carries."""
    return (f'<!-- legal:footer -->\n      <p class="legal-links">{policy_links()}</p>\n'
            f'      <p>{legal_line(site)}</p>\n      <!-- /legal:footer -->')


def replace_footer_block(text, site):
    return re.sub(r"<!-- legal:footer -->.*?<!-- /legal:footer -->", lambda m: footer_block(site), text, flags=re.S)
