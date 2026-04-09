import { Octokit } from "octokit";
import Anthropic from "@anthropic-ai/sdk";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { fetchActivitySince } from "./github.js";
import { generateStandup } from "./claude.js";

type Period = "day" | "week" | "sprint";

const PERIOD_CONFIG: Record<Period, { ms: number; label: string }> = {
  day:    { ms: 24 * 60 * 60 * 1000,      label: "last 24 hours" },
  week:   { ms: 7 * 24 * 60 * 60 * 1000,  label: "last 7 days" },
  sprint: { ms: 14 * 24 * 60 * 60 * 1000, label: "last 2 weeks (sprint)" },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

interface LambdaEvent {
  period?: string;
}

export async function handler(event: LambdaEvent = {}): Promise<{ statusCode: number; body: string }> {
  const periodKey = (event.period ?? "day") as Period;
  const config = PERIOD_CONFIG[periodKey];
  if (!config) {
    return { statusCode: 400, body: `Invalid period: "${event.period}". Must be one of: day, week, sprint` };
  }

  const githubToken = requireEnv("GITHUB_TOKEN");
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");
  const githubUsername = requireEnv("GITHUB_USERNAME");

  const octokit = new Octokit({ auth: githubToken });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const since = new Date(Date.now() - config.ms).toISOString();
  const events = await fetchActivitySince(octokit, githubUsername, since);
  const standup = await generateStandup(anthropic, events, config.label);

  console.log(`Standup (${config.label}):\n`);
  console.log(standup.summary);

  const snsTopicArn = process.env.SNS_TOPIC_ARN;
  if (snsTopicArn) {
    const today = new Date().toISOString().split("T")[0];
    const sns = new SNSClient({});
    await sns.send(new PublishCommand({
      TopicArn: snsTopicArn,
      Subject: `Recap: Your standup for ${today}`,
      Message: standup.summary,
    }));
    console.log("Standup published to SNS.");
  } else {
    console.log("SNS_TOPIC_ARN not set, skipping SNS publish.");
  }

  return { statusCode: 200, body: standup.summary };
}
