# Recap

## What this project is
Recap is an autonomous standup generator. It pulls GitHub activity, 
feeds it to Claude, and posts a formatted standup to Slack. 
Zero user input required.

## Stack
- TypeScript, Node.js
- GitHub REST API (Octokit)
- Anthropic Claude API (claude-sonnet-4-20250514)
- Slack Incoming Webhooks

## Project structure
- src/github.ts — GitHub activity fetching
- src/claude.ts — standup generation via Claude API
- src/slack.ts — Slack posting
- src/index.ts — orchestration entry point
- .env — API keys (never commit this)

## Coding conventions
- Async/await only, no raw promises
- Each module does one thing
- Errors should be explicit and logged clearly
- Keep Claude prompts in claude.ts, not scattered around

## Current focus
Building V1: CLI tool that runs manually and outputs a standup summary