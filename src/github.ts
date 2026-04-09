import { Octokit } from "octokit";

export interface GitHubEvent {
  repo: string;
  type: string;
  title: string;
  url: string;
  timestamp: string;
}

export async function fetchLast24HoursActivity(
  octokit: Octokit,
  username: string
): Promise<GitHubEvent[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const events: GitHubEvent[] = [];

  const prsOpened = await fetchPRsOpened(octokit, username, since);
  events.push(...prsOpened);

  const prsMerged = await fetchPRsMerged(octokit, username, since);
  events.push(...prsMerged);

  const reviews = await fetchPRReviews(octokit, username, since);
  events.push(...reviews);

  const commits = await fetchCommits(octokit, username, since);
  events.push(...commits);

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events;
}

async function fetchPRsOpened(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `type:pr author:${username} created:>=${since}`,
      sort: "created",
      order: "desc",
      per_page: 100,
    });

    return data.items.map((pr: typeof data.items[number]) => ({
      repo: pr.repository_url.replace("https://api.github.com/repos/", ""),
      type: "pr-opened",
      title: pr.title,
      url: pr.html_url,
      timestamp: pr.created_at,
    }));
  } catch (err) {
    console.error("Failed to fetch opened PRs:", err);
    return [];
  }
}

async function fetchPRsMerged(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `type:pr author:${username} merged:>=${since}`,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });

    return data.items.map((pr: typeof data.items[number]) => ({
      repo: pr.repository_url.replace("https://api.github.com/repos/", ""),
      type: "pr-merged",
      title: pr.title,
      url: pr.html_url,
      timestamp: pr.pull_request?.merged_at ?? pr.updated_at ?? pr.created_at,
    }));
  } catch (err) {
    console.error("Failed to fetch merged PRs:", err);
    return [];
  }
}

async function fetchPRReviews(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  try {
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `type:pr reviewed-by:${username} updated:>=${since}`,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });

    return data.items.map((pr: typeof data.items[number]) => ({
      repo: pr.repository_url.replace("https://api.github.com/repos/", ""),
      type: "pr-reviewed",
      title: pr.title,
      url: pr.html_url,
      timestamp: pr.updated_at ?? pr.created_at,
    }));
  } catch (err) {
    console.error("Failed to fetch PR reviews:", err);
    return [];
  }
}

async function fetchCommits(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  try {
    const { data: eventData } = await octokit.rest.activity.listEventsForAuthenticatedUser({
      username,
      per_page: 100,
    });

    const pushEvents = eventData.filter(
      (event: typeof eventData[number]) =>
        event.type === "PushEvent" &&
        event.created_at &&
        new Date(event.created_at) >= new Date(since)
    );

    const events: GitHubEvent[] = [];

    for (const push of pushEvents) {
      const payload = push.payload as { commits?: Array<{ message: string; sha: string }> };
      const repo = push.repo.name;

      for (const commit of payload.commits ?? []) {
        events.push({
          repo,
          type: "commit",
          title: commit.message.split("\n")[0],
          url: `https://github.com/${repo}/commit/${commit.sha}`,
          timestamp: push.created_at!,
        });
      }
    }

    return events;
  } catch (err) {
    console.error("Failed to fetch commits:", err);
    return [];
  }
}
