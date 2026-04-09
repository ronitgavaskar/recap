import Anthropic from "@anthropic-ai/sdk";
import { GitHubEvent } from "./github.js";

export interface StandupUpdate {
  summary: string;
}

function buildPrompt(periodLabel: string): string {
  return `You are a developer writing your standup update. Given the following GitHub activity from the ${periodLabel}, write a concise standup in first person. Be conversational but professional.

Use this format exactly:

**What I did (${periodLabel}):**
- (bullet points summarizing completed work)

**What I'm working on next:**
- (infer likely next steps from the activity)

**Blockers:**
- (if none are apparent, say "None right now")

Guidelines:
- Group related items (e.g. multiple commits to the same repo/feature)
- Reference PR titles and repo names naturally
- Keep each bullet to one line
- Don't fabricate work that isn't in the activity data
- For "working on next", make reasonable inferences from open PRs or in-progress work`;
}

export async function generateStandup(
  client: Anthropic,
  events: GitHubEvent[],
  periodLabel: string = "last 24 hours"
): Promise<StandupUpdate> {
  if (events.length === 0) {
    return {
      summary:
        `No GitHub activity detected in the ${periodLabel}. Looks like it was quiet — or the work happened outside of GitHub.`,
    };
  }

  const activityBlock = events
    .map((e) => `- [${e.type}] ${e.repo}: ${e.title} (${e.url})`)
    .join("\n");

  try {
    const prompt = buildPrompt(periodLabel);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nHere is my GitHub activity from the ${periodLabel}:\n\n${activityBlock}`,
        },
      ],
    });

    const text = response.content[0];
    if (text.type !== "text") {
      throw new Error(`Unexpected response type: ${text.type}`);
    }

    return { summary: text.text };
  } catch (err) {
    console.error("Failed to generate standup via Claude:", err);
    throw err;
  }
}
