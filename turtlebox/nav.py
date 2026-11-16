"""Turtlebox header navigation, shared by turtlebox/build.py, backer/build.py and legal/build.py so every page has the same menu.
Not published (the deploy skips *.py)."""

APPS = [("backer", "Backer"), ("ceevee", "CeeVee"), ("golden", "Golden")]
ACCT_ICON = ('<svg class="acct-icon" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3">'
             '<circle cx="8" cy="5.5" r="2.75"/><path d="M2.5 14c.6-2.9 2.8-4.5 5.5-4.5s4.9 1.6 5.5 4.5"/></svg>')


def nav_links(current="", v="", indent="      "):
    """The links inside <nav>. current is "apps", an app slug or "account"; v is the cache tag for account.js."""
    def cur(p):
        return ' aria-current="page"' if current == p else ""
    rows = [f'<a href="/apps/"{cur("apps")}>Apps</a>']
    rows += [f'<a class="nav-app" href="/{slug}/"{cur(slug)}>{name}</a>' for slug, name in APPS]
    rows.append(f'<a class="acct" href="/account/"{cur("account")} data-acct>{ACCT_ICON}<span class="acct-label">Sign in</span></a>')
    out = ("\n" + indent).join(rows)
    if v:
        out += f'\n{indent}<script src="/assets/account.js?v={v}" defer></script>'
    return out
