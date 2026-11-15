#!/usr/bin/env python3
"""Downloads the published Backer releases from GitHub into backer/releases.json.

  python3 backer/fetch_releases.py            writes backer/releases.json
  python3 backer/fetch_releases.py --print    prints the tag names only

backer/build.py reads that file to build /backer/releases.html and /backer/notes.html. Download links come from each
release's own assets (by file type), so renaming an installer needs no change here. Drafts are skipped.
Set GITHUB_TOKEN to raise the API rate limit; the Backer repository is public, so it is not required.
"""
import json, os, sys, urllib.request

REPO = os.environ.get("BACKER_REPO", "howardcrow3/Backer")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "releases.json")

def get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "turtlebox-site"})
    if os.environ.get("GITHUB_TOKEN"):
        req.add_header("Authorization", "Bearer " + os.environ["GITHUB_TOKEN"])
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def main():
    releases, page = [], 1
    while True:
        batch = get(f"https://api.github.com/repos/{REPO}/releases?per_page=100&page={page}")
        releases += batch
        if len(batch) < 100: break
        page += 1
    out = []
    for r in releases:
        if r.get("draft"): continue
        out.append({
            "tag": r["tag_name"], "name": r.get("name") or r["tag_name"], "date": (r.get("published_at") or "")[:10],
            "prerelease": bool(r.get("prerelease")), "body": r.get("body") or "", "url": r["html_url"],
            "assets": [{"name": a["name"], "url": a["browser_download_url"], "size": a["size"]} for a in r.get("assets", [])],
        })
    out.sort(key=lambda r: r["date"], reverse=True)
    if "--print" in sys.argv:
        print("\n".join(r["tag"] for r in out)); return
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"{len(out)} releases written to backer/releases.json")

main()
