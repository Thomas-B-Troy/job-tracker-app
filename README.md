# Job Tracker

A phone-friendly job search tracker that keeps everything in plain text files in your own
private GitHub repo. When a recruiter or hiring manager calls, search the company name and
get one screen with the role, where you applied, which resume you sent, who you know there,
and your research on the company.

There is no server and no account to sign up for. The app is a static page. It reads your
repo through the GitHub API with a token that stays on your device.

Built by directing an AI coding assistant (Claude Code): I set the requirements, tested it
and found the fixes; the AI wrote the code.

## What it tracks

Based on a job search spreadsheet with three tabs:

- **Roles** (`jobs/`): one Markdown file per job. Status, date applied, channel, contact,
  salary, resume and cover letter file names, what the ad says about training and career
  progression, how your experience lines up, interview prep, and an activity log.
- **Companies** (`companies/`): one file per company. Mission, values, training and
  development, onboarding, benefits, org chart, reviews and staff movement, people you
  know there, green and red flags, and the sources for each.
- **People** (`contacts.yaml`): recruiters, hiring contacts and referrals.
- **Week** (`weekly.yaml`): weekly goals against what you did.

From your phone you can search everything, change a role's status and add a note to its
activity log. Each change is saved as a commit to your repo.

## Try it

Open the app, go to **Settings** and choose **Try it with sample data**. The sample
companies and people are made up.

## Use it with your own data

1. Create a **private** GitHub repo for your tracker. Copy the `sample/` folder's contents
   into it as a starting point (everything except `manifest.json`).
2. Create a fine-grained personal access token: GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens.
   - Repository access: **only** your tracker repo
   - Permissions: **Contents: Read and write** (or read-only if you only want to view)
   - Set an expiry date
3. Open the app, go to **Settings**, enter your GitHub username, repo name and token.
4. On your phone, use "Add to Home Screen" to install it like an app.

You can use the hosted copy of this app or fork this repo and turn on GitHub Pages
(Settings → Pages → deploy from the `main` branch).

## File format

Role files are Markdown with a YAML header. The app shows the header as quick facts and
each `## ` section as a collapsible block:

```markdown
---
company: "Harbourline IT"
company_slug: harbourline-it
role: "Level 1 Service Desk Analyst"
date_applied: "2026-09-15"
status: applied        # lead | drafting | confirm | applied | screening | interviewing | offer | no-response | rejected | withdrawn | not-applied
channel: "SEEK"
contact: "Priya Nair (Team Lead)"
resume_file: "applications/Resume - Service Desk Analyst.docx"
next_action: "Follow up"
next_action_date: "2026-09-26"
---

## Alignment

## Interview prep

## Activity log

- 2026-09-15: Applied.
```

Company files can list warm introduction paths in their header. The app flags them on each
role tile, lists hot leads at the top of the Roles tab, and marks any added since your last visit
as new (with a badge on the home-screen icon where the phone supports it):

```yaml
intros:
  - via: "Sam Cole"          # someone you know
    to: "Priya Nair"         # who they know at the company
    role: "Service Desk Team Lead"
    hot: true                # a direct line to the hiring side
    added: "2026-09-14"
```

See `sample/` for complete examples of every file type.

## Working with an AI assistant

The format is meant to be written by an AI assistant as well as by you. A typical flow:

1. Paste a job ad into Claude Code (or similar) opened in your tracker repo.
2. Ask it to create the role file, research the company (website, reviews, the company's
   LinkedIn page) and fill in the company file with a source for every claim.
3. Ask it to fill the Alignment section from your real work history, and to state gaps
   plainly instead of inventing experience.
4. Review, commit, push. It's on your phone straight away.

## Security and privacy

- Your data lives in your private repo. This app's repo holds only code and fictional
  sample data.
- The token is stored in your browser's local storage on that device and is sent only to
  `api.github.com`. Use **Remove token and cached data** in Settings on a shared device.
- Use a fine-grained token limited to one repo, with an expiry. Never a classic token.
- A strict Content Security Policy only allows the page to talk to itself and
  `api.github.com`. All libraries are vendored and pinned (no third-party CDN at runtime).
- Everything rendered from Markdown goes through DOMPurify, so research pasted from web
  pages can't run scripts in the app.

## Libraries

[js-yaml](https://github.com/nodeca/js-yaml) 4.1.0, [marked](https://github.com/markedjs/marked)
12.0.2, [DOMPurify](https://github.com/cure53/DOMPurify) 3.1.6. All MIT or Apache-2.0 licensed.

## Licence

MIT
