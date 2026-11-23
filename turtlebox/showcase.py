"""Screenshot galleries and grouped feature lists for the app pages, shared by turtlebox/build.py (CeeVee, Golden)
and backer/build.py (Backer). Not published (the deploy skips *.py).

Screenshots live in turtlebox/assets/screens/. They show sample data with made-up names, never a real person's data."""

import html


def e(s):
    return html.escape(s, quote=True)


SIZES = {  # width, height of each file, so the browser can reserve space before the image loads
    "backer-jobs": (1200, 760), "backer-run": (1200, 760),
}
for _k in ["ceevee-jobs", "ceevee-documents", "ceevee-inbox", "ceevee-applications",
           "golden-overview", "golden-plan", "golden-whatif", "golden-retirewhen", "golden-ss", "golden-sankey", "golden-roth",
           "golden-transactions"]:
    SIZES[_k] = (1600, 1000)

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
        ("golden-overview", "Golden's Overview with a getting-started checklist, this month's income, spending and savings, and net worth by account.",
         "Your household at a glance: what came in this month, what you kept, and what you're worth."),
        ("golden-plan", "Golden's retirement plan: an 86% chance the money lasts to 95, a fan chart of outcomes and a histogram of final balances.",
         "The chance your money lasts, with the range of good and rough outcomes."),
        ("golden-whatif", "Golden's What if screen showing the plan dropping from 86% to 79% if one partner retires at 60.",
         "Ask “what if” in plain words and see the plan before and after the change."),
        ("golden-retirewhen", "Golden's safe spending and earliest retirement age results, with the chance of success at each age.",
         "How much you could spend each year, and the earliest age you could retire."),
        ("golden-ss", "Golden's Social Security table comparing claiming at 62, 64, 67 and 70, with break-even ages.",
         "Compare Social Security claiming ages, and see when waiting pays off."),
        ("golden-sankey", "Golden's flow chart of where a year's money goes, with heads-ups and milestones below it.",
         "Where the money goes in each year of the plan, and the milestones along the way."),
        ("golden-roth", "Golden's Roth conversion table comparing no conversions with three conversion strategies.",
         "Compare Roth conversion strategies by tax paid, what's left for heirs and the chance the plan works."),
        ("golden-transactions", "Golden's Transactions list with dates, payees, accounts, amounts and categories.",
         "Every transaction from your statements, sorted into categories you can fix in one click."),
    ],
}

CAROUSEL_JS = """<script>
(function () {
  document.querySelectorAll('[data-carousel]').forEach(function (root) {
    var track = root.querySelector('.car-track'), slides = track.children, n = slides.length;
    var prev = root.querySelector('[data-car-prev]'), next = root.querySelector('[data-car-next]');
    var dots = root.querySelectorAll('[data-car-dot]'), count = root.querySelector('[data-car-count]');
    root.classList.add('car-js');
    function current() { return Math.round(track.scrollLeft / track.clientWidth); }
    function go(i) { i = Math.max(0, Math.min(n - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); }
    function sync() {
      var i = current();
      prev.disabled = i === 0; next.disabled = i === n - 1;
      dots.forEach(function (d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
      if (count) count.textContent = (i + 1) + ' of ' + n;
      for (var k = 0; k < n; k++) slides[k].setAttribute('aria-hidden', k === i ? 'false' : 'true');
    }
    prev.addEventListener('click', function () { go(current() - 1); });
    next.addEventListener('click', function () { go(current() + 1); });
    dots.forEach(function (d, k) { d.addEventListener('click', function () { go(k); }); });
    track.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { ev.preventDefault(); go(current() + 1); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(current() - 1); }
    });
    var t; track.addEventListener('scroll', function () { clearTimeout(t); t = setTimeout(sync, 60); });
    window.addEventListener('resize', sync);
    sync();
  });
})();
</script>"""


def gallery(slug, name, heading_id="screens-h"):
    """A screenshot carousel: one screen at a time with its caption, big arrows on each side, dots and a count. Without JavaScript it
    is a row you can scroll sideways. Each image links to the full-size file."""
    shots = SCREENS[slug]
    slides = []
    for i, (key, alt, cap) in enumerate(shots):
        w, h = SIZES[key]
        lazy = "" if i == 0 else ' loading="lazy"'
        slides.append(
            f'<li class="car-slide"><figure class="shot">'
            f'<a class="shot-link" href="/assets/screens/{key}.webp">'
            f'<img src="/assets/screens/{key}.webp" width="{w}" height="{h}" alt="{e(alt)}"{lazy} decoding="async"></a>'
            f'<figcaption>{e(cap)}</figcaption></figure></li>')
    dots = "".join(f'<button type="button" class="car-dot" data-car-dot aria-label="Screen {i + 1}: {e(c)}"></button>'
                   for i, (_, _, c) in enumerate(shots))
    chev = '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></svg>'
    prev = f'<button type="button" class="car-side car-side-prev" data-car-prev aria-label="Previous screen">{chev.format(d="M15 5l-7 7 7 7")}</button>'
    nxt = f'<button type="button" class="car-side car-side-next" data-car-next aria-label="Next screen">{chev.format(d="M9 5l7 7-7 7")}</button>'
    return f"""  <section class="section shots-section" aria-labelledby="{heading_id}">
    <div class="wrap">
      <div class="car" data-carousel role="region" aria-roledescription="carousel" aria-labelledby="{heading_id}">
        <div class="car-head">
          <h2 id="{heading_id}">See {e(name)}</h2>
          <p class="car-count num" data-car-count aria-live="polite">{len(shots)} screens</p>
        </div>
        <div class="car-stage">
          <ol class="car-track" tabindex="0" aria-label="{e(name)} screenshots">
            {"".join(slides)}
          </ol>
          {prev}{nxt}
        </div>
        <div class="car-foot"><div class="car-dots">{dots}</div><p class="fine">Screens shown with sample data.</p></div>
      </div>
    </div>
  </section>
{CAROUSEL_JS}"""


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
