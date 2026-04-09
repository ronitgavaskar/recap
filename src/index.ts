import "dotenv/config";
import { Octokit } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import { fetchActivitySince } from "./github.js";
import { generateStandup } from "./claude.js";

type Period = "day" | "week" | "sprint";

const PERIOD_CONFIG: Record<Period, { ms: number; label: string }> = {
  day:    { ms: 24 * 60 * 60 * 1000,      label: "last 24 hours" },
  week:   { ms: 7 * 24 * 60 * 60 * 1000,  label: "last 7 days" },
  sprint: { ms: 14 * 24 * 60 * 60 * 1000, label: "last 2 weeks (sprint)" },
};

function parsePeriod(args: string[]): Period {
  const idx = args.indexOf("--period");
  if (idx === -1) return "day";

  const value = args[idx + 1];
  if (!value || !(value in PERIOD_CONFIG)) {
    console.error(`Invalid --period value: "${value}". Must be one of: day, week, sprint`);
    process.exit(1);
  }
  return value as Period;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const period = parsePeriod(process.argv.slice(2));
  const { ms, label } = PERIOD_CONFIG[period];

  const githubToken = requireEnv("GITHUB_TOKEN");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const githubUsername = requireEnv("GITHUB_USERNAME");

  const octokit = new Octokit({ auth: githubToken });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const since = new Date(Date.now() - ms).toISOString();
  const events = await fetchActivitySince(octokit, githubUsername, since);
  const standup = await generateStandup(anthropic, events, label);

  console.log(`\n📋 Your standup (${label}):\n`);
  console.log(standup.summary);
}

main().catch((err) => {
  console.error("Recap failed:", err);
  process.exit(1);
});
