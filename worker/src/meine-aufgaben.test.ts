/**
 * Meine Aufgaben — Unit Tests
 *
 * Tests the "Meine Aufgaben" feature: KV helpers for active task tracking,
 * today-done counter, priority sorting in the task list view, Start/Done
 * inline button flows, empty state, and escapeHtml on user content.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  getTodayDoneCount,
  incrementTodayDoneCount,
  handleMeineAufgaben,
  resolveActiveProject,
  setActiveProject,
  getTeamMembers,
  escapeHtml,
  sortByPriority,
  getIssuePriority,
  PRIORITY_EMOJIS,
  PRIORITY_DEFAULT,
} from "./index";
import type { Env, ProjectConfig, TeamMember } from "./index";

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
// Helper to build a mock Env with pre-seeded projects and team members
// ---------------------------------------------------------------------------

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

// =========================================================================
// 1. getActiveTask — reading the user's active task from KV
// =========================================================================

describe("getActiveTask", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns null when no active task exists", async () => {
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBeNull();
    expect(kv.get).toHaveBeenCalledWith("active_task:12345:my-project");
  });

  it("returns the stored issue number when set", async () => {
    await kv.put("active_task:12345:my-project", "42");
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBe(42);
  });

  it("uses the correct KV key format: active_task:{telegramId}:{projectId}", async () => {
    await getActiveTask(kv, 99999, "other-proj");
    expect(kv.get).toHaveBeenCalledWith("active_task:99999:other-proj");
  });

  it("returns null when KV contains non-numeric value", async () => {
    await kv.put("active_task:12345:my-project", "not-a-number");
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBeNull();
  });

  it("returns null when KV contains empty string", async () => {
    await kv.put("active_task:12345:my-project", "");
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBeNull();
  });

  it("returns different tasks for different projects", async () => {
    await kv.put("active_task:12345:proj-a", "10");
    await kv.put("active_task:12345:proj-b", "20");
    expect(await getActiveTask(kv, 12345, "proj-a")).toBe(10);
    expect(await getActiveTask(kv, 12345, "proj-b")).toBe(20);
  });

  it("returns different tasks for different users", async () => {
    await kv.put("active_task:111:my-project", "5");
    await kv.put("active_task:222:my-project", "7");
    expect(await getActiveTask(kv, 111, "my-project")).toBe(5);
    expect(await getActiveTask(kv, 222, "my-project")).toBe(7);
  });
});

// =========================================================================
// 2. setActiveTask — storing the user's active task in KV
// =========================================================================

describe("setActiveTask", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores the issue number in KV as a string", async () => {
    await setActiveTask(kv, 12345, "my-project", 42);
    expect(kv.put).toHaveBeenCalledWith("active_task:12345:my-project", "42");
  });

  it("round-trips correctly: set then get", async () => {
    await setActiveTask(kv, 12345, "my-project", 99);
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBe(99);
  });

  it("overwrites the previous active task when switching", async () => {
    await setActiveTask(kv, 12345, "my-project", 10);
    await setActiveTask(kv, 12345, "my-project", 20);
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBe(20);
  });

  it("does not affect other users or projects", async () => {
    await setActiveTask(kv, 111, "proj-a", 10);
    await setActiveTask(kv, 222, "proj-b", 20);
    expect(await getActiveTask(kv, 111, "proj-a")).toBe(10);
    expect(await getActiveTask(kv, 222, "proj-b")).toBe(20);
    expect(await getActiveTask(kv, 111, "proj-b")).toBeNull();
  });
});

// =========================================================================
// 3. clearActiveTask — removing the user's active task from KV
// =========================================================================

describe("clearActiveTask", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("removes the active task key from KV", async () => {
    await setActiveTask(kv, 12345, "my-project", 42);
    await clearActiveTask(kv, 12345, "my-project");
    expect(kv.delete).toHaveBeenCalledWith("active_task:12345:my-project");
  });

  it("results in null when reading after clearing", async () => {
    await setActiveTask(kv, 12345, "my-project", 42);
    await clearActiveTask(kv, 12345, "my-project");
    const result = await getActiveTask(kv, 12345, "my-project");
    expect(result).toBeNull();
  });

  it("does not throw when clearing non-existent task", async () => {
    await expect(clearActiveTask(kv, 99999, "no-project")).resolves.not.toThrow();
  });

  it("does not affect other users' active tasks", async () => {
    await setActiveTask(kv, 111, "proj", 10);
    await setActiveTask(kv, 222, "proj", 20);
    await clearActiveTask(kv, 111, "proj");
    expect(await getActiveTask(kv, 111, "proj")).toBeNull();
    expect(await getActiveTask(kv, 222, "proj")).toBe(20);
  });
});

// =========================================================================
// 4. getTodayDoneCount — reading the daily completion counter
// =========================================================================

describe("getTodayDoneCount", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns 0 when no counter exists (expired or never set)", async () => {
    const result = await getTodayDoneCount(kv, 12345);
    expect(result).toBe(0);
    expect(kv.get).toHaveBeenCalledWith("today_done:12345");
  });

  it("returns the stored counter value", async () => {
    await kv.put("today_done:12345", "3");
    const result = await getTodayDoneCount(kv, 12345);
    expect(result).toBe(3);
  });

  it("returns 0 when KV contains non-numeric value", async () => {
    await kv.put("today_done:12345", "garbage");
    const result = await getTodayDoneCount(kv, 12345);
    expect(result).toBe(0);
  });

  it("returns 0 when KV contains empty string", async () => {
    await kv.put("today_done:12345", "");
    const result = await getTodayDoneCount(kv, 12345);
    expect(result).toBe(0);
  });

  it("uses the correct KV key format: today_done:{telegramId}", async () => {
    await getTodayDoneCount(kv, 77777);
    expect(kv.get).toHaveBeenCalledWith("today_done:77777");
  });

  it("returns independent counters for different users", async () => {
    await kv.put("today_done:111", "5");
    await kv.put("today_done:222", "10");
    expect(await getTodayDoneCount(kv, 111)).toBe(5);
    expect(await getTodayDoneCount(kv, 222)).toBe(10);
  });
});

// =========================================================================
// 5. incrementTodayDoneCount — incrementing the daily counter with TTL
// =========================================================================

describe("incrementTodayDoneCount", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("increments from 0 to 1 on first call", async () => {
    const result = await incrementTodayDoneCount(kv, 12345);
    expect(result).toBe(1);
  });

  it("increments sequentially on subsequent calls", async () => {
    await incrementTodayDoneCount(kv, 12345);
    const second = await incrementTodayDoneCount(kv, 12345);
    expect(second).toBe(2);

    const third = await incrementTodayDoneCount(kv, 12345);
    expect(third).toBe(3);
  });

  it("sets a 24-hour (86400s) TTL on the counter", async () => {
    await incrementTodayDoneCount(kv, 12345);
    expect(kv.put).toHaveBeenCalledWith("today_done:12345", "1", {
      expirationTtl: 86400,
    });
  });

  it("preserves TTL on subsequent increments", async () => {
    await incrementTodayDoneCount(kv, 12345);
    await incrementTodayDoneCount(kv, 12345);

    const lastPutCall = vi.mocked(kv.put).mock.calls.find(
      (c) => c[0] === "today_done:12345" && c[1] === "2"
    );
    expect(lastPutCall).toBeDefined();
    expect(lastPutCall![2]).toEqual({ expirationTtl: 86400 });
  });

  it("returns the new count value", async () => {
    await kv.put("today_done:12345", "7");
    const result = await incrementTodayDoneCount(kv, 12345);
    expect(result).toBe(8);
  });

  it("handles independent counters for different users", async () => {
    const r1 = await incrementTodayDoneCount(kv, 111);
    const r2 = await incrementTodayDoneCount(kv, 222);
    const r3 = await incrementTodayDoneCount(kv, 111);
    expect(r1).toBe(1);
    expect(r2).toBe(1);
    expect(r3).toBe(2);
  });
});

// =========================================================================
// 6. handleMeineAufgaben — the main task list view
// =========================================================================

describe("handleMeineAufgaben", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns 'No project configured' when no projects exist", async () => {
    const env = createMockEnv({});
    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("No project configured");
    expect(text).toContain("My Tasks");
    expect(text).toContain("Test"); // firstName is included
  });

  it("returns 'No GitHub token' when project has no token", async () => {
    const project = makeProject({ githubToken: undefined });
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("No GitHub token configured");
  });

  it("returns 'not registered' when user is not a team member", async () => {
    const project = makeProject();
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify([]) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("not registered");
    expect(text).toContain("/register");
  });

  it("escapes HTML in the firstName", async () => {
    const env = createMockEnv({});
    const { text } = await handleMeineAufgaben(env, 12345, '<script>alert("xss")</script>');
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("shows empty state with 'No tasks' when user has no assigned issues", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    // GitHub API returns empty list
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("No tasks assigned to you");
    expect(text).toContain("Claim Task");
    expect(text).toContain("Today completed: <b>0</b>");
  });

  it("shows today-done counter in empty state", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "today_done:12345": "5",
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("Today completed: <b>5</b>");
  });

  it("shows assigned tasks sorted by priority (blocker first)", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Low task", labels: [{ name: "priority:low" }] },
          { number: 2, title: "Blocker task", labels: [{ name: "priority:blocker" }] },
          { number: 3, title: "High task", labels: [{ name: "priority:high" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");

    // Blocker should appear before high and low
    const blockerPos = text.indexOf("#2");
    const highPos = text.indexOf("#3");
    const lowPos = text.indexOf("#1");

    expect(blockerPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(lowPos);
  });

  it("shows blocker warning section at top when blocker issues exist", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 42, title: "Critical blocker", labels: [{ name: "priority:blocker" }] },
          { number: 43, title: "Normal task", labels: [{ name: "priority:medium" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("BLOCKER");
    expect(text).toContain("fix these first");
    expect(text).toContain("#42");
    expect(text).toContain("Critical blocker");
  });

  it("filters out pull requests from the issue list", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Real issue", labels: [{ name: "priority:high" }] },
          { number: 2, title: "A PR", labels: [], pull_request: { url: "https://..." } },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("#1");
    expect(text).toContain("Real issue");
    expect(text).not.toContain("#2");
    expect(text).not.toContain("A PR");
  });

  it("marks the active task with ACTIVE tag", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "active_task:12345:my-project": "10",
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Active task", labels: [{ name: "priority:high" }] },
          { number: 11, title: "Other task", labels: [{ name: "priority:low" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("ACTIVE");
    // Only the active task should have the ACTIVE tag
    const activeTagCount = (text.match(/ACTIVE/g) || []).length;
    expect(activeTagCount).toBe(1);
  });

  it("shows priority emojis for each task", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "High priority", labels: [{ name: "priority:high" }] },
          { number: 2, title: "Low priority", labels: [{ name: "priority:low" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain(PRIORITY_EMOJIS["priority:high"]);
    expect(text).toContain(PRIORITY_EMOJIS["priority:low"]);
  });

  it("includes Start and Done inline buttons for each task", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 5, title: "Task A", labels: [{ name: "priority:medium" }] },
          { number: 6, title: "Task B", labels: [{ name: "priority:low" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { keyboard } = await handleMeineAufgaben(env, 12345, "Test");

    // InlineKeyboard from grammy stores rows in .inline_keyboard
    const rows = keyboard.inline_keyboard;
    const allButtons = rows.flat();
    const callbackDatas = allButtons.map((b: any) => b.callback_data);

    expect(callbackDatas).toContain("mytasks_start:5");
    expect(callbackDatas).toContain("mytasks_done:5");
    expect(callbackDatas).toContain("mytasks_start:6");
    expect(callbackDatas).toContain("mytasks_done:6");
  });

  it("includes a Refresh button", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task", labels: [] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { keyboard } = await handleMeineAufgaben(env, 12345, "Test");
    const allButtons = keyboard.inline_keyboard.flat();
    const refreshBtn = allButtons.find((b: any) => b.callback_data === "mytasks_refresh");
    expect(refreshBtn).toBeDefined();
    expect(refreshBtn!.text).toContain("Refresh");
  });

  it("shows 'Active' button text for the active task's Start button", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "active_task:12345:my-project": "10",
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Active task", labels: [{ name: "priority:high" }] },
          { number: 11, title: "Other", labels: [{ name: "priority:low" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { keyboard } = await handleMeineAufgaben(env, 12345, "Test");
    const allButtons = keyboard.inline_keyboard.flat();

    // The active task should show "Active" instead of "Start"
    const activeStartBtn = allButtons.find(
      (b: any) => b.callback_data === "mytasks_start:10"
    );
    expect(activeStartBtn).toBeDefined();
    expect(activeStartBtn!.text).toContain("Active");

    // The other task should show "Start"
    const otherStartBtn = allButtons.find(
      (b: any) => b.callback_data === "mytasks_start:11"
    );
    expect(otherStartBtn).toBeDefined();
    expect(otherStartBtn!.text).toContain("Start");
  });

  it("handles GitHub API error gracefully", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("GitHub API error");
    expect(text).toContain("500");
  });

  it("shows total count of assigned tasks in the header", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task 1", labels: [{ name: "priority:high" }] },
          { number: 2, title: "Task 2", labels: [{ name: "priority:low" }] },
          { number: 3, title: "Task 3", labels: [{ name: "priority:medium" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("Assigned to you (3)");
  });

  it("escapes HTML in issue titles to prevent XSS", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: '<img src=x onerror="alert(1)">', labels: [] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).not.toContain("<img");
    expect(text).toContain("&lt;img");
  });

  it("shows today-done counter at the bottom of non-empty list", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "today_done:12345": "3",
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Task", labels: [] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("Today completed: <b>3</b>");
  });
});

// =========================================================================
// 7. KV key format consistency
// =========================================================================

describe("KV key format consistency", () => {
  it("active_task key includes both telegramId and projectId", async () => {
    const kv = createMockKV();
    await setActiveTask(kv, 12345, "my-project", 42);
    expect(kv.put).toHaveBeenCalledWith(
      "active_task:12345:my-project",
      "42"
    );
  });

  it("today_done key includes only telegramId (cross-project counter)", async () => {
    const kv = createMockKV();
    await incrementTodayDoneCount(kv, 12345);
    expect(kv.put).toHaveBeenCalledWith(
      "today_done:12345",
      expect.any(String),
      expect.objectContaining({ expirationTtl: 86400 })
    );
  });

  it("active_task and today_done keys do not collide", async () => {
    const kv = createMockKV();
    await setActiveTask(kv, 12345, "my-project", 99);
    await incrementTodayDoneCount(kv, 12345);

    // Both should exist independently
    const activeTask = await getActiveTask(kv, 12345, "my-project");
    const doneCount = await getTodayDoneCount(kv, 12345);
    expect(activeTask).toBe(99);
    expect(doneCount).toBe(1);
  });
});

// =========================================================================
// 8. Priority sorting integration (specific to Meine Aufgaben display)
// =========================================================================

describe("Priority sorting in Meine Aufgaben context", () => {
  it("blocker tasks appear in a separate section before regular tasks", async () => {
    // Simulate the separation logic used in handleMeineAufgaben
    const issues = [
      { number: 1, title: "Normal", labels: [{ name: "priority:medium" }] },
      { number: 2, title: "Blocker", labels: [{ name: "priority:blocker" }] },
      { number: 3, title: "High", labels: [{ name: "priority:high" }] },
    ];

    const sorted = sortByPriority(issues.filter((i) => !("pull_request" in i)));
    const blockers = sorted.filter(
      (i) => getIssuePriority(i.labels) === "priority:blocker"
    );
    const others = sorted.filter(
      (i) => getIssuePriority(i.labels) !== "priority:blocker"
    );

    expect(blockers).toHaveLength(1);
    expect(blockers[0].number).toBe(2);
    expect(others).toHaveLength(2);
    // Others should still be sorted: high before medium
    expect(getIssuePriority(others[0].labels)).toBe("priority:high");
    expect(getIssuePriority(others[1].labels)).toBe("priority:medium");
  });

  it("issues without priority labels are treated as medium", () => {
    const issues = [
      { number: 1, title: "No label", labels: [] },
      { number: 2, title: "Low", labels: [{ name: "priority:low" }] },
      { number: 3, title: "High", labels: [{ name: "priority:high" }] },
    ];

    const sorted = sortByPriority(issues);
    expect(sorted[0].number).toBe(3); // high
    expect(sorted[1].number).toBe(1); // no label = medium
    expect(sorted[2].number).toBe(2); // low
  });
});

// =========================================================================
// 9. Callback data format for mytasks_start / mytasks_done
// =========================================================================

describe("Callback data format", () => {
  it("mytasks_start callback uses format mytasks_start:{issueNumber}", () => {
    const issueNumber = 42;
    const callbackData = `mytasks_start:${issueNumber}`;
    expect(callbackData).toBe("mytasks_start:42");

    // Parsing back
    const match = callbackData.match(/^mytasks_start:(\d+)$/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(42);
  });

  it("mytasks_done callback uses format mytasks_done:{issueNumber}", () => {
    const issueNumber = 99;
    const callbackData = `mytasks_done:${issueNumber}`;
    expect(callbackData).toBe("mytasks_done:99");

    // Parsing back
    const match = callbackData.match(/^mytasks_done:(\d+)$/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1], 10)).toBe(99);
  });

  it("mytasks_refresh callback is a plain string", () => {
    const callbackData = "mytasks_refresh";
    expect(callbackData).toBe("mytasks_refresh");
  });

  it("regex patterns match valid callback data correctly", () => {
    const startRegex = /^mytasks_start:(\d+)$/;
    const doneRegex = /^mytasks_done:(\d+)$/;

    expect(startRegex.test("mytasks_start:1")).toBe(true);
    expect(startRegex.test("mytasks_start:12345")).toBe(true);
    expect(startRegex.test("mytasks_start:abc")).toBe(false);
    expect(startRegex.test("mytasks_start:")).toBe(false);

    expect(doneRegex.test("mytasks_done:1")).toBe(true);
    expect(doneRegex.test("mytasks_done:99999")).toBe(true);
    expect(doneRegex.test("mytasks_done:")).toBe(false);
  });
});

// =========================================================================
// 10. Edge cases and regression scenarios
// =========================================================================

describe("Edge cases", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("clearing active task only when it matches the completed issue", async () => {
    const kv = createMockKV();
    // User has task #10 active, but completes task #20
    await setActiveTask(kv, 12345, "proj", 10);

    const currentActive = await getActiveTask(kv, 12345, "proj");
    // Only clear if matching
    if (currentActive === 20) {
      await clearActiveTask(kv, 12345, "proj");
    }
    // Active task should still be #10
    expect(await getActiveTask(kv, 12345, "proj")).toBe(10);
  });

  it("clearing active task when it matches the completed issue", async () => {
    const kv = createMockKV();
    await setActiveTask(kv, 12345, "proj", 10);

    const currentActive = await getActiveTask(kv, 12345, "proj");
    // Clear when matching
    if (currentActive === 10) {
      await clearActiveTask(kv, 12345, "proj");
    }
    expect(await getActiveTask(kv, 12345, "proj")).toBeNull();
  });

  it("handles all issues being pull requests (empty result after filtering)", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "PR 1", labels: [], pull_request: { url: "..." } },
          { number: 2, title: "PR 2", labels: [], pull_request: { url: "..." } },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("No tasks assigned to you");
  });

  it("multiple blocker tasks all appear in the blocker section", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Blocker A", labels: [{ name: "priority:blocker" }] },
          { number: 2, title: "Blocker B", labels: [{ name: "priority:blocker" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("BLOCKER");
    expect(text).toContain("#1");
    expect(text).toContain("#2");
    expect(text).toContain("Blocker A");
    expect(text).toContain("Blocker B");
  });

  it("active task in a different project does not show as active", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "active_task:12345:other-project": "10",
      }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 10, title: "Same number different project", labels: [] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    // Should NOT show ACTIVE tag because the active task is in a different project
    expect(text).not.toContain("ACTIVE");
  });

  it("escapeHtml handles ampersand in issue titles", () => {
    const title = "Fix login & registration";
    const escaped = escapeHtml(title);
    expect(escaped).toBe("Fix login &amp; registration");
    expect(escaped).not.toContain("& r"); // raw ampersand should be gone
  });

  it("escapeHtml handles angle brackets in issue titles", () => {
    const title = "Add <b>bold</b> support";
    const escaped = escapeHtml(title);
    expect(escaped).toBe("Add &lt;b&gt;bold&lt;/b&gt; support");
  });

  it("incrementTodayDoneCount recovers from corrupted counter value", async () => {
    const kv = createMockKV();
    // Simulate corrupted counter
    await kv.put("today_done:12345", "not-a-number");
    // getTodayDoneCount returns 0 for NaN, so increment should start from 0
    const result = await incrementTodayDoneCount(kv, 12345);
    expect(result).toBe(1);
  });

  it("handleMeineAufgaben with only blocker tasks (no regular tasks section)", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 12345, telegram_username: "testuser", github: "testgh", name: "Test" } as TeamMember,
    ];
    const env = createMockEnv(
      { "my-project": project },
      { "team-members": JSON.stringify(teamMembers) }
    );
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Only blocker", labels: [{ name: "priority:blocker" }] },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await handleMeineAufgaben(env, 12345, "Test");
    expect(text).toContain("BLOCKER");
    expect(text).toContain("#1");
    // Should NOT contain "Assigned to you" section since there are no non-blocker tasks
    expect(text).not.toContain("Assigned to you");
  });
});
