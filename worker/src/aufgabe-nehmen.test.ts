/**
 * Aufgabe nehmen (Issue #48) -- Unit Tests
 *
 * Tests the "Aufgabe nehmen" flow: category picker with colors,
 * blocker checks, claim guards, branch name generation, priority sorting
 * in category pick view, and color indicators on buttons.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCategoryClaims,
  saveCategoryClaims,
  fetchOpenIssuesByCategory,
  assignIssuesToUser,
  unassignIssuesFromUser,
  getUserColor,
  getUserColorByName,
  handleAufgabeNehmen,
  handleCategoryPick,
  handleCategoryConfirm,
  handleCategoryAssign,
  getUserPreferences,
  saveUserPreferences,
  getIssuePriority,
  sortByPriority,
  formatPriority,
  isBlockerActive,
  escapeHtml,
  getTeamMembers,
  getCompletedCategories,
  fetchClosedIssuesByCategory,
  buildCategoryPicker,
  PRIORITY_EMOJIS,
  PRIORITY_DEFAULT,
} from "./index";
import type {
  ProjectConfig,
  TeamMember,
  CategoryClaim,
  CategoryClaimsState,
} from "./index";

// ---------------------------------------------------------------------------
// Mock KV Namespace -- simulates Cloudflare KV for testing
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

// ---------------------------------------------------------------------------
// Mock Grammy Context -- simulates a Telegram callback/message context
// ---------------------------------------------------------------------------

function createMockContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chat: { type: "private", id: 99 },
    from: { id: 12345, username: "testuser", first_name: "Test" },
    message: { text: "hello" },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a mock Env
// ---------------------------------------------------------------------------

function createMockEnv(
  kvData: Record<string, string> = {},
  extraKvData: Record<string, string> = {}
): { PROJECTS: KVNamespace; DB: D1Database } {
  const mergedData = { ...kvData, ...extraKvData };
  return {
    PROJECTS: createMockKV(mergedData),
    DB: {} as D1Database,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a CategoryClaim
// ---------------------------------------------------------------------------

function makeClaim(overrides: Partial<CategoryClaim> = {}): CategoryClaim {
  return {
    telegramId: 12345,
    telegramName: "Test",
    githubUsername: "testuser",
    category: "area:frontend",
    displayName: "frontend",
    assignedIssues: [1, 2, 3],
    claimedAt: "2026-04-03T10:00:00.000Z",
    ...overrides,
  };
}

// =========================================================================
// 1. Category Claims KV Helpers
// =========================================================================

describe("getCategoryClaims", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns empty state when no claims exist", async () => {
    const result = await getCategoryClaims(kv, "my-project");
    expect(result).toEqual({ claims: [], lastUpdated: "" });
    expect(kv.get).toHaveBeenCalledWith("my-project:category_claims");
  });

  it("returns stored claims when they exist", async () => {
    const state: CategoryClaimsState = {
      claims: [makeClaim()],
      lastUpdated: "2026-04-03T10:00:00.000Z",
    };
    await kv.put("my-project:category_claims", JSON.stringify(state));

    const result = await getCategoryClaims(kv, "my-project");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].category).toBe("area:frontend");
  });

  it("returns empty state when KV contains invalid JSON", async () => {
    await kv.put("my-project:category_claims", "not-json");
    const result = await getCategoryClaims(kv, "my-project");
    expect(result).toEqual({ claims: [], lastUpdated: "" });
  });

  it("uses the correct key format: {projectId}:category_claims", async () => {
    await getCategoryClaims(kv, "some-project");
    expect(kv.get).toHaveBeenCalledWith("some-project:category_claims");
  });

  it("returns independent state per project", async () => {
    const stateA: CategoryClaimsState = {
      claims: [makeClaim({ category: "area:frontend" })],
      lastUpdated: "",
    };
    const stateB: CategoryClaimsState = {
      claims: [makeClaim({ category: "area:backend" })],
      lastUpdated: "",
    };
    await kv.put("proj-a:category_claims", JSON.stringify(stateA));
    await kv.put("proj-b:category_claims", JSON.stringify(stateB));

    const resultA = await getCategoryClaims(kv, "proj-a");
    const resultB = await getCategoryClaims(kv, "proj-b");
    expect(resultA.claims[0].category).toBe("area:frontend");
    expect(resultB.claims[0].category).toBe("area:backend");
  });
});

describe("saveCategoryClaims", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores claims to KV under the correct key", async () => {
    const state: CategoryClaimsState = { claims: [makeClaim()], lastUpdated: "" };
    await saveCategoryClaims(kv, "my-project", state);

    const raw = await kv.get("my-project:category_claims");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.claims).toHaveLength(1);
  });

  it("updates lastUpdated timestamp on save", async () => {
    const state: CategoryClaimsState = { claims: [], lastUpdated: "" };
    await saveCategoryClaims(kv, "my-project", state);

    expect(state.lastUpdated).not.toBe("");
    // ISO format check
    expect(state.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("round-trips correctly: save then read", async () => {
    const claim = makeClaim({ telegramId: 999, displayName: "API" });
    const state: CategoryClaimsState = { claims: [claim], lastUpdated: "" };

    await saveCategoryClaims(kv, "test-proj", state);
    const result = await getCategoryClaims(kv, "test-proj");

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].telegramId).toBe(999);
    expect(result.claims[0].displayName).toBe("API");
  });
});

// =========================================================================
// 2. getUserColor / getUserColorByName
// =========================================================================

describe("getUserColor", () => {
  const members: TeamMember[] = [
    { telegram_id: 100, telegram_username: "alice", github: "alice-gh", name: "Alice" },
    { telegram_id: 200, telegram_username: "bob", github: "bob-gh", name: "Bob" },
    { telegram_id: 300, telegram_username: "charlie", github: "charlie-gh", name: "Charlie" },
  ] as TeamMember[];

  it("returns a color emoji for an existing member", () => {
    const color = getUserColor(members, 100);
    expect(color.length).toBeGreaterThan(0);
    // Should be a circle emoji
    expect(color).toMatch(/./u);
  });

  it("returns different colors for different members", () => {
    const color1 = getUserColor(members, 100);
    const color2 = getUserColor(members, 200);
    expect(color1).not.toBe(color2);
  });

  it("returns fallback white square for unknown telegram ID", () => {
    const color = getUserColor(members, 99999);
    // When findIndex returns -1, -1 % 7 = -1, so the fallback "|| white_square" kicks in
    // Actually: -1 % 7 = -1 in JS, so USER_COLORS[-1] is undefined => fallback
    expect(color).toBe("\u{2B1C}");
  });

  it("returns consistent color for the same member across calls", () => {
    const color1 = getUserColor(members, 200);
    const color2 = getUserColor(members, 200);
    expect(color1).toBe(color2);
  });
});

describe("getUserColorByName", () => {
  const members: TeamMember[] = [
    { telegram_id: 100, telegram_username: "alice", github: "alice-gh", name: "Alice" },
    { telegram_id: 200, telegram_username: "bob", github: "bob-gh", name: "Bob" },
  ] as TeamMember[];

  it("matches by name", () => {
    const color = getUserColorByName(members, "Alice");
    expect(color).not.toBe("\u{2B1C}");
  });

  it("matches by GitHub username", () => {
    const color = getUserColorByName(members, "bob-gh");
    expect(color).not.toBe("\u{2B1C}");
  });

  it("returns white square for unknown name", () => {
    const color = getUserColorByName(members, "unknown-person");
    expect(color).toBe("\u{2B1C}");
  });

  it("returns same color for name match and github match of same person", () => {
    const byName = getUserColorByName(members, "Alice");
    const byGithub = getUserColorByName(members, "alice-gh");
    expect(byName).toBe(byGithub);
  });
});

// =========================================================================
// 3. fetchOpenIssuesByCategory -- groups issues by area: labels
// =========================================================================

describe("fetchOpenIssuesByCategory", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns empty map when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await fetchOpenIssuesByCategory(project);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("groups issues by area: label", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1, title: "Fix login", html_url: "https://...",
            labels: [{ name: "area:frontend" }, { name: "bug" }],
          },
          {
            number: 2, title: "Add API route", html_url: "https://...",
            labels: [{ name: "area:backend" }],
          },
          {
            number: 3, title: "Style button", html_url: "https://...",
            labels: [{ name: "area:frontend" }],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchOpenIssuesByCategory(project);
    expect(result.size).toBe(2);
    expect(result.get("area:frontend")).toHaveLength(2);
    expect(result.get("area:backend")).toHaveLength(1);
  });

  it("includes labels in the output for each issue", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1, title: "Fix login", html_url: "https://...",
            labels: [{ name: "area:frontend" }, { name: "priority:high" }],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchOpenIssuesByCategory(project);
    const frontendIssues = result.get("area:frontend");
    expect(frontendIssues).toBeDefined();
    expect(frontendIssues![0].labels).toBeDefined();
    expect(frontendIssues![0].labels).toHaveLength(2);
    expect(frontendIssues![0].labels[1].name).toBe("priority:high");
  });

  it("filters out pull requests", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1, title: "Real issue", html_url: "https://...",
            labels: [{ name: "area:frontend" }],
          },
          {
            number: 2, title: "A PR", html_url: "https://...",
            labels: [{ name: "area:frontend" }],
            pull_request: { url: "https://..." },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchOpenIssuesByCategory(project);
    expect(result.get("area:frontend")).toHaveLength(1);
    expect(result.get("area:frontend")![0].number).toBe(1);
  });

  it("returns empty map when GitHub API returns an error", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await fetchOpenIssuesByCategory(project);
    expect(result.size).toBe(0);
  });

  it("ignores issues without area: labels", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1, title: "No area label", html_url: "https://...",
            labels: [{ name: "bug" }, { name: "priority:high" }],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchOpenIssuesByCategory(project);
    expect(result.size).toBe(0);
  });

  it("handles an issue with multiple area: labels (appears in both groups)", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1, title: "Cross-cutting", html_url: "https://...",
            labels: [{ name: "area:frontend" }, { name: "area:backend" }],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchOpenIssuesByCategory(project);
    expect(result.get("area:frontend")).toHaveLength(1);
    expect(result.get("area:backend")).toHaveLength(1);
  });

  it("returns empty map when no issues exist", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await fetchOpenIssuesByCategory(project);
    expect(result.size).toBe(0);
  });
});

// =========================================================================
// 4. assignIssuesToUser / unassignIssuesFromUser
// =========================================================================

describe("assignIssuesToUser", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns all failed when no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await assignIssuesToUser(project, [1, 2, 3], "testuser");
    expect(result.success).toEqual([]);
    expect(result.failed).toEqual([1, 2, 3]);
  });

  it("returns success for issues assigned successfully", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const result = await assignIssuesToUser(project, [1, 2], "testuser");
    expect(result.success).toEqual([1, 2]);
    expect(result.failed).toEqual([]);
  });

  it("returns failed for issues where API returns an error", async () => {
    const project = makeProject();
    // First issue succeeds, second fails
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }));

    const result = await assignIssuesToUser(project, [1, 2], "testuser");
    expect(result.success).toEqual([1]);
    expect(result.failed).toEqual([2]);
  });

  it("handles network errors gracefully (failed, not thrown)", async () => {
    const project = makeProject();
    fetchSpy.mockRejectedValue(new Error("Network error"));

    const result = await assignIssuesToUser(project, [1], "testuser");
    expect(result.success).toEqual([]);
    expect(result.failed).toEqual([1]);
  });

  it("returns empty arrays when given empty issue list", async () => {
    const project = makeProject();
    const result = await assignIssuesToUser(project, [], "testuser");
    expect(result.success).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("unassignIssuesFromUser", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns all failed when no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await unassignIssuesFromUser(project, [1, 2], "testuser");
    expect(result.success).toEqual([]);
    expect(result.failed).toEqual([1, 2]);
  });

  it("returns success for issues unassigned successfully", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    );

    const result = await unassignIssuesFromUser(project, [1, 2], "testuser");
    expect(result.success).toEqual([1, 2]);
    expect(result.failed).toEqual([]);
  });
});

// =========================================================================
// 5. Branch name generation
// =========================================================================

describe("Branch name generation", () => {
  // The branch name is computed inline in handleCategoryConfirm as:
  //   feature/{displayName.toLowerCase().replace(/\s+/g, "-")}
  // where displayName = label.replace("area:", "")
  // We test the transformation logic directly.

  function generateBranchName(areaLabel: string): string {
    const displayName = areaLabel.replace("area:", "");
    return `feature/${displayName.toLowerCase().replace(/\s+/g, "-")}`;
  }

  it("converts area:frontend to feature/frontend", () => {
    expect(generateBranchName("area:frontend")).toBe("feature/frontend");
  });

  it("lowercases the category name", () => {
    expect(generateBranchName("area:Frontend")).toBe("feature/frontend");
    expect(generateBranchName("area:BACKEND")).toBe("feature/backend");
  });

  it("replaces spaces with dashes", () => {
    expect(generateBranchName("area:User Interface")).toBe("feature/user-interface");
  });

  it("replaces multiple consecutive spaces with a single dash", () => {
    expect(generateBranchName("area:User   Interface")).toBe("feature/user-interface");
  });

  it("handles single-word categories", () => {
    expect(generateBranchName("area:api")).toBe("feature/api");
  });

  it("handles categories with mixed case and spaces", () => {
    expect(generateBranchName("area:Admin Panel")).toBe("feature/admin-panel");
  });

  it("handles categories with special characters", () => {
    expect(generateBranchName("area:ui/ux")).toBe("feature/ui/ux");
  });

  it("handles empty category name after prefix removal", () => {
    expect(generateBranchName("area:")).toBe("feature/");
  });
});

// =========================================================================
// 6. handleAufgabeNehmen -- integration-style tests
// =========================================================================

describe("handleAufgabeNehmen", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows blocker message when a blocker issue is active", async () => {
    const project = makeProject();
    const env = createMockEnv();
    const ctx = createMockContext();

    // Mock isBlockerActive to return a blocker
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ number: 42, title: "Critical outage" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as any).mock.calls[0][0] as string;
    expect(replyText).toContain("Blocker active");
    expect(replyText).toContain("#42");
    expect(replyText).toContain("Critical outage");
    expect(replyText).toContain("You can still claim a category");
  });

  it("shows 'already claimed' message when user has a claim", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, displayName: "Frontend" });
    const claimsState: CategoryClaimsState = {
      claims: [claim],
      lastUpdated: "2026-04-03T10:00:00.000Z",
    };

    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    // Mock isBlockerActive to return no blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = (ctx.reply as any).mock.calls[0][0] as string;
    expect(replyText).toContain("already have");
    expect(replyText).toContain("Frontend");
    expect(replyText).toContain("Release your current category");
  });

  it("shows 'already claimed' with release/cancel keyboard", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345 });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    expect(replyOpts.reply_markup).toBeDefined();
    const buttons = replyOpts.reply_markup.inline_keyboard.flat();
    const callbackDatas = buttons.map((b: any) => b.callback_data);
    expect(callbackDatas).toContain("cat_release");
    expect(callbackDatas).toContain("cat_cancel");
  });

  it("shows 'no categories found' when no area: labels exist", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "team-members": JSON.stringify([]),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // fetchOpenIssuesByCategory returns empty (no issues at all)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyText = (ctx.reply as any).mock.calls[0][0] as string;
    expect(replyText).toContain("No categories found");
    expect(replyText).toContain("area:");
  });

  it("shows category picker with green indicators for free categories", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "team-members": JSON.stringify([]),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // fetchOpenIssuesByCategory returns issues in 2 categories
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Issue A", html_url: "https://...", labels: [{ name: "area:frontend" }] },
          { number: 2, title: "Issue B", html_url: "https://...", labels: [{ name: "area:backend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyText = (ctx.reply as any).mock.calls[0][0] as string;
    expect(replyText).toContain("Aufgabe nehmen");
    expect(replyText).toContain("Pick a category");

    // Check buttons
    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const allButtons = replyOpts.reply_markup.inline_keyboard.flat();

    // Free categories should have green circle and "free" text
    const freeButtons = allButtons.filter((b: any) => b.text.includes("free"));
    expect(freeButtons.length).toBe(2);

    // Free buttons should have green circle emoji
    for (const btn of freeButtons) {
      expect(btn.text).toContain("\u{1F7E2}"); // green circle
    }
  });

  it("shows lock icon + claimer name for already-claimed categories", async () => {
    const project = makeProject();
    const otherClaim = makeClaim({
      telegramId: 99999,
      telegramName: "OtherUser",
      category: "area:frontend",
      displayName: "frontend",
    });
    const claimsState: CategoryClaimsState = { claims: [otherClaim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
      "team-members": JSON.stringify([
        { telegram_id: 99999, telegram_username: "other", github: "other-gh", name: "OtherUser" },
      ]),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // fetchOpenIssuesByCategory returns one category
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Issue A", html_url: "https://...", labels: [{ name: "area:frontend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext({ from: { id: 12345, username: "testuser", first_name: "Test" } });
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const allButtons = replyOpts.reply_markup.inline_keyboard.flat();
    const claimedButton = allButtons.find((b: any) => b.text.includes("OtherUser"));
    expect(claimedButton).toBeDefined();
    expect(claimedButton.text).toContain("\u{1F512}"); // lock icon
  });

  it("claimed categories use cat_cancel callback (not pickable)", async () => {
    const project = makeProject();
    const otherClaim = makeClaim({
      telegramId: 99999,
      category: "area:frontend",
    });
    const claimsState: CategoryClaimsState = { claims: [otherClaim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
      "team-members": JSON.stringify([]),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // Issues
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Issue", html_url: "https://...", labels: [{ name: "area:frontend" }] },
          { number: 2, title: "Free issue", html_url: "https://...", labels: [{ name: "area:backend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const allButtons = replyOpts.reply_markup.inline_keyboard.flat();

    // Claimed category should use cat_cancel
    const claimedBtn = allButtons.find((b: any) => b.callback_data === "cat_cancel" && b.text.includes("frontend"));
    expect(claimedBtn).toBeDefined();

    // Free category should use cat_pick:area:backend
    const freeBtn = allButtons.find((b: any) => b.callback_data === "cat_pick:area:backend");
    expect(freeBtn).toBeDefined();
  });

  it("does nothing when ctx.from is undefined", async () => {
    const project = makeProject();
    const env = createMockEnv();
    const ctx = createMockContext({ from: undefined });

    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("includes a Cancel button at the bottom of the picker", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "team-members": JSON.stringify([]),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // One category
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Issue", html_url: "https://...", labels: [{ name: "area:frontend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const rows = replyOpts.reply_markup.inline_keyboard;
    const lastRow = rows[rows.length - 1];
    expect(lastRow[0].callback_data).toBe("cat_cancel");
    expect(lastRow[0].text).toContain("Cancel");
  });
});

// =========================================================================
// 7. Priority sorting in category pick view
// =========================================================================

describe("Priority sorting in category pick / confirm views", () => {
  it("sortByPriority with labels correctly sorts issues for display", () => {
    const issues = [
      { number: 1, title: "Low task", html_url: "https://...", labels: [{ name: "area:frontend" }, { name: "priority:low" }] },
      { number: 2, title: "Blocker task", html_url: "https://...", labels: [{ name: "area:frontend" }, { name: "priority:blocker" }] },
      { number: 3, title: "High task", html_url: "https://...", labels: [{ name: "area:frontend" }, { name: "priority:high" }] },
      { number: 4, title: "No priority", html_url: "https://...", labels: [{ name: "area:frontend" }] },
    ];

    const sorted = sortByPriority(issues);
    expect(sorted[0].title).toBe("Blocker task");
    expect(sorted[1].title).toBe("High task");
    expect(sorted[2].title).toBe("No priority"); // treated as medium
    expect(sorted[3].title).toBe("Low task");
  });

  it("DM issue list shows priority emojis alongside issue titles", () => {
    // Simulating the DM message construction from handleCategoryConfirm
    const issues = [
      { number: 1, title: "Fix login", html_url: "https://github.com/1", labels: [{ name: "priority:high" }] },
      { number: 2, title: "Add tests", html_url: "https://github.com/2", labels: [{ name: "priority:low" }] },
    ];

    const sorted = sortByPriority(issues);
    const dmIssueList = sorted.map((i) => {
      const priority = getIssuePriority(i.labels);
      const emoji = PRIORITY_EMOJIS[priority] || PRIORITY_EMOJIS[PRIORITY_DEFAULT];
      return `${emoji} <a href="${i.html_url}">#${i.number} ${escapeHtml(i.title)}</a>`;
    }).join("\n");

    // High should be first
    expect(dmIssueList.indexOf("Fix login")).toBeLessThan(dmIssueList.indexOf("Add tests"));
    // Both should have emojis
    expect(dmIssueList).toContain(PRIORITY_EMOJIS["priority:high"]);
    expect(dmIssueList).toContain(PRIORITY_EMOJIS["priority:low"]);
  });
});

// =========================================================================
// 8. handleCategoryAssign -- the inline callback version
// =========================================================================

describe("handleCategoryAssign", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows blocker message via editMessageText when blockers active", async () => {
    const project = makeProject();
    const env = createMockEnv();

    // Blocker active
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ number: 5, title: "DB down" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleCategoryAssign(ctx as any, project, env as any, "test-project");

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const editText = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(editText).toContain("Blocker active");
    expect(editText).toContain("#5");
    expect(editText).toContain("DB down");
  });

  it("shows existing claim with release option via editMessageText", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345 });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleCategoryAssign(ctx as any, project, env as any, "test-project");

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const editText = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(editText).toContain("already have");
  });

  it("uses one-button-per-row layout for category picker", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "team-members": JSON.stringify([]),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // Three categories
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "A", html_url: "https://...", labels: [{ name: "area:api" }] },
          { number: 2, title: "B", html_url: "https://...", labels: [{ name: "area:backend" }] },
          { number: 3, title: "C", html_url: "https://...", labels: [{ name: "area:frontend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleCategoryAssign(ctx as any, project, env as any, "test-project");

    const editOpts = (ctx.editMessageText as any).mock.calls[0][1];
    const rows = editOpts.reply_markup.inline_keyboard;
    // handleCategoryAssign puts one button per row for readability
    // 3 categories = 3 rows + 1 cancel row = 4 rows total
    expect(rows.length).toBe(4);
    expect(rows[0]).toHaveLength(1); // one button per row
    expect(rows[1]).toHaveLength(1);
    expect(rows[2]).toHaveLength(1);
    expect(rows[3][0].callback_data).toBe("cat_cancel"); // cancel at bottom
  });
});

// =========================================================================
// 9. handleCategoryPick -- confirmation screen
// =========================================================================

describe("handleCategoryPick", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows race condition message when category was just claimed by someone else", async () => {
    const project = makeProject();
    const otherClaim = makeClaim({
      telegramId: 99999,
      telegramName: "OtherUser",
      category: "area:frontend",
    });
    const claimsState: CategoryClaimsState = { claims: [otherClaim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    const ctx = createMockContext();
    await handleCategoryPick(ctx as any, project, env as any, "test-project", "area:frontend");

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("was just claimed by");
    expect(text).toContain("OtherUser");
  });

  it("shows 'you already have a category' if caller already has a claim", async () => {
    const project = makeProject();
    const callerClaim = makeClaim({ telegramId: 12345, category: "area:backend" });
    const claimsState: CategoryClaimsState = { claims: [callerClaim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    const ctx = createMockContext();
    await handleCategoryPick(ctx as any, project, env as any, "test-project", "area:frontend");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("already have");
    expect(text).toContain("Release it first");
  });

  it("shows issue list with Confirm/Back buttons when category is available", async () => {
    const project = makeProject();
    const env = createMockEnv();

    // fetchOpenIssuesByCategory returns issues for this category
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Fix login form", html_url: "https://...", labels: [{ name: "area:frontend" }] },
          { number: 11, title: "Style header", html_url: "https://...", labels: [{ name: "area:frontend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleCategoryPick(ctx as any, project, env as any, "test-project", "area:frontend");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("frontend");
    expect(text).toContain("2 issues");
    expect(text).toContain("#10");
    expect(text).toContain("#11");
    expect(text).toContain("Fix login form");

    // Check keyboard has Confirm and Back
    const editOpts = (ctx.editMessageText as any).mock.calls[0][1];
    const buttons = editOpts.reply_markup.inline_keyboard.flat();
    const callbackDatas = buttons.map((b: any) => b.callback_data);
    expect(callbackDatas).toContain("cat_confirm:area:frontend");
    expect(callbackDatas).toContain("cat_assign"); // Back
  });

  it("shows 'no open issues' when category has no issues", async () => {
    const project = makeProject();
    const env = createMockEnv();

    // Empty issues
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleCategoryPick(ctx as any, project, env as any, "test-project", "area:empty");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("No open issues");
  });

  it("limits displayed issues to 10 with overflow count", async () => {
    const project = makeProject();
    const env = createMockEnv();

    // 15 issues
    const issues = Array.from({ length: 15 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      html_url: `https://.../${i + 1}`,
      labels: [{ name: "area:big" }],
    }));
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(issues), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleCategoryPick(ctx as any, project, env as any, "test-project", "area:big");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("15 issues");
    expect(text).toContain("...and 5 more");
  });
});

// =========================================================================
// 10. handleCategoryConfirm -- full confirm flow
// =========================================================================

describe("handleCategoryConfirm", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("proceeds with confirm even if a blocker appeared (user already acknowledged warning)", async () => {
    const project = makeProject();
    const env = createMockEnv();

    // No existing claim for area:frontend — category is free to claim
    // Mock fetchOpenIssuesByCategory (GitHub labels API)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleCategoryConfirm(ctx as any, project, env as any, "test-project", "area:frontend");

    // Confirm should proceed (not block) because user already saw the blocker
    // warning in handleCategoryAssign and chose to continue
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).not.toContain("Blocker active");
  });

  it("blocks when category was claimed by someone else (race condition)", async () => {
    const project = makeProject();
    const otherClaim = makeClaim({
      telegramId: 99999,
      telegramName: "Racer",
      category: "area:frontend",
    });
    const claimsState: CategoryClaimsState = { claims: [otherClaim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleCategoryConfirm(ctx as any, project, env as any, "test-project", "area:frontend");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("Too late");
    expect(text).toContain("Racer");
  });

  it("blocks when caller already has a different category", async () => {
    const project = makeProject();
    const callerClaim = makeClaim({ telegramId: 12345, category: "area:backend" });
    const claimsState: CategoryClaimsState = { claims: [callerClaim], lastUpdated: "" };
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify(claimsState),
    });

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );

    const ctx = createMockContext();
    await handleCategoryConfirm(ctx as any, project, env as any, "test-project", "area:frontend");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("already have");
  });
});

// =========================================================================
// 11. Color indicators -- free vs claimed categories
// =========================================================================

describe("Color indicators on category buttons", () => {
  it("free categories show green circle emoji", () => {
    // The logic in handleAufgabeNehmen constructs button text as:
    // Free: `green_circle displayName (count) -- free`
    // We test the pattern
    const displayName = "frontend";
    const issueCount = 3;
    const buttonText = `\u{1F7E2} ${displayName} (${issueCount}) \u{2014} free`;

    expect(buttonText).toContain("\u{1F7E2}"); // green circle
    expect(buttonText).toContain("free");
    expect(buttonText).toContain("frontend");
    expect(buttonText).toContain("(3)");
  });

  it("claimed categories show claimer's color + lock icon", () => {
    // The logic constructs:
    // Claimed: `claimerColor displayName (count) -- lock claimerName`
    const members: TeamMember[] = [
      { telegram_id: 100, telegram_username: "alice", github: "alice-gh", name: "Alice" },
    ] as TeamMember[];

    const claimerColor = getUserColor(members, 100);
    const displayName = "frontend";
    const issueCount = 5;
    const claimerName = "Alice";
    const buttonText = `${claimerColor} ${displayName} (${issueCount}) \u{2014} \u{1F512}${claimerName}`;

    expect(buttonText).toContain(claimerColor);
    expect(buttonText).toContain("\u{1F512}"); // lock
    expect(buttonText).toContain("Alice");
  });

  it("unknown claimer gets white square fallback color", () => {
    const members: TeamMember[] = [] as TeamMember[];
    const claimerColor = getUserColor(members, 99999);
    expect(claimerColor).toBe("\u{2B1C}"); // white square
  });
});

// =========================================================================
// 12. User Preferences KV Helpers
// =========================================================================

describe("saveUserPreferences", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores preferences to KV under prefs:{telegramId}", async () => {
    const prefs = await getUserPreferences(kv, 12345);
    prefs.commits = true;
    await saveUserPreferences(kv, 12345, prefs);

    const raw = await kv.get("prefs:12345");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.commits).toBe(true);
  });

  it("updates the updated_at timestamp on save", async () => {
    const prefs = await getUserPreferences(kv, 12345);
    const beforeSave = prefs.updated_at;
    await saveUserPreferences(kv, 12345, prefs);
    expect(prefs.updated_at).not.toBe(beforeSave);
  });

  it("round-trips correctly", async () => {
    const prefs = await getUserPreferences(kv, 12345);
    prefs.commits = true;
    prefs.pr_reviews = true;
    prefs.dm_chat_id = 999;
    await saveUserPreferences(kv, 12345, prefs);

    const loaded = await getUserPreferences(kv, 12345);
    expect(loaded.commits).toBe(true);
    expect(loaded.pr_reviews).toBe(true);
    expect(loaded.dm_chat_id).toBe(999);
  });
});

// =========================================================================
// 13. No-project fallback
// =========================================================================

describe("No-project fallback in handleAufgabeNehmen", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("handles project without GitHub token (fetchOpenIssuesByCategory returns empty)", async () => {
    const project = makeProject({ githubToken: undefined });
    const env = createMockEnv();

    // isBlockerActive returns empty (no token)
    // fetchOpenIssuesByCategory also returns empty (no token)
    // No fetch calls should be made

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyText = (ctx.reply as any).mock.calls[0][0] as string;
    expect(replyText).toContain("No categories found");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 14. Edge cases and regression scenarios
// =========================================================================

describe("Edge cases", () => {
  it("escapeHtml in category display names prevents XSS", () => {
    const malicious = '<script>alert("xss")</script>';
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
  });

  it("branch name generation handles Unicode category names", () => {
    const displayName = "Benutzer Oberflache";
    const branchName = `feature/${displayName.toLowerCase().replace(/\s+/g, "-")}`;
    expect(branchName).toBe("feature/benutzer-oberflache");
  });

  it("multiple claims for different projects are independent", async () => {
    const kv = createMockKV();

    const stateA: CategoryClaimsState = {
      claims: [makeClaim({ category: "area:frontend" })],
      lastUpdated: "",
    };
    const stateB: CategoryClaimsState = {
      claims: [makeClaim({ category: "area:api" })],
      lastUpdated: "",
    };

    await saveCategoryClaims(kv, "project-a", stateA);
    await saveCategoryClaims(kv, "project-b", stateB);

    const loadedA = await getCategoryClaims(kv, "project-a");
    const loadedB = await getCategoryClaims(kv, "project-b");

    expect(loadedA.claims[0].category).toBe("area:frontend");
    expect(loadedB.claims[0].category).toBe("area:api");
  });

  it("assignIssuesToUser handles mix of success and failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const project = makeProject();

    // Issues 1,3 succeed; issue 2 fails
    fetchSpy
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("error", { status: 422 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const result = await assignIssuesToUser(project, [1, 2, 3], "testuser");
    expect(result.success).toEqual([1, 3]);
    expect(result.failed).toEqual([2]);

    fetchSpy.mockRestore();
  });

  it("formatPriority works for all priority levels used in DM messages", () => {
    const levels = ["priority:blocker", "priority:high", "priority:medium", "priority:low"];
    for (const level of levels) {
      const formatted = formatPriority(level);
      expect(formatted.length).toBeGreaterThan(0);
      // Should contain the level name (uppercased)
      const levelName = level.replace("priority:", "").toUpperCase();
      expect(formatted).toContain(levelName);
    }
  });

  it("category picker sorts categories alphabetically", () => {
    // The handleAufgabeNehmen sorts categories with localeCompare
    const categories = new Map<string, unknown[]>();
    categories.set("area:zeta", []);
    categories.set("area:alpha", []);
    categories.set("area:beta", []);

    const sorted = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    expect(sorted[0][0]).toBe("area:alpha");
    expect(sorted[1][0]).toBe("area:beta");
    expect(sorted[2][0]).toBe("area:zeta");
  });
});

// =========================================================================
// Issue #69 — Completed categories toggle
// =========================================================================

describe("getCompletedCategories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns labels with no open issues", async () => {
    const project = makeProject();
    const openCategories = new Map<string, unknown[]>();
    openCategories.set("area:api", [{ number: 1 }]);

    // Mock fetchAreaLabels: returns all area labels including completed ones
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: "area:api" },
          { name: "area:ui" },
          { name: "area:dashboard" },
          { name: "bug" }, // non-area label, should be filtered
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const completed = await getCompletedCategories(project, openCategories);
    expect(completed).toEqual(["area:dashboard", "area:ui"]);
    expect(completed).not.toContain("area:api");
  });

  it("returns empty array when all categories have open issues", async () => {
    const project = makeProject();
    const openCategories = new Map<string, unknown[]>();
    openCategories.set("area:api", [{ number: 1 }]);
    openCategories.set("area:ui", [{ number: 2 }]);

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ name: "area:api" }, { name: "area:ui" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const completed = await getCompletedCategories(project, openCategories);
    expect(completed).toEqual([]);
  });
});

describe("fetchClosedIssuesByCategory", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("fetches closed issues for each category label", async () => {
    const project = makeProject();

    // Mock for area:ui
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Login redesign" },
          { number: 11, title: "Button fix" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock for area:dashboard
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ number: 20, title: "Charts" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchClosedIssuesByCategory(project, ["area:ui", "area:dashboard"]);
    expect(result.get("area:ui")).toHaveLength(2);
    expect(result.get("area:dashboard")).toHaveLength(1);
    expect(result.get("area:ui")![0].title).toBe("Login redesign");
  });

  it("returns empty map for empty input", async () => {
    const project = makeProject();
    const result = await fetchClosedIssuesByCategory(project, []);
    expect(result.size).toBe(0);
  });
});

describe("buildCategoryPicker", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows toggle button with completed count when showCompleted=false", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify({ claims: [], lastUpdated: "" }),
    });
    const claimsState: CategoryClaimsState = { claims: [], lastUpdated: "" };

    // Mock fetchOpenIssuesByCategory (open issues)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task A", labels: [{ name: "area:api" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock fetchAreaLabels (all labels including completed)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: "area:api" },
          { name: "area:ui" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await buildCategoryPicker(env, project, "test-project", claimsState, false);
    expect(result).not.toBeNull();

    const allCallbacks = result!.buttons.flat().map((b) => b.callback_data);
    expect(allCallbacks).toContain("cat_show_completed");
    expect(allCallbacks).not.toContain("cat_hide_completed");

    const toggleBtn = result!.buttons.flat().find((b) => b.callback_data === "cat_show_completed");
    expect(toggleBtn!.text).toContain("1"); // 1 completed category
  });

  it("shows completed categories with issues when showCompleted=true", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify({ claims: [], lastUpdated: "" }),
    });
    const claimsState: CategoryClaimsState = { claims: [], lastUpdated: "" };

    // Mock fetchOpenIssuesByCategory
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task A", labels: [{ name: "area:api" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock fetchAreaLabels
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ name: "area:api" }, { name: "area:ui" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock fetchClosedIssuesByCategory for area:ui
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Login redesign" },
          { number: 11, title: "Button component" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await buildCategoryPicker(env, project, "test-project", claimsState, true);
    expect(result).not.toBeNull();

    // Text should contain completed section with issues
    expect(result!.text).toContain("Erledigt");
    expect(result!.text).toContain("ui");
    expect(result!.text).toContain("#10");
    expect(result!.text).toContain("Login redesign");

    // Should have hide button, not show
    const allCallbacks = result!.buttons.flat().map((b) => b.callback_data);
    expect(allCallbacks).toContain("cat_hide_completed");
    expect(allCallbacks).not.toContain("cat_show_completed");
  });

  it("hides toggle when no completed categories exist", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify({ claims: [], lastUpdated: "" }),
    });
    const claimsState: CategoryClaimsState = { claims: [], lastUpdated: "" };

    // Mock fetchOpenIssuesByCategory
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task A", labels: [{ name: "area:api" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // Mock fetchAreaLabels — same labels as open, so none are "completed"
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{ name: "area:api" }]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await buildCategoryPicker(env, project, "test-project", claimsState, false);
    expect(result).not.toBeNull();

    const allCallbacks = result!.buttons.flat().map((b) => b.callback_data);
    expect(allCallbacks).not.toContain("cat_show_completed");
    expect(allCallbacks).not.toContain("cat_hide_completed");
  });

  it("returns null when no categories exist at all", async () => {
    const project = makeProject();
    const env = createMockEnv({
      "test-project:category_claims": JSON.stringify({ claims: [], lastUpdated: "" }),
    });
    const claimsState: CategoryClaimsState = { claims: [], lastUpdated: "" };

    // No open issues
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    // No labels
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await buildCategoryPicker(env, project, "test-project", claimsState);
    expect(result).toBeNull();
  });
});
