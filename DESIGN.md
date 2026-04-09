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
                                  |  3. publish to SNS  |
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
                                  +---------------------+
                                             |
                                             | formatted standup text
                                             v
                                  +---------------------+
                                  |   Amazon SNS        |
                                  |                     |
                                  |  Topic: recap-      |
                                  |  standup-email      |
                                  +----------+----------+
                                             |
                                             | email (SMTP)
                                             v
                                  +---------------------+
                                  |   Gmail / inbox     |
                                  +---------------------+
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

### SNS over Slack (for now)

Slack integration (`src/slack.ts`) is scaffolded but not wired up in V1. We chose SNS + email for initial delivery because:

- **No Slack app setup required** -- SNS email subscriptions are simpler to configure
- **Works for solo use** -- standups go to your inbox, no shared workspace needed
- **Slack is next** -- the module exists and will be connected when team features are added

### No bundler

We zip `dist/` + `node_modules/` + `package.json` directly. This avoids webpack/esbuild complexity at the cost of a larger deployment package. The zip is under 20MB which is well within Lambda's 50MB limit. If package size becomes a problem, we can add esbuild later.

### Claude model choice

We use `claude-sonnet-4-20250514` because:

- Fast enough for a single standup generation (<5s typical)
- Capable enough to group related activity, infer next steps, and write natural prose
- Cost-effective for daily automated use

## Data flow

### 1. GitHub fetch (`src/github.ts`)

Four parallel-ish data sources, each with independent error handling:

```
fetchActivitySince(octokit, username, since)
  |
  +-- fetchPRsOpened()       GET /search/issues?q=type:pr+author:X+created:>=T
  +-- fetchPRsMerged()       GET /search/issues?q=type:pr+author:X+merged:>=T
  +-- fetchPRReviews()       GET /search/issues?q=type:pr+reviewed-by:X+updated:>=T
  +-- fetchRepoEvents()      GET /users/X/events  (PushEvent, CreateEvent, IssuesEvent, IssueCommentEvent)
  |
  v
  GitHubEvent[] (sorted newest-first)
    { repo, type, title, url, timestamp }
```

Each function returns `[]` on error so one failing source doesn't break the whole pipeline.

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

**Lambda:** `console.log` (CloudWatch) + `SNS.publish` (email). SNS is optional -- if `SNS_TOPIC_ARN` is unset, the Lambda runs successfully and just logs.

## Known limitations

- **GitHub Events API returns max 90 days / 300 events** -- the `--period sprint` option works within this, but very active users might miss older events in a 2-week window
- **Search API rate limits** -- authenticated users get 30 search requests/minute. With 3 search calls per run, this is fine for daily use but could be an issue if invoked rapidly
- **No deduplication** -- a PR that was both opened and merged in the same period will appear twice (as `pr-opened` and `pr-merged`). This is intentional -- both are meaningful standup items -- but could look redundant
- **Commit attribution** -- the Events API only shows pushes by the authenticated user. Commits authored by the user but pushed by someone else (e.g., merge commits) won't appear
- **SNS email formatting** -- SNS emails are plain text. Markdown formatting (`**bold**`) appears as-is in email clients. Rich HTML email would require SES instead of SNS
- **Single user only** -- the current design fetches activity for one `GITHUB_USERNAME`. Team mode would require per-user configs

## Future roadmap

### Slack integration
Wire up `src/slack.ts` to post standups to a Slack channel via incoming webhook. Add `SLACK_WEBHOOK_URL` to the Lambda env vars and post alongside (or instead of) SNS.

### Jira / Linear support
Add `src/jira.ts` or `src/linear.ts` to fetch ticket activity (status changes, comments, assignments). Merge with GitHub events before sending to Claude for a more complete standup.

### Web dashboard
Build a simple frontend that shows standup history over time. Store generated standups in DynamoDB (one item per day per user) and serve via API Gateway.

### Team mode
Support multiple users with separate configs. Each user gets their own standup generated and delivered. Could run as a single Lambda that iterates over a user list in DynamoDB, or as separate per-user invocations.

### Rich email via SES
Replace SNS with Amazon SES for HTML email delivery. Render the Markdown standup as styled HTML with proper formatting, links, and maybe a header with the date and period.

### PR diff summaries
For merged PRs, fetch the diff stats (files changed, insertions, deletions) and include them in the Claude prompt so the standup can reference the scope of changes.
