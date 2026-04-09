---
name: Recap project overview
description: Recap is an autonomous standup generator pulling GitHub activity, summarizing via Claude, posting to Slack
type: project
---

Recap V1 is a CLI tool that fetches the user's last 24h of GitHub activity, sends it to Claude (claude-sonnet-4-20250514) for summarization into a standup format, and posts it to Slack via incoming webhook.

**Why:** Zero-input daily standups — the user wants fully automated standup generation.

**How to apply:** All work should target the pipeline: GitHub fetch → Claude summarize → Slack post. Keep modules single-responsibility per CLAUDE.md conventions.
