/**
 * Priority System — Unit Tests
 *
 * Tests the priority extraction, sorting, blocker detection,
 * and formatting functions added for Issue #47.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getIssuePriority,
  getPrioritySortWeight,
  sortByPriority,
  isBlockerActive,
  formatPriority,
  PRIORITY_LEVELS,
  PRIORITY_EMOJIS,
  PRIORITY_DEFAULT,
} from "./index";
import type { ProjectConfig } from "./index";

// ---------------------------------------------------------------------------
// Helper to build a minimal ProjectConfig for testing
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    botToken: "test-token",
    chatId: "-100123",
    githubRepo: "test-org/test-repo",
    members: [],
    githubToken: "ghp_testtoken123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a mock issue with labels
// ---------------------------------------------------------------------------

function makeIssue(
  labels: string[],
  extra: Record<string, unknown> = {}
): { labels: Array<{ name: string }> } & Record<string, unknown> {
  return {
    labels: labels.map((name) => ({ name })),
    ...extra,
  };
}

// =========================================================================
// 1. Constants — PRIORITY_LEVELS, PRIORITY_EMOJIS, PRIORITY_DEFAULT
// =========================================================================

describe("Priority constants", () => {
  it("PRIORITY_LEVELS has all four levels", () => {
    expect(Object.keys(PRIORITY_LEVELS)).toHaveLength(4);
    expect(PRIORITY_LEVELS).toHaveProperty("priority:blocker");
    expect(PRIORITY_LEVELS).toHaveProperty("priority:high");
    expect(PRIORITY_LEVELS).toHaveProperty("priority:medium");
    expect(PRIORITY_LEVELS).toHaveProperty("priority:low");
  });

  it("blocker has the lowest weight (highest priority)", () => {
    expect(PRIORITY_LEVELS["priority:blocker"]).toBe(0);
  });

  it("weights are in ascending order: blocker < high < medium < low", () => {
    expect(PRIORITY_LEVELS["priority:blocker"]).toBeLessThan(
      PRIORITY_LEVELS["priority:high"]
    );
    expect(PRIORITY_LEVELS["priority:high"]).toBeLessThan(
      PRIORITY_LEVELS["priority:medium"]
    );
    expect(PRIORITY_LEVELS["priority:medium"]).toBeLessThan(
      PRIORITY_LEVELS["priority:low"]
    );
  });

  it("PRIORITY_EMOJIS has an emoji for every level", () => {
    expect(Object.keys(PRIORITY_EMOJIS)).toHaveLength(4);
    for (const key of Object.keys(PRIORITY_LEVELS)) {
      expect(PRIORITY_EMOJIS[key]).toBeDefined();
      expect(PRIORITY_EMOJIS[key].length).toBeGreaterThan(0);
    }
  });

  it("PRIORITY_DEFAULT is priority:medium", () => {
    expect(PRIORITY_DEFAULT).toBe("priority:medium");
  });
});

// =========================================================================
// 2. getIssuePriority — extracting priority from issue labels
// =========================================================================

describe("getIssuePriority", () => {
  it("returns the priority label when issue has one", () => {
    const labels = [{ name: "bug" }, { name: "priority:high" }];
    expect(getIssuePriority(labels)).toBe("priority:high");
  });

  it("returns priority:blocker when issue is a blocker", () => {
    const labels = [{ name: "priority:blocker" }, { name: "urgent" }];
    expect(getIssuePriority(labels)).toBe("priority:blocker");
  });

  it("returns priority:low for low-priority issues", () => {
    const labels = [{ name: "priority:low" }];
    expect(getIssuePriority(labels)).toBe("priority:low");
  });

  it("returns priority:medium for medium-priority issues", () => {
    const labels = [{ name: "priority:medium" }];
    expect(getIssuePriority(labels)).toBe("priority:medium");
  });

  it("defaults to priority:medium when no priority label exists", () => {
    const labels = [{ name: "bug" }, { name: "enhancement" }];
    expect(getIssuePriority(labels)).toBe("priority:medium");
  });

  it("defaults to priority:medium when labels array is empty", () => {
    expect(getIssuePriority([])).toBe("priority:medium");
  });

  it("picks the first priority label when multiple exist", () => {
    const labels = [
      { name: "priority:high" },
      { name: "priority:low" },
    ];
    // Array.find returns the first match
    expect(getIssuePriority(labels)).toBe("priority:high");
  });

  it("ignores labels that contain 'priority' but do not start with 'priority:'", () => {
    const labels = [{ name: "high-priority" }, { name: "no-priority-here" }];
    expect(getIssuePriority(labels)).toBe("priority:medium");
  });
});

// =========================================================================
// 3. getPrioritySortWeight — numeric weight for sorting
// =========================================================================

describe("getPrioritySortWeight", () => {
  it("returns 0 for blocker", () => {
    expect(getPrioritySortWeight("priority:blocker")).toBe(0);
  });

  it("returns 1 for high", () => {
    expect(getPrioritySortWeight("priority:high")).toBe(1);
  });

  it("returns 2 for medium", () => {
    expect(getPrioritySortWeight("priority:medium")).toBe(2);
  });

  it("returns 3 for low", () => {
    expect(getPrioritySortWeight("priority:low")).toBe(3);
  });

  it("defaults to medium weight (2) for unknown priority strings", () => {
    expect(getPrioritySortWeight("priority:critical")).toBe(2);
  });

  it("defaults to medium weight (2) for empty string", () => {
    expect(getPrioritySortWeight("")).toBe(2);
  });

  it("defaults to medium weight (2) for a completely unrelated string", () => {
    expect(getPrioritySortWeight("not-a-priority")).toBe(2);
  });
});

// =========================================================================
// 4. sortByPriority — sorting issues by priority level
// =========================================================================

describe("sortByPriority", () => {
  it("sorts blocker before high before medium before low", () => {
    const issues = [
      makeIssue(["priority:low"]),
      makeIssue(["priority:blocker"]),
      makeIssue(["priority:medium"]),
      makeIssue(["priority:high"]),
    ];

    const sorted = sortByPriority(issues);
    expect(getIssuePriority(sorted[0].labels)).toBe("priority:blocker");
    expect(getIssuePriority(sorted[1].labels)).toBe("priority:high");
    expect(getIssuePriority(sorted[2].labels)).toBe("priority:medium");
    expect(getIssuePriority(sorted[3].labels)).toBe("priority:low");
  });

  it("treats issues without priority labels as medium", () => {
    const issues = [
      makeIssue(["priority:low"]),
      makeIssue(["bug"]), // no priority → medium
      makeIssue(["priority:high"]),
    ];

    const sorted = sortByPriority(issues);
    expect(getIssuePriority(sorted[0].labels)).toBe("priority:high");
    // The "bug" issue (treated as medium) and "priority:low" follow
    expect(getIssuePriority(sorted[1].labels)).toBe("priority:medium");
    expect(getIssuePriority(sorted[2].labels)).toBe("priority:low");
  });

  it("preserves relative order for same-priority issues (stable sort)", () => {
    const issueA = makeIssue(["priority:high"], { title: "A" });
    const issueB = makeIssue(["priority:high"], { title: "B" });
    const issueC = makeIssue(["priority:high"], { title: "C" });

    const sorted = sortByPriority([issueA, issueB, issueC]);
    expect(sorted[0].title).toBe("A");
    expect(sorted[1].title).toBe("B");
    expect(sorted[2].title).toBe("C");
  });

  it("returns an empty array when given an empty array", () => {
    expect(sortByPriority([])).toEqual([]);
  });

  it("returns a single issue unchanged", () => {
    const issues = [makeIssue(["priority:blocker"])];
    const sorted = sortByPriority(issues);
    expect(sorted).toHaveLength(1);
    expect(getIssuePriority(sorted[0].labels)).toBe("priority:blocker");
  });

  it("does not mutate the original array", () => {
    const issues = [
      makeIssue(["priority:low"]),
      makeIssue(["priority:high"]),
    ];
    const original = [...issues];
    sortByPriority(issues);
    // Original array should remain in its original order
    expect(issues[0]).toBe(original[0]);
    expect(issues[1]).toBe(original[1]);
  });

  it("handles issues with empty labels arrays", () => {
    const issues = [
      makeIssue([]),
      makeIssue(["priority:high"]),
    ];

    const sorted = sortByPriority(issues);
    // Empty labels → medium, so high comes first
    expect(getIssuePriority(sorted[0].labels)).toBe("priority:high");
    expect(getIssuePriority(sorted[1].labels)).toBe("priority:medium");
  });

  it("handles a realistic mix of issues with various labels", () => {
    const issues = [
      makeIssue(["bug", "priority:low"], { title: "Low bug" }),
      makeIssue(["enhancement"], { title: "No priority" }),
      makeIssue(["priority:blocker", "urgent"], { title: "Blocker" }),
      makeIssue(["feature", "priority:high"], { title: "High feature" }),
    ];

    const sorted = sortByPriority(issues);
    expect(sorted[0].title).toBe("Blocker");
    expect(sorted[1].title).toBe("High feature");
    expect(sorted[2].title).toBe("No priority"); // medium by default
    expect(sorted[3].title).toBe("Low bug");
  });
});

// =========================================================================
// 5. isBlockerActive — checking GitHub for open blocker issues
// =========================================================================

describe("isBlockerActive", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns empty array when project has no githubToken", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await isBlockerActive(project);
    expect(result).toEqual([]);
    // Should NOT have made any fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns blocker issues when GitHub API reports them", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 42, title: "Database connection pool exhausted" },
          { number: 99, title: "Auth service down" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await isBlockerActive(project);
    expect(result).toEqual([
      { number: 42, title: "Database connection pool exhausted" },
      { number: 99, title: "Auth service down" },
    ]);
  });

  it("returns empty array when no blocker issues exist", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await isBlockerActive(project);
    expect(result).toEqual([]);
  });

  it("filters out pull requests (only returns real issues)", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Real blocker issue" },
          {
            number: 20,
            title: "Blocker fix PR",
            pull_request: { url: "https://api.github.com/repos/test/pulls/20" },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await isBlockerActive(project);
    expect(result).toEqual([{ number: 10, title: "Real blocker issue" }]);
  });

  it("returns empty array when GitHub API returns an error", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await isBlockerActive(project);
    expect(result).toEqual([]);
  });

  it("calls the correct GitHub API endpoint with blocker label filter", async () => {
    const project = makeProject({
      githubRepo: "my-org/my-repo",
      githubToken: "ghp_abc123",
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await isBlockerActive(project);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/repos/my-org/my-repo/issues");
    expect(calledUrl).toContain("state=open");
    expect(calledUrl).toContain("labels=priority:blocker");
  });

  it("sends the correct Authorization header", async () => {
    const project = makeProject({ githubToken: "ghp_secret_token" });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await isBlockerActive(project);

    const calledOptions = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = calledOptions.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_secret_token");
  });

  it("filters out all entries when every result is a PR", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1,
            title: "PR 1",
            pull_request: { url: "https://..." },
          },
          {
            number: 2,
            title: "PR 2",
            pull_request: { url: "https://..." },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await isBlockerActive(project);
    expect(result).toEqual([]);
  });
});

// =========================================================================
// 6. formatPriority — emoji + text formatting
// =========================================================================

describe("formatPriority", () => {
  it("formats blocker as alarm emoji + BLOCKER", () => {
    const result = formatPriority("priority:blocker");
    expect(result).toContain("BLOCKER");
    expect(result).toContain("\u{1F6A8}");
  });

  it("formats high as red circle + HIGH", () => {
    const result = formatPriority("priority:high");
    expect(result).toContain("HIGH");
    expect(result).toContain("\u{1F534}");
  });

  it("formats medium as yellow circle + MEDIUM", () => {
    const result = formatPriority("priority:medium");
    expect(result).toContain("MEDIUM");
    expect(result).toContain("\u{1F7E1}");
  });

  it("formats low as white circle + LOW", () => {
    const result = formatPriority("priority:low");
    expect(result).toContain("LOW");
    expect(result).toContain("\u{26AA}");
  });

  it("uses default medium emoji for unknown priority", () => {
    const result = formatPriority("priority:unknown");
    // Falls back to medium emoji
    expect(result).toContain("\u{1F7E1}");
    // But still shows the actual label text uppercased
    expect(result).toContain("UNKNOWN");
  });

  it("uppercases the level name from the label", () => {
    expect(formatPriority("priority:high")).toMatch(/HIGH$/);
    expect(formatPriority("priority:low")).toMatch(/LOW$/);
  });

  it("handles a completely non-standard label gracefully", () => {
    const result = formatPriority("something:else");
    // Uses default emoji, strips "something:" prefix via replace
    expect(result).toContain("\u{1F7E1}");
    // "something:else".replace("priority:", "") = "something:else" → uppercased
    expect(result).toContain("SOMETHING:ELSE");
  });
});

// =========================================================================
// 7. Integration-style: sortByPriority + formatPriority together
// =========================================================================

describe("Priority system integration", () => {
  it("sorted issues produce formatted output in correct order", () => {
    const issues = [
      makeIssue(["priority:low"], { title: "Docs typo" }),
      makeIssue(["priority:blocker"], { title: "Site down" }),
      makeIssue(["priority:high"], { title: "Login broken" }),
      makeIssue([], { title: "Feature request" }),
    ];

    const sorted = sortByPriority(issues);
    const formatted = sorted.map((issue) =>
      formatPriority(getIssuePriority(issue.labels))
    );

    expect(formatted[0]).toContain("BLOCKER");
    expect(formatted[1]).toContain("HIGH");
    expect(formatted[2]).toContain("MEDIUM");
    expect(formatted[3]).toContain("LOW");
  });

  it("each priority level has a distinct emoji", () => {
    const levels = [
      "priority:blocker",
      "priority:high",
      "priority:medium",
      "priority:low",
    ];
    const emojis = levels.map(
      (level) => formatPriority(level).split(" ")[0]
    );
    const uniqueEmojis = new Set(emojis);
    expect(uniqueEmojis.size).toBe(4);
  });
});
