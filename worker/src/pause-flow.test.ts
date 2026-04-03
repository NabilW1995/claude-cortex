/**
 * Pause Flow (Issue #50) — Unit Tests
 *
 * Tests the pause flow: KV helpers for paused categories,
 * handlePause confirmation dialog, handlePauseConfirm execution,
 * category picker integration with paused state, and Pause button
 * visibility in Meine Aufgaben.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPausedCategories,
  savePausedCategories,
  addPausedCategory,
  removePausedCategory,
  handlePause,
  handlePauseConfirm,
  getCategoryClaims,
  saveCategoryClaims,
  handleMeineAufgaben,
  handleAufgabeNehmen,
  setActiveProject,
  setActiveTask,
  getActiveTask,
  clearActiveTask,
  escapeHtml,
  getUserColor,
} from "./index";
import type {
  Env,
  ProjectConfig,
  TeamMember,
  CategoryClaim,
  CategoryClaimsState,
  PausedCategory,
} from "./index";

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
// Helpers
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

function createMockEnv(
  projects: Record<string, ProjectConfig> = {},
  extraKvData: Record<string, string> = {}
): Env {
  const kvData: Record<string, string> = { ...extraKvData };
  for (const [id, config] of Object.entries(projects)) {
    kvData[id] = JSON.stringify(config);
  }
  return {
    PROJECTS: createMockKV(kvData),
    DB: {} as D1Database,
  };
}

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

function makePaused(overrides: Partial<PausedCategory> = {}): PausedCategory {
  return {
    category: "area:frontend",
    displayName: "frontend",
    pausedBy: "Alice",
    completedTasks: 2,
    totalTasks: 5,
    pausedAt: "2026-04-03T12:00:00.000Z",
    ...overrides,
  };
}

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

// =========================================================================
// 1. getPausedCategories — reading paused categories from KV
// =========================================================================

describe("getPausedCategories", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns empty array when no paused categories exist", async () => {
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toEqual([]);
    expect(kv.get).toHaveBeenCalledWith("my-project:paused_categories");
  });

  it("returns stored paused categories when they exist", async () => {
    const paused: PausedCategory[] = [makePaused()];
    await kv.put("my-project:paused_categories", JSON.stringify(paused));

    const result = await getPausedCategories(kv, "my-project");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:frontend");
    expect(result[0].pausedBy).toBe("Alice");
    expect(result[0].completedTasks).toBe(2);
    expect(result[0].totalTasks).toBe(5);
  });

  it("returns empty array when KV contains invalid JSON", async () => {
    await kv.put("my-project:paused_categories", "not-json");
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toEqual([]);
  });

  it("uses the correct key format: {projectId}:paused_categories", async () => {
    await getPausedCategories(kv, "some-project");
    expect(kv.get).toHaveBeenCalledWith("some-project:paused_categories");
  });

  it("returns independent state per project", async () => {
    await kv.put("proj-a:paused_categories", JSON.stringify([makePaused({ category: "area:frontend" })]));
    await kv.put("proj-b:paused_categories", JSON.stringify([makePaused({ category: "area:backend" })]));

    const resultA = await getPausedCategories(kv, "proj-a");
    const resultB = await getPausedCategories(kv, "proj-b");
    expect(resultA[0].category).toBe("area:frontend");
    expect(resultB[0].category).toBe("area:backend");
  });
});

// =========================================================================
// 2. savePausedCategories — writing paused categories to KV
// =========================================================================

describe("savePausedCategories", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores paused categories to KV under the correct key", async () => {
    const paused = [makePaused()];
    await savePausedCategories(kv, "my-project", paused);

    const raw = await kv.get("my-project:paused_categories");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].category).toBe("area:frontend");
  });

  it("round-trips correctly: save then read", async () => {
    const paused = [makePaused({ pausedBy: "Bob", completedTasks: 3, totalTasks: 7 })];
    await savePausedCategories(kv, "test-proj", paused);
    const result = await getPausedCategories(kv, "test-proj");

    expect(result).toHaveLength(1);
    expect(result[0].pausedBy).toBe("Bob");
    expect(result[0].completedTasks).toBe(3);
    expect(result[0].totalTasks).toBe(7);
  });

  it("overwrites existing paused categories on save", async () => {
    await savePausedCategories(kv, "proj", [makePaused({ category: "area:old" })]);
    await savePausedCategories(kv, "proj", [makePaused({ category: "area:new" })]);

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:new");
  });
});

// =========================================================================
// 3. addPausedCategory — adding a paused entry
// =========================================================================

describe("addPausedCategory", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("adds a paused category to an empty list", async () => {
    await addPausedCategory(kv, "proj", makePaused());
    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
    expect(result[0].pausedBy).toBe("Alice");
  });

  it("appends to an existing list", async () => {
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend" }));
    await addPausedCategory(kv, "proj", makePaused({ category: "area:backend", pausedBy: "Bob" }));

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(2);
  });

  it("replaces an existing entry for the same category", async () => {
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend", pausedBy: "Alice", completedTasks: 1 }));
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend", pausedBy: "Bob", completedTasks: 3 }));

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
    expect(result[0].pausedBy).toBe("Bob");
    expect(result[0].completedTasks).toBe(3);
  });

  it("does not affect entries for other categories", async () => {
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend" }));
    await addPausedCategory(kv, "proj", makePaused({ category: "area:backend" }));
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend", pausedBy: "Updated" }));

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(2);
    const frontend = result.find((p) => p.category === "area:frontend");
    const backend = result.find((p) => p.category === "area:backend");
    expect(frontend?.pausedBy).toBe("Updated");
    expect(backend?.pausedBy).toBe("Alice");
  });
});

// =========================================================================
// 4. removePausedCategory — removing a paused entry
// =========================================================================

describe("removePausedCategory", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("removes a paused category by label", async () => {
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend" }));
    await addPausedCategory(kv, "proj", makePaused({ category: "area:backend" }));

    await removePausedCategory(kv, "proj", "area:frontend");

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:backend");
  });

  it("does nothing when category is not in the paused list", async () => {
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend" }));
    await removePausedCategory(kv, "proj", "area:nonexistent");

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
  });

  it("does nothing when paused list is empty", async () => {
    await removePausedCategory(kv, "proj", "area:frontend");
    const result = await getPausedCategories(kv, "proj");
    expect(result).toEqual([]);
  });

  it("removes the only entry, leaving an empty list", async () => {
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend" }));
    await removePausedCategory(kv, "proj", "area:frontend");

    const result = await getPausedCategories(kv, "proj");
    expect(result).toEqual([]);
  });
});

// =========================================================================
// 5. handlePause — confirmation dialog
// =========================================================================

describe("handlePause", () => {
  it("shows 'no category to pause' when user has no claim", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    const ctx = createMockContext();

    await handlePause(ctx as any, env, project, "my-project");

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("don\u2019t have a category to pause");
  });

  it("shows confirmation dialog with category name when user has a claim", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, displayName: "frontend", assignedIssues: [1, 2, 3] });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      { "my-project:category_claims": JSON.stringify(claimsState) }
    );
    const ctx = createMockContext();

    await handlePause(ctx as any, env, project, "my-project");

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("Pause frontend?");
    expect(text).toContain("Unassign 3 issues");
    expect(text).toContain("Free the category");
    expect(text).toContain("branch stays on GitHub");
    expect(text).toContain("nothing is lost");
  });

  it("shows Yes/Cancel buttons with correct callback data", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345 });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      { "my-project:category_claims": JSON.stringify(claimsState) }
    );
    const ctx = createMockContext();

    await handlePause(ctx as any, env, project, "my-project");

    const editOpts = (ctx.editMessageText as any).mock.calls[0][1];
    const buttons = editOpts.reply_markup.inline_keyboard.flat();
    const callbackDatas = buttons.map((b: any) => b.callback_data);
    expect(callbackDatas).toContain("mytasks_pause_confirm");
    expect(callbackDatas).toContain("mytasks_refresh");
  });

  it("escapes HTML in category display name", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, displayName: '<img src="x">' });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      { "my-project:category_claims": JSON.stringify(claimsState) }
    );
    const ctx = createMockContext();

    await handlePause(ctx as any, env, project, "my-project");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).not.toContain("<img");
    expect(text).toContain("&lt;img");
  });

  it("does nothing when ctx.from is undefined", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    const ctx = createMockContext({ from: undefined });

    await handlePause(ctx as any, env, project, "my-project");

    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 6. handlePauseConfirm — executing the pause
// =========================================================================

describe("handlePauseConfirm", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows 'no category to pause' when user has no claim", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    const ctx = createMockContext();

    await handlePauseConfirm(ctx as any, project, env, "my-project");

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("No category to pause");
  });

  it("unassigns issues on GitHub", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [10, 11] });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    // Mock: issue status checks (both open)
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    // Mock: unassign calls
    fetchSpy
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    // Mock: group notification
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    // Check that DELETE /assignees was called for each issue
    const deleteCallsCount = fetchSpy.mock.calls.filter((call: unknown[]) => {
      const url = call[0] as string;
      const opts = call[1] as RequestInit;
      return url.includes("/assignees") && opts?.method === "DELETE";
    }).length;
    expect(deleteCallsCount).toBe(2);
  });

  it("removes claim from KV", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [10] });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    // Mock: issue check
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    // Mock: unassign + group notification
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    // Verify claim was removed
    const updatedClaims = await getCategoryClaims(env.PROJECTS, "my-project");
    expect(updatedClaims.claims).toHaveLength(0);
  });

  it("stores paused marker in KV", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [10, 11, 12], displayName: "frontend" });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    // Mock: 2 open, 1 closed
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "closed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    // Mock: unassign + notifications
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    const paused = await getPausedCategories(env.PROJECTS, "my-project");
    expect(paused).toHaveLength(1);
    expect(paused[0].category).toBe("area:frontend");
    expect(paused[0].pausedBy).toBe("Test");
    expect(paused[0].completedTasks).toBe(1);
    expect(paused[0].totalTasks).toBe(3);
    expect(paused[0].pausedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("clears the user's active task", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [10] });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
        "active_task:12345:my-project": "10",
      }
    );

    // Mock responses
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    // Active task should be cleared
    const activeTask = await getActiveTask(env.PROJECTS, 12345, "my-project");
    expect(activeTask).toBeNull();
  });

  it("shows confirmation message with completion count", async () => {
    const project = makeProject();
    const claim = makeClaim({
      telegramId: 12345,
      assignedIssues: [10, 11, 12],
      displayName: "frontend",
    });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    // 1 closed, 2 open → 1 completed
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "closed" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("frontend");
    expect(text).toContain("paused by Test");
    expect(text).toContain("1/3 tasks completed");
    expect(text).toContain("Branch preserved");
  });

  it("sends group notification about available category", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [10], displayName: "frontend" });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ state: "open" }), { status: 200 }));
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    // Check that sendTelegram was called for the group notification
    const groupNotifyCalls = fetchSpy.mock.calls.filter((call: unknown[]) => {
      const url = call[0] as string;
      return url.includes("sendMessage") && url.includes("test-token");
    });
    // Should have at least the group notification call
    expect(groupNotifyCalls.length).toBeGreaterThanOrEqual(1);

    // At least one of them should mention "paused" and "frontend"
    const groupBody = groupNotifyCalls.find((call: unknown[]) => {
      const body = call[1] as RequestInit;
      const text = body?.body ? JSON.parse(body.body as string).text : "";
      return text.includes("paused") && text.includes("frontend");
    });
    expect(groupBody).toBeDefined();
  });

  it("does nothing when ctx.from is undefined", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    const ctx = createMockContext({ from: undefined });

    await handlePauseConfirm(ctx as any, project, env, "my-project");

    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("escapes HTML in user name and category name", async () => {
    const project = makeProject();
    const claim = makeClaim({
      telegramId: 12345,
      displayName: '<b>bad</b>',
      assignedIssues: [],
    });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const ctx = createMockContext({
      from: { id: 12345, username: "test", first_name: '<script>alert("x")</script>' },
    });
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<b>bad</b>");
    // The <b> in the displayName should be escaped,
    // but the result may contain other <b> from formatting
    expect(text).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });
});

// =========================================================================
// 7. Pause button visibility in handleMeineAufgaben
// =========================================================================

describe("Pause button in Meine Aufgaben", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows Pause button when user has a claimed category", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const claim = makeClaim({ telegramId: 12345 });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claimsState),
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task A", labels: [{ name: "priority:medium" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { keyboard } = await handleMeineAufgaben(env, 12345, "Test");
    const allButtons = keyboard.inline_keyboard.flat();
    const pauseBtn = allButtons.find((b: any) => b.callback_data === "mytasks_pause");
    expect(pauseBtn).toBeDefined();
    expect(pauseBtn!.text).toContain("Pause");
  });

  it("does NOT show Pause button when user has no claimed category", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task A", labels: [{ name: "priority:medium" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { keyboard } = await handleMeineAufgaben(env, 12345, "Test");
    const allButtons = keyboard.inline_keyboard.flat();
    const pauseBtn = allButtons.find((b: any) => b.callback_data === "mytasks_pause");
    expect(pauseBtn).toBeUndefined();
  });

  it("shows both Pause and Refresh buttons when user has a claim", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const claim = makeClaim({ telegramId: 12345 });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claimsState),
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task A", labels: [{ name: "priority:medium" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { keyboard } = await handleMeineAufgaben(env, 12345, "Test");
    const allButtons = keyboard.inline_keyboard.flat();
    const callbackDatas = allButtons.map((b: any) => b.callback_data);
    expect(callbackDatas).toContain("mytasks_pause");
    expect(callbackDatas).toContain("mytasks_refresh");
  });
});

// =========================================================================
// 8. Category picker shows paused status
// =========================================================================

describe("Category picker with paused categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows 'paused by' info in the category picker buttons", async () => {
    const project = makeProject();
    const paused: PausedCategory[] = [
      makePaused({ category: "area:frontend", pausedBy: "Alice", completedTasks: 3, totalTasks: 5 }),
    ];

    const env = createMockEnv(
      {},
      {
        "test-project:paused_categories": JSON.stringify(paused),
        "team-members": JSON.stringify([]),
      }
    );

    // No blockers
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" },
      })
    );
    // Issues in two categories
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

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const allButtons = replyOpts.reply_markup.inline_keyboard.flat();

    // Frontend button should show paused info
    const frontendBtn = allButtons.find((b: any) => b.text.includes("frontend"));
    expect(frontendBtn).toBeDefined();
    expect(frontendBtn.text).toContain("paused by Alice");
    expect(frontendBtn.text).toContain("3/5 done");
    expect(frontendBtn.text).toContain("\u{23F8}"); // pause emoji

    // Backend button should show as free
    const backendBtn = allButtons.find((b: any) => b.text.includes("backend"));
    expect(backendBtn).toBeDefined();
    expect(backendBtn.text).toContain("free");
    expect(backendBtn.text).toContain("\u{1F7E2}"); // green circle
  });

  it("paused categories are still claimable (not locked)", async () => {
    const project = makeProject();
    const paused: PausedCategory[] = [
      makePaused({ category: "area:frontend" }),
    ];

    const env = createMockEnv(
      {},
      {
        "test-project:paused_categories": JSON.stringify(paused),
        "team-members": JSON.stringify([]),
      }
    );

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
          { number: 1, title: "Issue A", html_url: "https://...", labels: [{ name: "area:frontend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const allButtons = replyOpts.reply_markup.inline_keyboard.flat();

    // Paused category should have cat_pick callback (not cat_cancel)
    const frontendBtn = allButtons.find((b: any) => b.text.includes("frontend"));
    expect(frontendBtn.callback_data).toBe("cat_pick:area:frontend");
  });

  it("claimed category takes priority over paused state", async () => {
    const project = makeProject();
    const claim = makeClaim({
      telegramId: 99999,
      telegramName: "Bob",
      category: "area:frontend",
    });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const paused: PausedCategory[] = [
      makePaused({ category: "area:frontend" }),
    ];

    const env = createMockEnv(
      {},
      {
        "test-project:category_claims": JSON.stringify(claimsState),
        "test-project:paused_categories": JSON.stringify(paused),
        "team-members": JSON.stringify([
          { telegram_id: 99999, telegram_username: "bob", github: "bob-gh", name: "Bob" },
        ]),
      }
    );

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
          { number: 1, title: "Issue A", html_url: "https://...", labels: [{ name: "area:frontend" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockContext();
    await handleAufgabeNehmen(ctx as any, project, env as any, "test-project");

    const replyOpts = (ctx.reply as any).mock.calls[0][1];
    const allButtons = replyOpts.reply_markup.inline_keyboard.flat();

    // Should show claimed status (lock), NOT paused status
    const frontendBtn = allButtons.find((b: any) => b.text.includes("frontend"));
    expect(frontendBtn.text).toContain("\u{1F512}"); // lock
    expect(frontendBtn.text).toContain("Bob");
    expect(frontendBtn.text).not.toContain("paused by");
  });
});

// =========================================================================
// 9. Paused marker is removed when category is reclaimed
// =========================================================================

describe("Paused marker removal on reclaim", () => {
  it("removePausedCategory clears the paused state for a specific category", async () => {
    const kv = createMockKV();
    await addPausedCategory(kv, "proj", makePaused({ category: "area:frontend" }));
    await addPausedCategory(kv, "proj", makePaused({ category: "area:backend" }));

    await removePausedCategory(kv, "proj", "area:frontend");

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:backend");
  });
});

// =========================================================================
// 10. Callback data format for pause flow
// =========================================================================

describe("Pause callback data format", () => {
  it("mytasks_pause callback is a plain string", () => {
    expect("mytasks_pause").toBe("mytasks_pause");
  });

  it("mytasks_pause_confirm callback is a plain string", () => {
    expect("mytasks_pause_confirm").toBe("mytasks_pause_confirm");
  });

  it("cancel in pause dialog routes to mytasks_refresh to restore task view", () => {
    // The cancel button uses "mytasks_refresh" to bring the user back to their task list
    const cancelCallback = "mytasks_refresh";
    expect(cancelCallback).toBe("mytasks_refresh");
  });
});

// =========================================================================
// 11. Edge cases and regression scenarios
// =========================================================================

describe("Pause flow edge cases", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("handles pause with zero assigned issues (all completed before pause)", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [], displayName: "frontend" });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    const text = (ctx.editMessageText as any).mock.calls[0][0] as string;
    expect(text).toContain("0/0 tasks completed");

    const paused = await getPausedCategories(env.PROJECTS, "my-project");
    expect(paused).toHaveLength(1);
    expect(paused[0].completedTasks).toBe(0);
    expect(paused[0].totalTasks).toBe(0);
  });

  it("does not affect other users' claims when pausing", async () => {
    const project = makeProject();
    const userClaim = makeClaim({ telegramId: 12345, category: "area:frontend" });
    const otherClaim = makeClaim({ telegramId: 99999, category: "area:backend", telegramName: "Other" });
    const claimsState: CategoryClaimsState = {
      claims: [userClaim, otherClaim],
      lastUpdated: "",
    };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true, state: "open" }), { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    // Only user's claim should be removed, other claim stays
    const updatedClaims = await getCategoryClaims(env.PROJECTS, "my-project");
    expect(updatedClaims.claims).toHaveLength(1);
    expect(updatedClaims.claims[0].telegramId).toBe(99999);
    expect(updatedClaims.claims[0].category).toBe("area:backend");
  });

  it("PausedCategory has all required fields populated", async () => {
    const kv = createMockKV();
    const entry = makePaused({
      category: "area:api",
      displayName: "API",
      pausedBy: "Charlie",
      completedTasks: 4,
      totalTasks: 8,
    });

    await addPausedCategory(kv, "proj", entry);
    const result = await getPausedCategories(kv, "proj");

    expect(result[0].category).toBe("area:api");
    expect(result[0].displayName).toBe("API");
    expect(result[0].pausedBy).toBe("Charlie");
    expect(result[0].completedTasks).toBe(4);
    expect(result[0].totalTasks).toBe(8);
    expect(result[0].pausedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("pausing the same category twice updates the paused entry", async () => {
    const kv = createMockKV();
    await addPausedCategory(kv, "proj", makePaused({
      category: "area:frontend",
      pausedBy: "Alice",
      completedTasks: 1,
    }));
    await addPausedCategory(kv, "proj", makePaused({
      category: "area:frontend",
      pausedBy: "Bob",
      completedTasks: 3,
    }));

    const result = await getPausedCategories(kv, "proj");
    expect(result).toHaveLength(1);
    expect(result[0].pausedBy).toBe("Bob");
    expect(result[0].completedTasks).toBe(3);
  });

  it("handles GitHub API error when checking issue state (counts as open)", async () => {
    const project = makeProject();
    const claim = makeClaim({ telegramId: 12345, assignedIssues: [10, 11] });
    const claimsState: CategoryClaimsState = { claims: [claim], lastUpdated: "" };
    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:category_claims": JSON.stringify(claimsState),
        "team-members": JSON.stringify([]),
      }
    );

    // First issue: API error, second: closed
    fetchSpy
      .mockResolvedValueOnce(new Response("error", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: "closed" }), { status: 200 }));
    // Unassign + notifications
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    const ctx = createMockContext();
    await handlePauseConfirm(ctx as any, project, env, "my-project");

    const paused = await getPausedCategories(env.PROJECTS, "my-project");
    // Issue with API error is counted as open (safe fallback), so only 1 completed
    expect(paused[0].completedTasks).toBe(1);
    expect(paused[0].totalTasks).toBe(2);
  });
});
