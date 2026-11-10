# Backer "Report an issue" → GitHub

The form at `turtlebox.studio/backer/report.html` posts to `/api/report`. A small Lambda (`lambda/report.py`) creates an issue in a **private** GitHub repository. Visitors never see the repository or the token.

## What you do (the token stays with you)

1. **Make a private repo** for reports, for example `yourname/backer-reports`. The function refuses to post if the repo is public.
2. **Create a fine-grained personal access token** (GitHub → Settings → Developer settings → Fine-grained tokens):
   - Repository access: only that one repo
   - Permissions: Issues → Read and write (Metadata read is added automatically)
   - Set an expiry and put the date in your calendar. When it expires, new reports fail with a 502 until you replace it.
3. **Store it in AWS yourself** (replace the placeholder; do not paste the token into chat, a workflow or a file):
   ```
   aws ssm put-parameter --region us-east-2 --name /backer/github-issues-token \
     --type SecureString --overwrite --value 'PASTE_TOKEN_HERE'
   ```
4. In the GitHub repo `highturtle`, add a repository **variable** `REPORT_REPO` = `yourname/backer-reports`, then run the workflow **Backer report endpoint setup (one time)**.
5. Create a label named `user-report` in the reports repo (optional; GitHub creates it if missing).

## What it does

- Accepts summary (120), details (3000), steps (2000), platform, version, NAS, optional email.
- Free text is quoted and escaped so reports cannot ping people, close issues or inject links.
- Hidden honeypot field; 5 reports per network per hour; 100 per day overall.
- Returns the issue number as the reference shown to the visitor. The email, if given, is only written into the private issue.
- Browsers without scripting get a normal form post and a redirect to `report-sent.html`.

## Test

Run the workflow, then submit a report on the live page. An issue titled `[Report] …` should appear in the reports repo.
