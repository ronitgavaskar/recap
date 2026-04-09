import "dotenv/config";
import { Octokit } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import { fetchLast24HoursActivity } from "./github";
import { generateStandup } from "./claude";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const githubToken = requireEnv("GITHUB_TOKEN");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const githubUsername = requireEnv("GITHUB_USERNAME");

  const octokit = new Octokit({ auth: githubToken });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const events = await fetchLast24HoursActivity(octokit, githubUsername);
  const standup = await generateStandup(anthropic, events);

  console.log("\n📋 Your standup for today:\n");
  console.log(standup.summary);
}

main().catch((err) => {
  console.error("Recap failed:", err);
  process.exit(1);
});
