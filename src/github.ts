import { Octokit } from "octokit";

interface SearchResultItem {
  repository_url: string;
  title: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  pull_request?: { merged_at?: string | null };
}

interface SearchResponse {
  total_count: number;
  items: SearchResultItem[];
}

export interface GitHubEvent {
  repo: string;
  type: string;
  title: string;
  url: string;
  timestamp: string;
}

export async function fetchActivitySince(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  const events: GitHubEvent[] = [];

  const prsOpened = await fetchPRsOpened(octokit, username, since);
  events.push(...prsOpened);

  const prsMerged = await fetchPRsMerged(octokit, username, since);
  events.push(...prsMerged);

  const reviews = await fetchPRReviews(octokit, username, since);
  events.push(...reviews);

  const repoEvents = await fetchRepoEvents(octokit, username, since);
  events.push(...repoEvents);

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events;
}

async function fetchPRsOpened(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  try {
    const response = await octokit.request("GET /search/issues", {
      q: `type:pr author:${username} created:>=${since}`,
      sort: "created",
      order: "desc",
      per_page: 100,
    });
    const { items } = response.data as SearchResponse;

    return items.map((pr) => ({
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
    const response = await octokit.request("GET /search/issues", {
      q: `type:pr author:${username} merged:>=${since}`,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });
    const { items } = response.data as SearchResponse;

    return items.map((pr) => ({
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
    const response = await octokit.request("GET /search/issues", {
      q: `type:pr reviewed-by:${username} updated:>=${since}`,
      sort: "updated",
      order: "desc",
      per_page: 100,
    });
    const { items } = response.data as SearchResponse;

    return items.map((pr) => ({
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

const TRACKED_EVENT_TYPES = ["PushEvent", "CreateEvent", "IssuesEvent", "IssueCommentEvent"];

async function fetchRepoEvents(
  octokit: Octokit,
  username: string,
  since: string
): Promise<GitHubEvent[]> {
  try {
    const { data: eventData } = await octokit.rest.activity.listEventsForAuthenticatedUser({
      username,
      per_page: 100,
    });

    const recentEvents = eventData.filter(
      (event: typeof eventData[number]) =>
        TRACKED_EVENT_TYPES.includes(event.type ?? "") &&
        event.created_at &&
        new Date(event.created_at) >= new Date(since)
    );

    const events: GitHubEvent[] = [];

    for (const event of recentEvents) {
      const repo = event.repo.name;

      if (event.type === "PushEvent") {
        const payload = event.payload as { commits?: Array<{ message: string; sha: string }> };
        for (const commit of payload.commits ?? []) {
          events.push({
            repo,
            type: "commit",
            title: commit.message.split("\n")[0],
            url: `https://github.com/${repo}/commit/${commit.sha}`,
            timestamp: event.created_at!,
          });
        }
      } else if (event.type === "CreateEvent") {
        const payload = event.payload as { ref_type?: string; ref?: string };
        const label = payload.ref_type === "repository"
          ? `Created repository ${repo}`
          : `Created ${payload.ref_type} ${payload.ref ?? ""}`.trim();
        events.push({
          repo,
          type: "create",
          title: label,
          url: `https://github.com/${repo}`,
          timestamp: event.created_at!,
        });
      } else if (event.type === "IssuesEvent") {
        const payload = event.payload as { action?: string; issue?: { title?: string; html_url?: string } };
        events.push({
          repo,
          type: `issue-${payload.action ?? "updated"}`,
          title: payload.issue?.title ?? "Untitled issue",
          url: payload.issue?.html_url ?? `https://github.com/${repo}`,
          timestamp: event.created_at!,
        });
      } else if (event.type === "IssueCommentEvent") {
        const payload = event.payload as { issue?: { title?: string; html_url?: string } };
        events.push({
          repo,
          type: "comment",
          title: `Commented on: ${payload.issue?.title ?? "issue"}`,
          url: payload.issue?.html_url ?? `https://github.com/${repo}`,
          timestamp: event.created_at!,
        });
      }
    }

    return events;
  } catch (err) {
    console.error("Failed to fetch repo events:", err);
    return [];
  }
}
