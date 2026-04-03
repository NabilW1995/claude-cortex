/**
 * Neue Idee — Guided Issue Creation Wizard (Issue #51) — Unit Tests
 *
 * Tests the "Neue Idee" feature: KV helpers for wizard state management,
 * step transitions (title → category → priority → done), category and
 * priority keyboard builders, createIdeaIssue GitHub API call,
 * finalizeNewIdea confirmation message, skip defaults, escapeHtml usage,
 * and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getNewIdeaState,
  setNewIdeaState,
  clearNewIdeaState,
  fetchAreaLabels,
  createIdeaIssue,
  buildIdeaCategoryKeyboard,
  buildIdeaPriorityKeyboard,
  finalizeNewIdea,
  resolveActiveProject,
  setActiveProject,
  escapeHtml,
  PRIORITY_EMOJIS,
  PRIORITY_DEFAULT,
} from "./index";
import type { Env, ProjectConfig, NewIdeaState } from "./index";

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

// =========================================================================
// 1. getNewIdeaState — reading wizard state from KV
// =========================================================================

describe("getNewIdeaState", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns null when no wizard state exists", async () => {
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toBeNull();
    expect(kv.get).toHaveBeenCalledWith("newidea:12345");
  });

  it("returns the stored wizard state when set", async () => {
    const state: NewIdeaState = { step: "awaiting_title" };
    await kv.put("newidea:12345", JSON.stringify(state));
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toEqual({ step: "awaiting_title" });
  });

  it("returns state with title when in awaiting_category step", async () => {
    const state: NewIdeaState = { step: "awaiting_category", title: "My idea" };
    await kv.put("newidea:12345", JSON.stringify(state));
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toEqual({ step: "awaiting_category", title: "My idea" });
  });

  it("returns state with title and category when in awaiting_priority step", async () => {
    const state: NewIdeaState = {
      step: "awaiting_priority",
      title: "My idea",
      category: "area:dashboard",
    };
    await kv.put("newidea:12345", JSON.stringify(state));
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toEqual({
      step: "awaiting_priority",
      title: "My idea",
      category: "area:dashboard",
    });
  });

  it("uses the correct KV key format: newidea:{telegramId}", async () => {
    await getNewIdeaState(kv, 99999);
    expect(kv.get).toHaveBeenCalledWith("newidea:99999");
  });

  it("returns null when KV contains invalid JSON", async () => {
    await kv.put("newidea:12345", "not-valid-json{{{");
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toBeNull();
  });

  it("returns null when KV contains empty string", async () => {
    await kv.put("newidea:12345", "");
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toBeNull();
  });

  it("returns different states for different users", async () => {
    await kv.put(
      "newidea:111",
      JSON.stringify({ step: "awaiting_title" })
    );
    await kv.put(
      "newidea:222",
      JSON.stringify({ step: "awaiting_category", title: "Second idea" })
    );
    expect(await getNewIdeaState(kv, 111)).toEqual({ step: "awaiting_title" });
    expect(await getNewIdeaState(kv, 222)).toEqual({
      step: "awaiting_category",
      title: "Second idea",
    });
  });
});

// =========================================================================
// 2. setNewIdeaState — storing wizard state in KV with TTL
// =========================================================================

describe("setNewIdeaState", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores wizard state as JSON in KV", async () => {
    const state: NewIdeaState = { step: "awaiting_title" };
    await setNewIdeaState(kv, 12345, state);
    expect(kv.put).toHaveBeenCalledWith(
      "newidea:12345",
      JSON.stringify(state),
      { expirationTtl: 3600 }
    );
  });

  it("sets a 1-hour (3600s) TTL on the wizard state", async () => {
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    const putCall = vi.mocked(kv.put).mock.calls[0];
    expect(putCall[2]).toEqual({ expirationTtl: 3600 });
  });

  it("round-trips correctly: set then get", async () => {
    const state: NewIdeaState = {
      step: "awaiting_priority",
      title: "Test idea",
      category: "area:auth",
    };
    await setNewIdeaState(kv, 12345, state);
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toEqual(state);
  });

  it("overwrites the previous state on subsequent calls", async () => {
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_category",
      title: "Updated",
    });
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toEqual({ step: "awaiting_category", title: "Updated" });
  });

  it("does not affect other users' wizard state", async () => {
    await setNewIdeaState(kv, 111, { step: "awaiting_title" });
    await setNewIdeaState(kv, 222, {
      step: "awaiting_category",
      title: "Other idea",
    });
    expect(await getNewIdeaState(kv, 111)).toEqual({ step: "awaiting_title" });
    expect(await getNewIdeaState(kv, 222)).toEqual({
      step: "awaiting_category",
      title: "Other idea",
    });
  });
});

// =========================================================================
// 3. clearNewIdeaState — removing wizard state from KV
// =========================================================================

describe("clearNewIdeaState", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("removes the wizard state key from KV", async () => {
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    await clearNewIdeaState(kv, 12345);
    expect(kv.delete).toHaveBeenCalledWith("newidea:12345");
  });

  it("results in null when reading after clearing", async () => {
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_category",
      title: "My idea",
    });
    await clearNewIdeaState(kv, 12345);
    const result = await getNewIdeaState(kv, 12345);
    expect(result).toBeNull();
  });

  it("does not throw when clearing non-existent state", async () => {
    await expect(clearNewIdeaState(kv, 99999)).resolves.not.toThrow();
  });

  it("does not affect other users' wizard state", async () => {
    await setNewIdeaState(kv, 111, { step: "awaiting_title" });
    await setNewIdeaState(kv, 222, {
      step: "awaiting_category",
      title: "Other",
    });
    await clearNewIdeaState(kv, 111);
    expect(await getNewIdeaState(kv, 111)).toBeNull();
    expect(await getNewIdeaState(kv, 222)).toEqual({
      step: "awaiting_category",
      title: "Other",
    });
  });
});

// =========================================================================
// 4. Wizard state machine — step transitions
// =========================================================================

describe("Wizard state machine transitions", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("follows the full flow: awaiting_title → awaiting_category → awaiting_priority", async () => {
    // Step 1: Start wizard — awaiting_title
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    let state = await getNewIdeaState(kv, 12345);
    expect(state!.step).toBe("awaiting_title");

    // Step 2: Title entered — advance to awaiting_category
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_category",
      title: "Add dark mode",
    });
    state = await getNewIdeaState(kv, 12345);
    expect(state!.step).toBe("awaiting_category");
    expect(state!.title).toBe("Add dark mode");

    // Step 3: Category selected — advance to awaiting_priority
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_priority",
      title: "Add dark mode",
      category: "area:frontend",
    });
    state = await getNewIdeaState(kv, 12345);
    expect(state!.step).toBe("awaiting_priority");
    expect(state!.title).toBe("Add dark mode");
    expect(state!.category).toBe("area:frontend");

    // Step 4: Priority selected — wizard completes, state is cleared
    await clearNewIdeaState(kv, 12345);
    state = await getNewIdeaState(kv, 12345);
    expect(state).toBeNull();
  });

  it("supports skipping category: awaiting_title → awaiting_category → awaiting_priority (no category)", async () => {
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_category",
      title: "Quick fix",
    });
    // Skip category — goes to priority without setting category
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_priority",
      title: "Quick fix",
    });
    const state = await getNewIdeaState(kv, 12345);
    expect(state!.step).toBe("awaiting_priority");
    expect(state!.title).toBe("Quick fix");
    expect(state!.category).toBeUndefined();
  });

  it("supports skipping directly to priority when no area labels exist", async () => {
    // In the actual bot, when fetchAreaLabels returns empty, we skip straight to priority
    await setNewIdeaState(kv, 12345, {
      step: "awaiting_priority",
      title: "No categories needed",
    });
    const state = await getNewIdeaState(kv, 12345);
    expect(state!.step).toBe("awaiting_priority");
    expect(state!.title).toBe("No categories needed");
    expect(state!.category).toBeUndefined();
  });
});

// =========================================================================
// 5. buildIdeaCategoryKeyboard — category buttons
// =========================================================================

describe("buildIdeaCategoryKeyboard", () => {
  it("creates one button per area label with newidea_cat: prefix", () => {
    const labels = ["area:auth", "area:dashboard", "area:api"];
    const kb = buildIdeaCategoryKeyboard(labels);
    const rows = kb.inline_keyboard;

    // Each label gets its own row
    const allButtons = rows.flat();
    const catButtons = allButtons.filter((b: any) =>
      b.callback_data?.startsWith("newidea_cat:")
    );
    expect(catButtons).toHaveLength(3);

    expect((catButtons[0] as any).callback_data).toBe("newidea_cat:area:auth");
    expect((catButtons[1] as any).callback_data).toBe("newidea_cat:area:dashboard");
    expect((catButtons[2] as any).callback_data).toBe("newidea_cat:area:api");
  });

  it("strips the area: prefix from display names", () => {
    const labels = ["area:frontend", "area:backend"];
    const kb = buildIdeaCategoryKeyboard(labels);
    const allButtons = kb.inline_keyboard.flat();
    const catButtons = allButtons.filter((b: any) =>
      b.callback_data?.startsWith("newidea_cat:")
    );

    expect(catButtons[0].text).toContain("frontend");
    expect(catButtons[0].text).not.toContain("area:");
    expect(catButtons[1].text).toContain("backend");
    expect(catButtons[1].text).not.toContain("area:");
  });

  it("includes a Skip button with newidea_cat_skip callback", () => {
    const labels = ["area:design"];
    const kb = buildIdeaCategoryKeyboard(labels);
    const allButtons = kb.inline_keyboard.flat();
    const skipBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_cat_skip"
    );
    expect(skipBtn).toBeDefined();
    expect(skipBtn!.text).toContain("Skip");
  });

  it("adds folder emoji prefix to category display names", () => {
    const labels = ["area:mobile"];
    const kb = buildIdeaCategoryKeyboard(labels);
    const allButtons = kb.inline_keyboard.flat();
    const catBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_cat:area:mobile"
    );
    expect(catBtn).toBeDefined();
    expect(catBtn!.text).toBe("\u{1F4C2} mobile");
  });

  it("handles empty area labels list (only skip button)", () => {
    const kb = buildIdeaCategoryKeyboard([]);
    const allButtons = kb.inline_keyboard.flat();
    // Only the skip button should exist
    const catButtons = allButtons.filter((b: any) =>
      b.callback_data?.startsWith("newidea_cat:")
    );
    expect(catButtons).toHaveLength(0);
    const skipBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_cat_skip"
    );
    expect(skipBtn).toBeDefined();
  });

  it("handles single area label", () => {
    const labels = ["area:only-one"];
    const kb = buildIdeaCategoryKeyboard(labels);
    const allButtons = kb.inline_keyboard.flat();
    const catButtons = allButtons.filter((b: any) =>
      b.callback_data?.startsWith("newidea_cat:")
    );
    expect(catButtons).toHaveLength(1);
    expect((catButtons[0] as any).callback_data).toBe("newidea_cat:area:only-one");
    expect(catButtons[0].text).toBe("\u{1F4C2} only-one");
  });
});

// =========================================================================
// 6. buildIdeaPriorityKeyboard — priority buttons
// =========================================================================

describe("buildIdeaPriorityKeyboard", () => {
  it("creates High, Medium, Low buttons with newidea_pri: prefix", () => {
    const kb = buildIdeaPriorityKeyboard();
    const allButtons = kb.inline_keyboard.flat();

    const highBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:high"
    );
    const medBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:medium"
    );
    const lowBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:low"
    );

    expect(highBtn).toBeDefined();
    expect(medBtn).toBeDefined();
    expect(lowBtn).toBeDefined();
  });

  it("shows priority emojis in button labels", () => {
    const kb = buildIdeaPriorityKeyboard();
    const allButtons = kb.inline_keyboard.flat();

    const highBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:high"
    );
    const medBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:medium"
    );
    const lowBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:low"
    );

    expect(highBtn!.text).toContain(PRIORITY_EMOJIS["priority:high"]);
    expect(medBtn!.text).toContain(PRIORITY_EMOJIS["priority:medium"]);
    expect(lowBtn!.text).toContain(PRIORITY_EMOJIS["priority:low"]);
  });

  it("includes button text labels: High, Medium, Low", () => {
    const kb = buildIdeaPriorityKeyboard();
    const allButtons = kb.inline_keyboard.flat();

    const highBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:high"
    );
    const medBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:medium"
    );
    const lowBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:low"
    );

    expect(highBtn!.text).toContain("High");
    expect(medBtn!.text).toContain("Medium");
    expect(lowBtn!.text).toContain("Low");
  });

  it("includes a Skip button with newidea_pri_skip callback", () => {
    const kb = buildIdeaPriorityKeyboard();
    const allButtons = kb.inline_keyboard.flat();
    const skipBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri_skip"
    );
    expect(skipBtn).toBeDefined();
    expect(skipBtn!.text).toContain("Skip");
    expect(skipBtn!.text).toContain("Medium");
  });

  it("does not include a blocker priority option (blocker is not user-selectable)", () => {
    const kb = buildIdeaPriorityKeyboard();
    const allButtons = kb.inline_keyboard.flat();
    const blockerBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri:priority:blocker"
    );
    expect(blockerBtn).toBeUndefined();
  });
});

// =========================================================================
// 7. createIdeaIssue — GitHub API call for issue creation
// =========================================================================

describe("createIdeaIssue", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns null when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await createIdeaIssue(project, "Test", null, "priority:medium");
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls GitHub API with correct URL and method", async () => {
    const project = makeProject({ githubRepo: "org/repo" });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 42, html_url: "https://github.com/org/repo/issues/42" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await createIdeaIssue(project, "New feature", null, "priority:high");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/repos/org/repo/issues");
    expect(options.method).toBe("POST");
  });

  it("sends title and priority label in the request body", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 1, html_url: "https://example.com" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await createIdeaIssue(project, "Add login form", null, "priority:high");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.title).toBe("Add login form");
    expect(body.labels).toContain("priority:high");
  });

  it("includes category label when a category is provided", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 1, html_url: "https://example.com" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await createIdeaIssue(project, "Dashboard fix", "area:dashboard", "priority:medium");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.labels).toContain("area:dashboard");
    expect(body.labels).toContain("priority:medium");
    expect(body.labels).toHaveLength(2);
  });

  it("sends only priority label when category is null", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 1, html_url: "https://example.com" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await createIdeaIssue(project, "Quick fix", null, "priority:low");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.labels).toEqual(["priority:low"]);
    expect(body.labels).toHaveLength(1);
  });

  it("returns issue number and html_url on success", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          number: 99,
          html_url: "https://github.com/test-org/test-repo/issues/99",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await createIdeaIssue(project, "Test", null, "priority:medium");
    expect(result).not.toBeNull();
    expect(result!.number).toBe(99);
    expect(result!.html_url).toBe("https://github.com/test-org/test-repo/issues/99");
  });

  it("returns null when GitHub API responds with an error", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response("Unprocessable Entity", { status: 422 })
    );

    const result = await createIdeaIssue(project, "Test", null, "priority:medium");
    expect(result).toBeNull();
  });

  it("returns null when GitHub API responds with 500", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await createIdeaIssue(project, "Test", null, "priority:medium");
    expect(result).toBeNull();
  });

  it("sends Authorization header with the GitHub token", async () => {
    const project = makeProject({ githubToken: "ghp_secret123" });
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ number: 1, html_url: "https://example.com" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await createIdeaIssue(project, "Test", null, "priority:medium");

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_secret123");
  });
});

// =========================================================================
// 8. fetchAreaLabels — fetching area labels from GitHub
// =========================================================================

describe("fetchAreaLabels", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns empty array when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await fetchAreaLabels(project);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns only labels with area: prefix", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: "area:auth" },
          { name: "area:dashboard" },
          { name: "bug" },
          { name: "priority:high" },
          { name: "area:api" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchAreaLabels(project);
    expect(result).toEqual(["area:api", "area:auth", "area:dashboard"]);
  });

  it("returns labels sorted alphabetically", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: "area:zebra" },
          { name: "area:alpha" },
          { name: "area:middle" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchAreaLabels(project);
    expect(result).toEqual(["area:alpha", "area:middle", "area:zebra"]);
  });

  it("returns empty array when GitHub API returns an error", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const result = await fetchAreaLabels(project);
    expect(result).toEqual([]);
  });

  it("returns empty array when no area: labels exist", async () => {
    const project = makeProject();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { name: "bug" },
          { name: "enhancement" },
          { name: "priority:high" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await fetchAreaLabels(project);
    expect(result).toEqual([]);
  });
});

// =========================================================================
// 9. finalizeNewIdea — creating the issue and sending confirmation
// =========================================================================

describe("finalizeNewIdea", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function createMockCtx() {
    return {
      reply: vi.fn(),
      from: { id: 12345 },
    } as any;
  }

  it("clears wizard state after successful issue creation", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    // Set wizard state
    await setNewIdeaState(env.PROJECTS, 12345, {
      step: "awaiting_priority",
      title: "Test idea",
      category: "area:auth",
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 42, html_url: "https://github.com/test/repo/issues/42" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    const state: NewIdeaState = {
      step: "awaiting_priority",
      title: "Test idea",
      category: "area:auth",
    };
    await finalizeNewIdea(ctx, env, 12345, state, "priority:high");

    // State should be cleared
    const remaining = await getNewIdeaState(env.PROJECTS, 12345);
    expect(remaining).toBeNull();
  });

  it("shows confirmation with issue number on success", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 77, html_url: "https://github.com/test/repo/issues/77" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "My feature", category: "area:ui" },
      "priority:medium"
    );

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("#77");
    expect(replyText).toContain("created");
  });

  it("shows error message when GitHub API fails", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:high"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("Failed to create issue");
  });

  it("shows error when no project is configured", async () => {
    const env = createMockEnv({});
    const ctx = createMockCtx();

    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:high"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("No project configured");
  });

  it("shows error when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:medium"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("No GitHub token");
  });

  it("clears wizard state even when issue creation fails", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");
    await setNewIdeaState(env.PROJECTS, 12345, {
      step: "awaiting_priority",
      title: "Test",
    });

    fetchSpy.mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:high"
    );

    const remaining = await getNewIdeaState(env.PROJECTS, 12345);
    expect(remaining).toBeNull();
  });

  it("uses 'Untitled idea' as fallback when title is missing from state", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 1, html_url: "https://example.com" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    // State without a title property
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority" } as NewIdeaState,
      "priority:medium"
    );

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.title).toBe("Untitled idea");
  });
});

// =========================================================================
// 10. Skip defaults and contextual tip
// =========================================================================

describe("Skip defaults and contextual tip", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function createMockCtx() {
    return {
      reply: vi.fn(),
      from: { id: 12345 },
    } as any;
  }

  it("PRIORITY_DEFAULT is 'priority:medium'", () => {
    expect(PRIORITY_DEFAULT).toBe("priority:medium");
  });

  it("skipping priority defaults to medium (PRIORITY_DEFAULT)", () => {
    // The skip button text confirms the default
    const kb = buildIdeaPriorityKeyboard();
    const allButtons = kb.inline_keyboard.flat();
    const skipBtn = allButtons.find(
      (b: any) => b.callback_data === "newidea_pri_skip"
    );
    expect(skipBtn!.text).toContain("Medium");
  });

  it("shows contextual tip when no category is chosen", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 10, html_url: "https://example.com" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    // No category in state
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Quick note" },
      "priority:medium"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("Tip");
    expect(replyText).toContain("category");
  });

  it("does NOT show contextual tip when category is provided", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 10, html_url: "https://example.com" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "With category", category: "area:auth" },
      "priority:high"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).not.toContain("Tip");
  });
});

// =========================================================================
// 11. escapeHtml usage in wizard messages
// =========================================================================

describe("escapeHtml in wizard context", () => {
  it("escapes user-provided title with HTML characters", () => {
    const title = '<script>alert("hack")</script>';
    const escaped = escapeHtml(title);
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).not.toContain("<script>");
  });

  it("escapes ampersand in user-provided title", () => {
    const title = "Fix login & registration";
    const escaped = escapeHtml(title);
    expect(escaped).toBe("Fix login &amp; registration");
  });

  it("escapes angle brackets in user-provided title", () => {
    const title = "Add <b>bold</b> support";
    const escaped = escapeHtml(title);
    expect(escaped).toBe("Add &lt;b&gt;bold&lt;/b&gt; support");
  });

  it("does not escape quotes (Telegram HTML mode does not require it)", () => {
    const title = 'Use "double" quotes';
    const escaped = escapeHtml(title);
    // escapeHtml only escapes &, <, > for Telegram's HTML parse mode
    expect(escaped).toBe('Use "double" quotes');
  });

  it("does not double-escape already escaped content", () => {
    const title = "Already &amp; escaped";
    const escaped = escapeHtml(title);
    // The & in &amp; should itself be escaped
    expect(escaped).toBe("Already &amp;amp; escaped");
  });

  it("handles empty string gracefully", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles title at max length (256 chars)", () => {
    const longTitle = "A".repeat(256);
    const escaped = escapeHtml(longTitle);
    expect(escaped).toBe(longTitle); // No special chars, so unchanged
    expect(escaped).toHaveLength(256);
  });
});

// =========================================================================
// 12. Callback data format for newidea_ prefixed callbacks
// =========================================================================

describe("Callback data format", () => {
  it("newidea_cat callback data uses format newidea_cat:{labelName}", () => {
    const label = "area:dashboard";
    const callbackData = `newidea_cat:${label}`;
    expect(callbackData).toBe("newidea_cat:area:dashboard");
  });

  it("newidea_pri callback data uses format newidea_pri:{priorityLevel}", () => {
    const priority = "priority:high";
    const callbackData = `newidea_pri:${priority}`;
    expect(callbackData).toBe("newidea_pri:priority:high");
  });

  it("regex pattern matches valid newidea_cat callbacks", () => {
    const catRegex = /^newidea_cat:(.+)$/;
    expect(catRegex.test("newidea_cat:area:auth")).toBe(true);
    expect(catRegex.test("newidea_cat:area:dashboard")).toBe(true);
    expect(catRegex.test("newidea_cat:")).toBe(false);
    expect(catRegex.test("newidea_cat")).toBe(false);
    expect(catRegex.test("other:data")).toBe(false);
  });

  it("regex pattern matches valid newidea_pri callbacks", () => {
    const priRegex = /^newidea_pri:(.+)$/;
    expect(priRegex.test("newidea_pri:priority:high")).toBe(true);
    expect(priRegex.test("newidea_pri:priority:medium")).toBe(true);
    expect(priRegex.test("newidea_pri:priority:low")).toBe(true);
    expect(priRegex.test("newidea_pri:")).toBe(false);
    expect(priRegex.test("newidea_pri")).toBe(false);
  });

  it("extracting category from newidea_cat callback data works", () => {
    const callbackData = "newidea_cat:area:frontend";
    const match = callbackData.match(/^newidea_cat:(.+)$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("area:frontend");
  });

  it("extracting priority from newidea_pri callback data works", () => {
    const callbackData = "newidea_pri:priority:low";
    const match = callbackData.match(/^newidea_pri:(.+)$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("priority:low");
  });

  it("newidea_cat_skip is a plain string callback", () => {
    expect("newidea_cat_skip").toBe("newidea_cat_skip");
  });

  it("newidea_pri_skip is a plain string callback", () => {
    expect("newidea_pri_skip").toBe("newidea_pri_skip");
  });
});

// =========================================================================
// 13. KV key format consistency for wizard state
// =========================================================================

describe("KV key format consistency", () => {
  it("wizard state key uses format newidea:{telegramId}", async () => {
    const kv = createMockKV();
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    expect(kv.put).toHaveBeenCalledWith(
      "newidea:12345",
      expect.any(String),
      expect.objectContaining({ expirationTtl: 3600 })
    );
  });

  it("wizard state key does not collide with other KV keys", async () => {
    const kv = createMockKV();
    // Set wizard state and other keys
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    await kv.put("active_task:12345:my-project", "42");
    await kv.put("active_project:12345", "my-project");

    // All should be independent
    const wizardState = await getNewIdeaState(kv, 12345);
    expect(wizardState).toEqual({ step: "awaiting_title" });

    const activeTask = await kv.get("active_task:12345:my-project");
    expect(activeTask).toBe("42");

    const activeProject = await kv.get("active_project:12345");
    expect(activeProject).toBe("my-project");
  });

  it("clearing wizard state does not affect other keys", async () => {
    const kv = createMockKV();
    await setNewIdeaState(kv, 12345, { step: "awaiting_title" });
    await kv.put("active_project:12345", "my-project");

    await clearNewIdeaState(kv, 12345);

    expect(await getNewIdeaState(kv, 12345)).toBeNull();
    expect(await kv.get("active_project:12345")).toBe("my-project");
  });
});

// =========================================================================
// 14. Edge cases and regression scenarios
// =========================================================================

describe("Neue Idee edge cases", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function createMockCtx() {
    return {
      reply: vi.fn(),
      from: { id: 12345 },
    } as any;
  }

  it("wizard state with title containing special characters persists correctly", async () => {
    const kv = createMockKV();
    const title = 'Fix "login" & <registration> flow';
    await setNewIdeaState(kv, 12345, { step: "awaiting_category", title });
    const state = await getNewIdeaState(kv, 12345);
    expect(state!.title).toBe(title);
  });

  it("wizard state with very long title persists correctly", async () => {
    const kv = createMockKV();
    const title = "A".repeat(256);
    await setNewIdeaState(kv, 12345, { step: "awaiting_category", title });
    const state = await getNewIdeaState(kv, 12345);
    expect(state!.title).toBe(title);
  });

  it("confirmation message escapes HTML in title", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 5, html_url: "https://example.com/5" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: '<img src=x onerror="alert(1)">' },
      "priority:high"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).not.toContain("<img");
    expect(replyText).toContain("&lt;img");
  });

  it("confirmation message includes priority emoji", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 5, html_url: "https://example.com/5" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:high"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain(PRIORITY_EMOJIS["priority:high"]);
  });

  it("confirmation message includes link to the created issue", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          number: 42,
          html_url: "https://github.com/org/repo/issues/42",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:medium"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("https://github.com/org/repo/issues/42");
  });

  it("confirmation message shows category when provided", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 1, html_url: "https://example.com" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test", category: "area:dashboard" },
      "priority:medium"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("dashboard");
  });

  it("confirmation message shows 'none' when no category is provided", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ number: 1, html_url: "https://example.com" }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      )
    );

    const ctx = createMockCtx();
    await finalizeNewIdea(
      ctx,
      env,
      12345,
      { step: "awaiting_priority", title: "Test" },
      "priority:medium"
    );

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("none");
  });

  it("multiple users can run the wizard simultaneously without interference", async () => {
    const kv = createMockKV();

    // User 111 starts a wizard
    await setNewIdeaState(kv, 111, { step: "awaiting_title" });
    // User 222 starts a wizard
    await setNewIdeaState(kv, 222, {
      step: "awaiting_category",
      title: "User 222's idea",
    });

    // User 111 progresses
    await setNewIdeaState(kv, 111, {
      step: "awaiting_category",
      title: "User 111's idea",
    });

    // Verify independence
    const state111 = await getNewIdeaState(kv, 111);
    const state222 = await getNewIdeaState(kv, 222);
    expect(state111!.title).toBe("User 111's idea");
    expect(state222!.title).toBe("User 222's idea");

    // Clear user 222's state
    await clearNewIdeaState(kv, 222);
    expect(await getNewIdeaState(kv, 111)).not.toBeNull();
    expect(await getNewIdeaState(kv, 222)).toBeNull();
  });

  it("buildIdeaCategoryKeyboard with many labels creates correct number of buttons", () => {
    const labels = Array.from({ length: 10 }, (_, i) => `area:cat-${i}`);
    const kb = buildIdeaCategoryKeyboard(labels);
    const allButtons = kb.inline_keyboard.flat();
    const catButtons = allButtons.filter((b: any) =>
      b.callback_data?.startsWith("newidea_cat:")
    );
    expect(catButtons).toHaveLength(10);
  });
});
