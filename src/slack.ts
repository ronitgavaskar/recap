import { StandupUpdate } from "./claude.js";

function toSlackMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^- /gm, "• ");
}

export async function postToSlack(
  webhookUrl: string,
  update: StandupUpdate,
  username: string,
  periodLabel: string
): Promise<void> {
  const formatted = toSlackMarkdown(update.summary);

  const body = JSON.stringify({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Recap Standup" },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `*${username}* · ${periodLabel}` },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: formatted },
      },
    ],
  });

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${text}`);
  }
}
