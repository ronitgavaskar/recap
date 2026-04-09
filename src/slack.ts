import { StandupUpdate } from "./claude.js";

export async function postToSlack(
  webhookUrl: string,
  update: StandupUpdate
): Promise<void> {
  // TODO: POST the standup update to the Slack incoming webhook
  throw new Error("Not implemented");
}
