# Hosting the Backer pages (part of turtlebox.studio)

The pages live at `https://turtlebox.studio/backer/` and ship with the Turtlebox site. They are light-only.

| Page | Path |
|---|---|
| Download | `/backer/` |
| After purchase | `/backer/thanks.html` (set this as the FastSpring return URL) |
| Report an issue | `/backer/report.html` |
| Report received | `/backer/report-sent.html` |

## How they are built

`backer/build.py` fills in `backer/config.json` and writes the pages into `turtlebox/backer/`, plus `turtlebox/assets/backer.css` and the self-hosted fonts. The deploy workflow runs it automatically. **It writes nothing until all four values are filled in**, so placeholder pages never go live.

```json
{ "base_url": "https://<update-host>/backer", "fastspring_url": "https://…", "support_email": "…", "company": "…" }
```

`base_url` is where the release pipeline serves `latest.json` and `download/…`. This site only links there and reads `latest.json`.

## Steps, in order

1. Fill in `backer/config.json` and commit. Pushing to `main` deploys (workflow *Deploy turtlebox.studio*).
2. **CORS on the update host.** The version number is fetched from `latest.json` by the page, so the update host must allow `https://turtlebox.studio`: add `Access-Control-Allow-Origin: https://turtlebox.studio` (GET) on `latest.json` in its CloudFront response headers policy or S3 CORS rules. Without it the version simply stays hidden; nothing breaks.
3. Set FastSpring's return URL to `https://turtlebox.studio/backer/thanks.html`.
4. Send your real icon files; replace `backer/icon-placeholder.svg` (and add a card to `turtlebox/apps.json` if you want Backer listed on the Apps page).
5. Report endpoint: follow `backer/REPORT.md`.

Nothing here touches the `/backer/` prefix of the update bucket or any signing key.
