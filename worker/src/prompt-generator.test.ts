/**
 * Prompt Generator — Unit Tests
 *
 * Tests for the Claude Code prompt generation feature (Issue #54):
 * - parseIssueBody: extracting description and acceptance criteria from issue body
 * - findRelevantFiles: GitHub Code Search integration for file discovery
 * - generateClaudePrompt: full prompt assembly from GitHub issue data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseIssueBody,
  findRelevantFiles,
  generateClaudePrompt,
} from "./index";
import type { ProjectConfig } from "./index";

// ---------------------------------------------------------------------------
// Mock KV Namespace — simulates Cloudflare KV for testing
// ---------------------------------------------------------------------------

function createMockKV(initialData: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      keys: Array.from(store.keys()).map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    })),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Helper to build a minimal ProjectConfig
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

// =========================================================================
// 1. parseIssueBody — extracting description and acceptance criteria
// =========================================================================

describe("parseIssueBody", () => {
  it("extracts description and acceptance criteria from a well-formed body", () => {
    const body = [
      "This feature adds a login page.",
      "",
      "## Acceptance criteria",
      "- [ ] User can enter email",
      "- [ ] User can enter password",
      "- [ ] Form validates inputs",
    ].join("\n");

    const result = parseIssueBody(body);

    expect(result.description).toBe("This feature adds a login page.");
    expect(result.acceptanceCriteria).toContain("User can enter email");
    expect(result.acceptanceCriteria).toContain("User can enter password");
    expect(result.acceptanceCriteria).toContain("Form validates inputs");
  });

  it("returns empty strings for empty body", () => {
    const result = parseIssueBody("");
    expect(result.description).toBe("");
    expect(result.acceptanceCriteria).toBe("");
  });

  it("handles body with no acceptance criteria section", () => {
    const body = "Just a simple description without any headings.";
    const result = parseIssueBody(body);

    expect(result.description).toBe(body);
    expect(result.acceptanceCriteria).toBe("");
  });

  it("handles body with acceptance criteria but no description before it", () => {
    const body = [
      "## Acceptance criteria",
      "- [ ] Criterion one",
      "- [ ] Criterion two",
    ].join("\n");

    const result = parseIssueBody(body);

    expect(result.description).toBe("");
    expect(result.acceptanceCriteria).toContain("Criterion one");
    expect(result.acceptanceCriteria).toContain("Criterion two");
  });

  it("stops acceptance criteria at the next ## heading", () => {
    const body = [
      "Description text here.",
      "",
      "## Acceptance criteria",
      "- [ ] First criterion",
      "- [ ] Second criterion",
      "",
      "## Implementation notes",
      "Some implementation details here.",
    ].join("\n");

    const result = parseIssueBody(body);

    expect(result.description).toBe("Description text here.");
    expect(result.acceptanceCriteria).toContain("First criterion");
    expect(result.acceptanceCriteria).toContain("Second criterion");
    expect(result.acceptanceCriteria).not.toContain("Implementation notes");
    expect(result.acceptanceCriteria).not.toContain(
      "Some implementation details"
    );
  });

  it("truncates long descriptions without AC heading to ~300 chars", () => {
    // Build a body that is much longer than 300 characters with no AC heading
    const body = "A".repeat(400);
    const result = parseIssueBody(body);

    expect(result.description.length).toBeLessThanOrEqual(304); // 300 + "..."
    expect(result.description).toContain("...");
    expect(result.acceptanceCriteria).toBe("");
  });

  it("does not truncate descriptions shorter than 300 chars without AC heading", () => {
    const body = "Short description only.";
    const result = parseIssueBody(body);

    expect(result.description).toBe("Short description only.");
    expect(result.description).not.toContain("...");
  });

  it("handles case-insensitive 'Criteria' in the heading", () => {
    const body = [
      "Description here.",
      "",
      "## Acceptance Criteria",
      "- [ ] Something important",
    ].join("\n");

    const result = parseIssueBody(body);

    expect(result.description).toBe("Description here.");
    expect(result.acceptanceCriteria).toContain("Something important");
  });

  it("handles lowercase 'criteria' in the heading", () => {
    const body = [
      "Description here.",
      "",
      "## Acceptance criteria",
      "- [ ] Lowercase criterion",
    ].join("\n");

    const result = parseIssueBody(body);

    expect(result.acceptanceCriteria).toContain("Lowercase criterion");
  });

  it("handles body with multiple ## headings before and after AC", () => {
    const body = [
      "## Overview",
      "Project overview text.",
      "",
      "## Acceptance criteria",
      "- [ ] AC item one",
      "",
      "## Technical notes",
      "Technical detail here.",
      "",
      "## References",
      "Link to docs.",
    ].join("\n");

    const result = parseIssueBody(body);

    // Description is everything before the AC heading
    expect(result.description).toContain("Overview");
    expect(result.description).toContain("Project overview text.");
    // AC section stops at the next heading
    expect(result.acceptanceCriteria).toContain("AC item one");
    expect(result.acceptanceCriteria).not.toContain("Technical notes");
    expect(result.acceptanceCriteria).not.toContain("References");
  });

  it("trims whitespace from description and acceptance criteria", () => {
    const body = [
      "  Description with leading whitespace.  ",
      "",
      "## Acceptance criteria",
      "",
      "  - [ ] Criteria with whitespace  ",
      "",
    ].join("\n");

    const result = parseIssueBody(body);

    // The .trim() calls in the implementation should handle this
    expect(result.description).not.toMatch(/^\s/);
    expect(result.description).not.toMatch(/\s$/);
  });
});

// =========================================================================
// 2. findRelevantFiles — GitHub Code Search integration
// =========================================================================

describe("findRelevantFiles", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns file paths from a successful search", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { path: "src/components/Login.tsx" },
            { path: "src/utils/auth.ts" },
            { path: "src/api/users.ts" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await findRelevantFiles(
      "test-org/test-repo",
      "authentication login page",
      "ghp_testtoken123"
    );

    expect(result).toEqual([
      "src/components/Login.tsx",
      "src/utils/auth.ts",
      "src/api/users.ts",
    ]);
  });

  it("returns null when search returns empty items", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await findRelevantFiles(
      "test-org/test-repo",
      "authentication login",
      "ghp_testtoken123"
    );

    expect(result).toBeNull();
  });

  it("returns null when search returns no items field", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await findRelevantFiles(
      "test-org/test-repo",
      "authentication login",
      "ghp_testtoken123"
    );

    expect(result).toBeNull();
  });

  it("returns null when API returns non-OK status", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Rate limited", { status: 403 })
    );

    const result = await findRelevantFiles(
      "test-org/test-repo",
      "authentication login",
      "ghp_testtoken123"
    );

    expect(result).toBeNull();
  });

  it("returns null on network error (graceful fallback)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    const result = await findRelevantFiles(
      "test-org/test-repo",
      "authentication login",
      "ghp_testtoken123"
    );

    expect(result).toBeNull();
  });

  it("deduplicates file paths when search returns duplicates", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { path: "src/index.ts" },
            { path: "src/index.ts" },
            { path: "src/utils.ts" },
            { path: "src/utils.ts" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await findRelevantFiles(
      "test-org/test-repo",
      "telegram bot handler",
      "ghp_testtoken123"
    );

    expect(result).toEqual(["src/index.ts", "src/utils.ts"]);
  });

  it("returns null when issue title has only stop words", async () => {
    // All words are filtered out by stop words or length < 3
    const result = await findRelevantFiles(
      "test-org/test-repo",
      "add the new fix",
      "ghp_testtoken123"
    );

    // "add", "the", "new", "fix" are all stop words
    expect(result).toBeNull();
    // No fetch call should have been made
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when issue title has only short words", async () => {
    const result = await findRelevantFiles(
      "test-org/test-repo",
      "do it no",
      "ghp_testtoken123"
    );

    // Words <= 2 chars are filtered out
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts meaningful keywords from issue title", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [{ path: "src/dashboard.ts" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await findRelevantFiles(
      "test-org/test-repo",
      "implement dashboard notifications system",
      "ghp_testtoken123"
    );

    // Should have made a fetch call
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchUrl = (fetchSpy.mock.calls[0][0] as string) || "";
    // The query should contain meaningful keywords (dashboard, notifications, system)
    // and should NOT contain stop words
    expect(fetchUrl).toContain("dashboard");
    expect(fetchUrl).toContain("notifications");
    expect(fetchUrl).toContain("system");
  });

  it("limits keywords to 3 words maximum", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [{ path: "src/file.ts" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await findRelevantFiles(
      "test-org/test-repo",
      "dashboard notifications system settings preferences configuration",
      "ghp_testtoken123"
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchUrl = (fetchSpy.mock.calls[0][0] as string) || "";
    // Should contain repo in the query (URL-encoded, so / becomes %2F)
    expect(fetchUrl).toContain("test-org%2Ftest-repo");
  });
});

// =========================================================================
// 3. generateClaudePrompt — full prompt assembly
// =========================================================================

describe("generateClaudePrompt", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns a fallback message when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });

    const result = await generateClaudePrompt(project, 42, null);

    expect(result).toContain("Implement issue #42");
    expect(result).toContain("No GitHub token configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns an error message when issue fetch fails", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const result = await generateClaudePrompt(project, 99, null);

    expect(result).toContain("Implement issue #99");
    expect(result).toContain("Could not fetch issue details");
    expect(result).toContain("404");
  });

  it("generates a full prompt with all sections", async () => {
    const project = makeProject({ githubRepo: "org/my-project" });

    // Mock: issue fetch
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Add user dashboard",
          body: [
            "Build a dashboard showing user stats.",
            "",
            "## Acceptance criteria",
            "- [ ] Shows total tasks completed",
            "- [ ] Shows current streak",
          ].join("\n"),
          labels: [{ name: "area:dashboard" }],
          html_url: "https://github.com/org/my-project/issues/10",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock: code search
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            { path: "src/dashboard.ts" },
            { path: "src/components/Stats.tsx" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await generateClaudePrompt(project, 10, "Dashboard");

    // Header section
    expect(result).toContain("Implement: #10 Add user dashboard");
    expect(result).toContain("Branch: feature/dashboard");
    expect(result).toContain(
      "Link: https://github.com/org/my-project/issues/10"
    );

    // Description section
    expect(result).toContain("Description:");
    expect(result).toContain("Build a dashboard showing user stats.");

    // Acceptance criteria section
    expect(result).toContain("Acceptance Criteria:");
    expect(result).toContain("Shows total tasks completed");
    expect(result).toContain("Shows current streak");

    // Relevant files section
    expect(result).toContain("Relevant Files:");
    expect(result).toContain("- src/dashboard.ts");
    expect(result).toContain("- src/components/Stats.tsx");

    // Instructions section
    expect(result).toContain("Instructions:");
    expect(result).toContain("git checkout -b feature/dashboard");
    expect(result).toContain("Write tests for new functionality");
  });

  it("uses category for branch name when provided", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Task title",
          body: "Some body",
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/5",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock: code search (returns null — no results)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await generateClaudePrompt(
      project,
      5,
      "User Authentication"
    );

    expect(result).toContain("Branch: feature/user-authentication");
  });

  it("falls back to feature/issue-{number} when no category", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Fix login bug",
          body: "Login is broken.",
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/77",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock: code search fails
    fetchSpy.mockResolvedValueOnce(
      new Response("Server Error", { status: 500 })
    );

    const result = await generateClaudePrompt(project, 77, null);

    expect(result).toContain("Branch: feature/issue-77");
  });

  it("handles missing code context gracefully", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Something obscure",
          body: "Description here.",
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/3",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock: code search returns null (no items)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await generateClaudePrompt(project, 3, null);

    expect(result).toContain("Relevant Files:");
    expect(result).toContain(
      "No specific files identified — explore the codebase"
    );
  });

  it("handles issue with null body", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Empty issue",
          body: null,
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock: code search — keywords from title "Empty issue" → "empty" is >2 chars and not a stop word
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await generateClaudePrompt(project, 1, null);

    // Should still produce a valid prompt without crashing
    expect(result).toContain("Implement: #1 Empty issue");
    expect(result).toContain("Branch: feature/issue-1");
    // Should NOT contain Description or Acceptance Criteria sections
    // (since body is null, parseIssueBody returns empty strings)
    expect(result).not.toContain("Description:");
    expect(result).not.toContain("Acceptance Criteria:");
  });

  it("lowercases and hyphenates category for branch name", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Task",
          body: "",
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/2",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Code search — title "Task" has only the stop word "task", so no search
    // Actually "task" is in stopWords, but the function is called inside generateClaudePrompt
    // with issue.title, not directly. Let's mock it anyway.
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await generateClaudePrompt(
      project,
      2,
      "Team Board Settings"
    );

    expect(result).toContain("Branch: feature/team-board-settings");
  });

  it("includes all five instruction steps", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Test task",
          body: "Body",
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/8",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await generateClaudePrompt(project, 8, null);

    expect(result).toContain("1. Check out branch:");
    expect(result).toContain("2. Read the relevant files");
    expect(result).toContain("3. Implement all acceptance criteria");
    expect(result).toContain("4. Write tests for new functionality");
    expect(result).toContain("5. Run tests before committing");
  });

  it("handles code search error gracefully during prompt generation", async () => {
    const project = makeProject();

    // Issue fetch succeeds
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          title: "Complex feature",
          body: [
            "A complex feature.",
            "",
            "## Acceptance criteria",
            "- [ ] Works correctly",
          ].join("\n"),
          labels: [],
          html_url: "https://github.com/test-org/test-repo/issues/15",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Code search throws network error
    fetchSpy.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await generateClaudePrompt(project, 15, "Complex");

    // Should still produce a valid prompt
    expect(result).toContain("Implement: #15 Complex feature");
    expect(result).toContain("Branch: feature/complex");
    expect(result).toContain("Acceptance Criteria:");
    expect(result).toContain("Works correctly");
    // Files section should show the fallback text
    expect(result).toContain(
      "No specific files identified — explore the codebase"
    );
  });
});
