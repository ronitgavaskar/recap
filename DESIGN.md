# Recap -- Design Document

## System architecture

```
                                     +------------------+
                                     |   GitHub API     |
                                     |  (Octokit REST)  |
                                     +--------+---------+
                                              |
                                              | commits, PRs, reviews,
                                              | repo events (last N hours)
                                              v
+----------------+     invoke     +---------------------+
|  EventBridge   +--------------->|   AWS Lambda        |
|  (cron rule)   |                |   (Node.js 20)      |
|                |                |                     |
| MON-FRI 9am   |                |  1. fetchActivity   |
+----------------+                |  2. generateStandup |
                                  |  3. deliver         |
                                  +----------+----------+
                                             |
                                             | Claude API
                                             | (claude-sonnet-4-20250514)
                                             v
                                  +---------------------+
                                  |   Anthropic API     |
                                  |                     |
                                  |  GitHub events -->  |
                                  |  standup summary    |
                                  +----------+----------+
                                             |
                              +--------------+--------------+
                              |                             |
                              v                             v
                   +---------------------+       +---------------------+
                   |   Amazon SES        |       |   Slack Webhook     |
                   |                     |       |                     |
                   |  HTML email with    |       |  Block Kit message  |
                   |  styled standup     |       |  with mrkdwn        |
                   +----------+----------+       +----------+----------+
                              |                             |
                              v                             v
                   +---------------------+       +---------------------+
                   |   Gmail / inbox     |       |   Slack channel     |
                   +---------------------+       +---------------------+
```

### Local CLI flow (alternative)

```
terminal --> src/index.ts --> fetchActivitySince() --> generateStandup() --> console.log
                  |                   |                       |
                  |              GitHub API             Claude API
                  |
             --period flag
          (day | week | sprint)
```

## Technical decisions

### ESM over CommonJS

Octokit v4 is ESM-only. Rather than fighting it with dynamic `import()` hacks or staying on an older Octokit version, we compile to ESM natively:

- `"type": "module"` in `package.json`
- `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`
- All relative imports use `.js` extensions

This keeps the build simple and means `dist/` output runs directly in Node.js 20 and Lambda without bundling.

### Lambda over local cron

A local cron job (`crontab`) works but requires a machine that's always on. Lambda gives us:

- **Zero infrastructure** -- no server to maintain
- **EventBridge scheduling** -- reliable cron with timezone support
- **CloudWatch logs** -- every run is logged automatically
- **Pay-per-use** -- a single daily invocation costs effectively nothing

The tradeoff is added deployment complexity (`scripts/deploy.sh`), but that's a one-time cost.

### SES over SNS for email delivery

We initially used Amazon SNS for email delivery but switched to SES for several reasons:

- **HTML support** -- SNS only sends plain text emails, so markdown formatting (`**bold**`, bullet lists) appeared as raw syntax. SES supports full HTML, allowing styled emails with proper bold text, bullet lists, headers, and footers.
- **Better subject lines** -- SES gives full control over the email subject. We use dynamic subjects like `Standup Update for ronitgavaskar | 2026-04-02 to 2026-04-09` that include the username and date range.
- **No topic management** -- SNS requires creating a topic, subscribing emails, and confirming subscriptions. SES just needs a verified sender address.
- **Production path** -- SES is the standard AWS email service. Moving to production (custom domain, DKIM/SPF, higher sending limits) is straightforward.

The tradeoff: SES sandbox requires verifying both sender and recipient addresses. For solo use this is fine (same address for both). For team use, you'd request SES production access.

### Dual delivery: SES + Slack

Both delivery channels are implemented and run independently:

- **SES (email)** -- HTML-formatted email via Amazon SES. Supports styled bold text, bullet lists, headers, and a metadata line with username/period/date. Best for async consumption and personal record-keeping.
- **Slack (webhook)** -- Block Kit formatted message via incoming webhook. Uses Slack's native `mrkdwn` for bold, bullet points (`•`), and a context block showing the username and period. Best for team visibility.

Both are optional and independent -- if one fails, the other still delivers. Configure either or both via env vars (`SES_SENDER_EMAIL`/`SES_RECIPIENT_EMAIL` for email, `SLACK_WEBHOOK_URL` for Slack). If neither is set, the Lambda still runs and logs to CloudWatch.

### No bundler

We zip `dist/` + `node_modules/` + `package.json` directly. This avoids webpack/esbuild complexity at the cost of a larger deployment package. The zip is under 20MB which is well within Lambda's 50MB limit. If package size becomes a problem, we can add esbuild later.

### Claude model choice

We use `claude-sonnet-4-20250514` because:

- Fast enough for a single standup generation (<5s typical)
- Capable enough to group related activity, infer next steps, and write natural prose
- Cost-effective for daily automated use

## Data flow

### 1. GitHub fetch (`src/github.ts`)

Five data sources, each with independent error handling:

```
fetchActivitySince(octokit, username, since)
  |
  +-- fetchPRsOpened()       GET /search/issues?q=type:pr+author:X+created:>=T
  +-- fetchPRsMerged()       GET /search/issues?q=type:pr+author:X+merged:>=T
  +-- fetchPRReviews()       GET /search/issues?q=type:pr+reviewed-by:X+updated:>=T
  +-- fetchCommits()         GET /users/X/events (find pushed repos) --> GET /repos/O/R/commits
  +-- fetchRepoEvents()      GET /users/X/events  (CreateEvent, IssuesEvent, IssueCommentEvent)
  |
  v
  GitHubEvent[] (sorted newest-first)
    { repo, type, title, url, timestamp }
```

Each function returns `[]` on error so one failing source doesn't break the whole pipeline.

Commits are fetched in two steps: first the Events API identifies repos the user pushed to, then the Repos API fetches actual commit details. This avoids a limitation where the typed Octokit client strips commit data from PushEvent payloads.

### 2. Standup generation (`src/claude.ts`)

```
GitHubEvent[] --> format as text block --> Claude API --> StandupUpdate { summary }
```

- Events are formatted as `- [type] repo: title (url)` lines
- The prompt instructs Claude to write in first person, group related items, and use the three-section format (did / doing / blockers)
- The prompt adapts to the time period ("last 24 hours" vs "last 7 days" vs "last 2 weeks")
- Empty event arrays short-circuit without an API call

### 3. Delivery

**CLI:** `console.log(standup.summary)` -- that's it.

**Lambda:** `console.log` (CloudWatch) + up to two delivery channels, each in its own try/catch:

- **SES** -- markdown is converted to styled HTML (bold headers, bullet lists, metadata line). Sends via `SESClient.send(SendEmailCommand)`. Skipped if `SES_SENDER_EMAIL` or `SES_RECIPIENT_EMAIL` is unset.
- **Slack** -- markdown `**bold**` is converted to Slack `*bold*`, bullets `- ` become `• `. Sends a Block Kit payload (header, context, divider, section) via `fetch` to the incoming webhook URL. Skipped if `SLACK_WEBHOOK_URL` is unset.

## Known limitations

- **GitHub Events API returns max 90 days / 300 events** -- the `--period sprint` option works within this, but very active users might miss older events in a 2-week window
- **Search API rate limits** -- authenticated users get 30 search requests/minute. With 3 search calls per run, this is fine for daily use but could be an issue if invoked rapidly
- **No deduplication** -- a PR that was both opened and merged in the same period will appear twice (as `pr-opened` and `pr-merged`). This is intentional -- both are meaningful standup items -- but could look redundant
- **Commit attribution** -- commits are fetched from repos the user pushed to. In shared repos, this may include commits by other contributors if the Repos API returns them in the time window
- **SES sandbox** -- new SES accounts are in sandbox mode, which requires verifying both sender and recipient email addresses. Request production access for unrestricted sending
- **Single user only** -- the current design fetches activity for one `GITHUB_USERNAME`. Team mode would require per-user configs

## Future roadmap

### Jira / Linear support
Add `src/jira.ts` or `src/linear.ts` to fetch ticket activity (status changes, comments, assignments). Merge with GitHub events before sending to Claude for a more complete standup.

### Web dashboard
Build a simple frontend that shows standup history over time. Store generated standups in DynamoDB (one item per day per user) and serve via API Gateway.

### Team mode
Support multiple users with separate configs. Each user gets their own standup generated and delivered. Could run as a single Lambda that iterates over a user list in DynamoDB, or as separate per-user invocations.

### PR diff summaries
For merged PRs, fetch the diff stats (files changed, insertions, deletions) and include them in the Claude prompt so the standup can reference the scope of changes.
