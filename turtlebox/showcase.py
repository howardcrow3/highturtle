"""Screenshot galleries and grouped feature lists for the app pages, shared by turtlebox/build.py (CeeVee, Golden)
and backer/build.py (Backer). Not published (the deploy skips *.py).

Screenshots live in turtlebox/assets/screens/. They show sample data with made-up names, never a real person's data."""

import html


def e(s):
    return html.escape(s, quote=True)


SIZES = {  # width, height of each file, so the browser can reserve space before the image loads
    "backer-jobs": (1200, 760), "backer-run": (1200, 760),
    "ceevee-jobs": (1600, 1000), "ceevee-documents": (1600, 1000), "ceevee-inbox": (1600, 1000), "ceevee-applications": (1600, 1000),
    "golden-overview": (1600, 1000), "golden-plan": (1600, 1000), "golden-transactions": (1600, 1000), "golden-whatif": (1600, 650),
}

SCREENS = {
    "backer": [
        ("backer-jobs", "Backer's Jobs screen listing four backup jobs with their status, schedule and next run.",
         "Every backup job on one screen: what it copies, when it runs next, and whether it needs you."),
        ("backer-run", "A Backer run summary with counts of copied, unchanged, skipped and excluded files and two items that need attention.",
         "After each run, a plain summary of what was copied and anything Backer couldn't copy, with the reason."),
    ],
    "ceevee": [
        ("ceevee-jobs", "CeeVee's Jobs screen listing six matching jobs with a match score and people you know at each company.",
         "New jobs from your searches, scored against your profile, with the people you know there."),
        ("ceevee-documents", "A cover letter open in CeeVee's document editor with save, undo, redo and an Ask for a change box.",
         "A resume and cover letter for each job. Edit them yourself or ask for a change in plain words."),
        ("ceevee-inbox", "CeeVee's Inbox showing an employer's interview request and a drafted reply.",
         "Replies from employers, linked to the right application, with an answer drafted for you."),
        ("ceevee-applications", "CeeVee's Applications screen with items waiting for approval, a draft and sent applications.",
         "Nothing is sent until you approve it."),
    ],
    "golden": [
        ("golden-overview", "Golden's Overview showing a monthly spending budget, net worth with each account, and where the household is headed.",
         "Your household at a glance: budget, net worth and where you're headed."),
        ("golden-plan", "Golden's retirement plan showing an 86% chance the money lasts to 95 and the assumptions behind it.",
         "The chance your money lasts, and every assumption behind it."),
        ("golden-whatif", "Golden's What if screen comparing the plan now with the plan if one partner retires at 60.",
         "Ask “what if” in plain words and see the plan with and without the change."),
        ("golden-transactions", "Golden's Transactions list with dates, payees, accounts, amounts and categories.",
         "Every transaction from your statements, sorted into categories that you can fix in one click."),
    ],
}


def gallery(slug, name, heading_id="screens-h"):
    """A screenshot section: the first shot large, the rest in a row below it (two shots sit side by side)."""
    shots = SCREENS[slug]

    def fig(i, key, alt, cap):
        w, h = SIZES[key]
        lazy = "" if i == 0 else ' loading="lazy"'
        return (f'<figure class="shot{" shot-lead" if i == 0 else ""}">'
                f'<a class="shot-link" href="/assets/screens/{key}.webp">'  # opens the full-size image, for small screens
                f'<img src="/assets/screens/{key}.webp" width="{w}" height="{h}" alt="{e(alt)}"{lazy} decoding="async"></a>'
                f'<figcaption>{e(cap)}</figcaption></figure>')

    figs = [fig(i, *s) for i, s in enumerate(shots)]
    if len(figs) == 2:  # two shots sit side by side, with no lead
        figs = [fig(1, *s) for s in shots]
        lead, rest, cls = "", "\n        ".join(figs), "shots-rest shots-rest-2"
    else:
        lead, rest, cls = figs[0], "\n        ".join(figs[1:]), f"shots-rest shots-rest-{len(figs) - 1}"
    return f"""  <section class="section shots-section" aria-labelledby="{heading_id}">
    <div class="wrap">
      <h2 id="{heading_id}">See {e(name)}</h2>
      {lead}
      <div class="{cls}">
        {rest}
      </div>
      <p class="fine shots-note">Screens shown with sample data.</p>
    </div>
  </section>"""


def feature_groups(groups, indent="      "):
    """groups: list of (group title, [(feature title, description), ...]). Text is plain and gets escaped."""
    out = []
    for title, items in groups:
        lis = "".join(f'<li><h4>{e(t)}</h4><p>{e(d)}</p></li>' for t, d in items)
        out.append(f'<div class="fgroup"><h3>{e(title)}</h3><ul>{lis}</ul></div>')
    return f'<div class="fgroups">\n{indent}  ' + f"\n{indent}  ".join(out) + f"\n{indent}</div>"


BACKER_FEATURES = [
    ("Backing up", [
        ("To a NAS you own", "Copies to a shared folder on a Synology or any other NAS over SMB or NFS. No cloud and no account."),
        ("On a schedule or on demand", "Daily, weekly or every few hours. If your computer was asleep, Backer catches up when it wakes."),
        ("Big libraries", "Handles 100,000+ files and copies only what is new or changed, so later runs are quick."),
        ("Only what you want", "Leave out files over a size limit, and skip system junk such as thumbnails and temporary files."),
    ]),
    ("Keeping copies safe", [
        ("Checked as it copies", "Each file is written to a temporary name, checked against your original, and only then given its real name."),
        ("Never deletes without asking", "When you delete something on your computer, Backer lists it under Deleted files and waits for you to decide."),
        ("The right place every time", "Backer marks the backup folder on the NAS, so it won't write into the wrong share if a drive changes."),
        ("Verify", "Compares what is on the NAS with your originals, so you know every photo and video arrived intact."),
    ]),
    ("Day to day", [
        ("Clear run summaries", "See what was copied, what was skipped and why, for each folder. Export the log as a CSV file."),
        ("Browse and restore", "Find a file in your backup and copy it back. Restore keeps working even after the trial ends."),
        ("Stays out of the way", "Lives in the menu bar on a Mac and in the system tray on Windows."),
        ("Optional AI assistant integration", "A local MCP server lets an AI assistant you approve check on Backer. It is off by default."),
    ]),
]
