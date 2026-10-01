# Job Tracker

A phone-friendly job search tracker that keeps everything in plain text files in your own
private GitHub repo. When a recruiter or hiring manager calls, search the company name and
get one screen with the role, where you applied, which resume you sent, who you know there,
and your research on the company.

There is no server and no account to sign up for. The app is a static page. It reads your
repo through the GitHub API with a token that stays on your device.

Built by directing an AI coding assistant (Claude Code): I set the requirements, tested it
and found the fixes; the AI wrote the code.

**Live app:** [thomas-troy.com/job-tracker-app](https://thomas-troy.com/job-tracker-app/)
(choose "Look around with sample data").

## What it tracks

Based on a job search spreadsheet with three tabs:

- **Roles** (`jobs/`): one Markdown file per job. Status, date applied, channel, contact,
  salary, resume and cover letter file names, what the ad says about training and career
  progression, how your experience lines up, interview prep, and an activity log.
- **Companies** (`companies/`): one file per company. Mission, values, training and
  development, onboarding, benefits, org chart, reviews and staff movement, people you
  know there, green and red flags, and the sources for each.
- **People** (`contacts.yaml`): recruiters, hiring contacts and referrals.
- **Progress**: weekly activity worked out from your files (applications, research, follow-ups, responses, interviews, warm intros), with optional goals and reflections in `weekly.yaml`.

From your phone you can search everything, change a role's status and add a note to its
activity log. Each change is saved as a commit to your repo.

## Try it

Open the app and choose **Look around with sample data**. The sample companies and people
are made up.

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
interview_at: "2026-10-01 15:30"   # optional: Brisbane time, "YYYY-MM-DD HH:MM" or just "YYYY-MM-DD"
interview_with: "Head of IT"       # optional
interview_format: "1 hour"         # optional, e.g. "video call" or "on site"
---

## Alignment

## Interview prep

## Activity log

- 2026-09-15: Applied.
```

Company files can list warm introduction paths in their header. The app flags them on each
role tile, lists hot leads near the top of the Roles tab (below interviews), and marks any added since your last visit
as new (with a badge on the home-screen icon where the phone supports it):

```yaml
intros:
  - via: "Sam Cole"          # someone you know
    to: "Priya Nair"         # who they know at the company
    role: "Service Desk Team Lead"
    hot: true                # a direct line to the hiring side
    added: "2026-09-14"
```

### Interviews

Add `interview_at` to a role when an interview is booked. The time is read as Brisbane time
(no daylight saving), and the time part can be left off. `interview_with` and
`interview_format` are optional and shown on the card. The free-text `interview_stage` field
still works for notes, but only `interview_at` drives the behaviour below.

- **Upcoming:** an **Interviews** band sits at the very top of the Roles tab, above hot
  leads, with a countdown ("Today 3:30 pm, in 4h", "Tomorrow", "Sat 3 Oct, 10:00 am (in 3
  days)"). Today's interview is highlighted, and the role's tile carries the same banner.
- **Ranking:** role tiles are ordered by urgency: interview today or tomorrow, later
  interviews, roles in `interviewing` or `screening`, offers, then everything else.
- **Awaiting outcome:** 90 minutes after the start time, the role moves to an **Awaiting
  outcome** band. It shows when you interviewed and what to do next: "Send a thank-you note"
  for the first two days (cleared by an activity log line since the interview that mentions
  "thank"), "Waiting to hear back", then an amber "time to chase" after 7 days. It stays
  there until you change the status (offer, rejected, no-response and so on).
- **Overdue actions:** a `next_action_date` in the past shows an "overdue" marker. A next
  action is hidden when an interview is still to come and its date has passed, or when it is
  dated on or before an interview that has now happened, because the interview replaces it.

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

## How I built it

**The problem.** I'm moving into IT after 20 years in sales, account management and
training, and applying for a lot of roles. My career advisor gave me a spreadsheet for
tracking applications, networking and weekly progress. It worked at a desk, but when an
employer rang I needed the role, the company and the people involved on my phone in
seconds.

**What I decided.**
- No server and no database to look after. My data stays in a private GitHub repo I already
  had; the app is a static page that reads it.
- Plain text files (Markdown and YAML), so I can read and edit them myself and an AI
  assistant can do the research and write it straight into the right place.
- Security first, because the repo holds my resumes and contacts: a fine-grained token
  limited to one repo, a strict Content Security Policy, and sanitised rendering.
- Kept the spreadsheet's structure (roles, networking, weekly tracker), then added what I
  found I needed: warm intro flags, a hot leads list, and progress worked out from the
  activity I already log.

**How the work split.** I wrote the requirements, reviewed every change, tested it on my
iPhone and PC, and found the bugs (for example, the installed iPhone app not picking up new
versions, which led to the update check on reopen). Claude Code wrote the code and did the
company research I asked for, which I checked before it went into my tracker.

**What I learned.** How GitHub Pages, fine-grained tokens and the GitHub API fit together,
how a service worker caches an app for offline use, and why that cache needs a way to let
updates through.

## Libraries

[js-yaml](https://github.com/nodeca/js-yaml) 4.1.0, [marked](https://github.com/markedjs/marked)
12.0.2, [DOMPurify](https://github.com/cure53/DOMPurify) 3.1.6. All MIT or Apache-2.0 licensed.

## Licence

MIT
