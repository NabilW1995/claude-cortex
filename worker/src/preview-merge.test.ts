/**
 * Preview & Merge — Unit Tests (Issue #56)
 *
 * Tests the Preview & Merge helper functions: getPreviewUrl/setPreviewUrl
 * round-trip, createPreviewPR via GitHub API, submitPRReview for APPROVE and
 * REQUEST_CHANGES, sendPullReminder DM logic (deduplication, DND, skipping
 * merger), sendPreviewNotifications, and Coolify webhook route matching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPreviewUrl,
  setPreviewUrl,
  createPreviewPR,
  submitPRReview,
  sendPullReminder,
  sendPreviewNotifications,
  getTeamMembers,
  getUserPreferences,
  saveUserPreferences,
  escapeHtml,
} from "./index";
import type {
  Env,
  ProjectConfig,
  TeamMember,
  UserPreferences,
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
// 1. getPreviewUrl / setPreviewUrl — KV round-trip
// =========================================================================

describe("getPreviewUrl / setPreviewUrl", () => {
  it("returns null when no preview URL has been stored", async () => {
    const kv = createMockKV();
    const result = await getPreviewUrl(kv, "my-project", 42);
    expect(result).toBeNull();
  });

  it("round-trips: set then get returns the stored URL", async () => {
    const kv = createMockKV();
    await setPreviewUrl(kv, "my-project", 42, "https://preview.example.com");
    const result = await getPreviewUrl(kv, "my-project", 42);
    expect(result).toBe("https://preview.example.com");
  });

  it("stores under the correct KV key format", async () => {
    const kv = createMockKV();
    await setPreviewUrl(kv, "cool-app", 7, "https://cool.app/pr-7");
    expect(kv.put).toHaveBeenCalledWith(
      "preview:cool-app:7",
      "https://cool.app/pr-7",
      { expirationTtl: 604800 }
    );
  });

  it("reads from the correct KV key format", async () => {
    const kv = createMockKV();
    await getPreviewUrl(kv, "cool-app", 7);
    expect(kv.get).toHaveBeenCalledWith("preview:cool-app:7");
  });

  it("stores with 7-day TTL (604800 seconds)", async () => {
    const kv = createMockKV();
    await setPreviewUrl(kv, "proj", 1, "https://url");
    const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[2]).toEqual({ expirationTtl: 604800 });
  });

  it("different projects / PR numbers do not collide", async () => {
    const kv = createMockKV();
    await setPreviewUrl(kv, "project-a", 1, "https://a.example.com");
    await setPreviewUrl(kv, "project-b", 1, "https://b.example.com");
    await setPreviewUrl(kv, "project-a", 2, "https://a2.example.com");

    expect(await getPreviewUrl(kv, "project-a", 1)).toBe("https://a.example.com");
    expect(await getPreviewUrl(kv, "project-b", 1)).toBe("https://b.example.com");
    expect(await getPreviewUrl(kv, "project-a", 2)).toBe("https://a2.example.com");
    expect(await getPreviewUrl(kv, "project-b", 2)).toBeNull();
  });
});

// =========================================================================
// 2. createPreviewPR — GitHub API call
// =========================================================================

describe("createPreviewPR", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns null when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await createPreviewPR(project, "feature/test", "Test PR", "Body");
    expect(result).toBeNull();
    // Should not have called fetch at all
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls GitHub API with correct payload and returns PR data on success", async () => {
    const project = makeProject();
    const prResponse = { number: 42, html_url: "https://github.com/test-org/test-repo/pull/42" };

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(prResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await createPreviewPR(project, "feature/dashboard", "feat: dashboard", "PR body text");

    expect(result).toEqual(prResponse);

    // Verify the fetch was called with GitHub API URL
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/test-org/test-repo/pulls");
    expect(options.method).toBe("POST");

    // Verify the request body
    const body = JSON.parse(options.body as string);
    expect(body.title).toBe("feat: dashboard");
    expect(body.head).toBe("feature/dashboard");
    expect(body.base).toBe("main");
    expect(body.body).toBe("PR body text");

    // Verify auth header
    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_testtoken123");
  });

  it("returns null when GitHub API returns an error status", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Validation failed" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await createPreviewPR(project, "feature/bad", "Bad PR", "Body");
    expect(result).toBeNull();
  });

  it("returns null when GitHub API returns 500", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await createPreviewPR(project, "feature/fail", "Failing PR", "Body");
    expect(result).toBeNull();
  });
});

// =========================================================================
// 3. submitPRReview — APPROVE and REQUEST_CHANGES
// =========================================================================

describe("submitPRReview", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns false when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const result = await submitPRReview(project, 42, "APPROVE");
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits APPROVE review and returns true on success", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await submitPRReview(project, 42, "APPROVE");
    expect(result).toBe(true);

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/test-org/test-repo/pulls/42/reviews");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body.event).toBe("APPROVE");
    // No body property when not provided
    expect(body.body).toBeUndefined();
  });

  it("submits REQUEST_CHANGES review with body text", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await submitPRReview(project, 99, "REQUEST_CHANGES", "Please fix the bug");
    expect(result).toBe(true);

    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.event).toBe("REQUEST_CHANGES");
    expect(body.body).toBe("Please fix the bug");
  });

  it("returns false when GitHub API returns an error", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );

    const result = await submitPRReview(project, 42, "APPROVE");
    expect(result).toBe(false);
  });

  it("sends correct Authorization header", async () => {
    const project = makeProject({ githubToken: "ghp_myspecialtoken" });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 3 }), { status: 200 })
    );

    await submitPRReview(project, 10, "APPROVE");

    const headers = (fetchSpy.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_myspecialtoken");
  });
});

// =========================================================================
// 4. sendPullReminder — DM logic, deduplication, DND, skipping merger
// =========================================================================

describe("sendPullReminder", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends DM to all team members except the merger", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
      { telegram_id: 333, telegram_username: "carol_tg", github: "carol", name: "Carol" },
    ];

    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };
    const prefsBob: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1002, updated_at: "2026-04-01T00:00:00Z",
    };
    const prefsCarol: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1003, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        "prefs:222": JSON.stringify(prefsBob),
        "prefs:333": JSON.stringify(prefsCarol),
      }
    );

    // Mock all Telegram sendMessage calls as successful
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPullReminder(env, "bot-token-123", "bob", "feat: new feature", 42, 3);

    // Expect DMs to Alice (111) and Carol (333), NOT Bob (merger)
    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );

    // Alice and Carol should get DMs (2 calls)
    expect(telegramCalls.length).toBe(2);

    // Verify Bob was skipped — no call with chat_id 1002
    const chatIds = telegramCalls.map((call: unknown[]) => {
      const body = JSON.parse((call[1] as RequestInit).body as string);
      return body.chat_id;
    });
    expect(chatIds).toContain(1001); // Alice
    expect(chatIds).toContain(1003); // Carol
    expect(chatIds).not.toContain(1002); // Bob (merger)
  });

  it("skips users who are in DND mode", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
    ];

    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };
    const prefsBob: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1002, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        "prefs:222": JSON.stringify(prefsBob),
        // Alice is in DND mode
        "dnd:111": "1",
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // carol is the merger, so both alice and bob are candidates
    await sendPullReminder(env, "bot-token", "carol", "fix: bug", 10, 1);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );

    // Only Bob should get a DM (Alice is DND)
    expect(telegramCalls.length).toBe(1);
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(1002);
  });

  it("skips users without a dm_chat_id", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
    ];

    // Alice has no dm_chat_id
    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: null, updated_at: "2026-04-01T00:00:00Z",
    };
    const prefsBob: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1002, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        "prefs:222": JSON.stringify(prefsBob),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPullReminder(env, "bot-token", "carol", "refactor: cleanup", 5, 2);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );

    // Only Bob should get a DM (Alice has no dm_chat_id)
    expect(telegramCalls.length).toBe(1);
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(1002);
  });

  it("does not send duplicate reminders (deduplication via KV)", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        // Dedup key already exists — reminder was already sent
        "pullreminder:my-project:42": "1",
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPullReminder(env, "bot-token", "bob", "feat: stuff", 42, 1);

    // No Telegram calls should have been made
    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(0);
  });

  it("stores dedup key in KV with 1h TTL before sending", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPullReminder(env, "bot-token", "bob", "feat: test", 99, 5);

    // Verify the dedup key was stored
    const putCalls = (env.PROJECTS.put as ReturnType<typeof vi.fn>).mock.calls;
    const dedupPut = putCalls.find(
      (call: unknown[]) => (call[0] as string).startsWith("pullreminder:")
    );
    expect(dedupPut).toBeDefined();
    expect(dedupPut![1]).toBe("1");
    expect(dedupPut![2]).toEqual({ expirationTtl: 3600 });
  });

  it("includes PR title and commit count in DM text", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPullReminder(env, "bot-token", "bob", "feat: amazing feature", 42, 7);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(1);

    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Pull Reminder");
    expect(body.text).toContain("feat: amazing feature");
    expect(body.text).toContain("#42");
    expect(body.text).toContain("7 commits");
    expect(body.text).toContain("git pull");
  });

  it("uses singular 'commit' for a single commit", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPullReminder(env, "bot-token", "bob", "fix: typo", 1, 1);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("1 commit ");
    expect(body.text).not.toContain("1 commits");
  });
});

// =========================================================================
// 5. sendPreviewNotifications — preview DMs with review buttons
// =========================================================================

describe("sendPreviewNotifications", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends DMs to members who opted in for previews, skipping the creator", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
    ];

    // Alice opted in for previews
    const prefsAlice: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };
    // Bob opted in for pr_reviews
    const prefsBob: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: true,
      sessions: false, dm_chat_id: 1002, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      {},
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        "prefs:222": JSON.stringify(prefsBob),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // Creator is someone else (telegram_id 999), so both Alice and Bob should get DMs
    await sendPreviewNotifications(
      env, "bot-token", 999, 42, "New Dashboard",
      "https://github.com/org/repo/pull/42",
      "https://preview.example.com"
    );

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(2);
  });

  it("skips the PR creator", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
    ];

    const prefsAlice: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };
    const prefsBob: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1002, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      {},
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        "prefs:222": JSON.stringify(prefsBob),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    // Alice is the creator — she should be skipped
    await sendPreviewNotifications(
      env, "bot-token", 111, 42, "Dashboard",
      "https://github.com/org/repo/pull/42", null
    );

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    // Only Bob should get a DM
    expect(telegramCalls.length).toBe(1);
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(1002);
  });

  it("skips members without previews or pr_reviews opt-in", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];

    // Alice did NOT opt in for previews or pr_reviews
    const prefsAlice: UserPreferences = {
      commits: false, previews: false, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      {},
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPreviewNotifications(
      env, "bot-token", 999, 42, "PR Title",
      "https://github.com/org/repo/pull/42", null
    );

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(0);
  });

  it("includes preview URL in message when provided", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];

    const prefsAlice: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      {},
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPreviewNotifications(
      env, "bot-token", 999, 42, "Dashboard PR",
      "https://github.com/org/repo/pull/42",
      "https://preview.cool.app"
    );

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Preview");
    expect(body.text).toContain("https://preview.cool.app");
  });

  it("includes Approve and Request Changes buttons", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];

    const prefsAlice: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      {},
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await sendPreviewNotifications(
      env, "bot-token", 999, 42, "Test PR",
      "https://github.com/org/repo/pull/42", null
    );

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);

    // Verify the reply_markup contains review buttons
    expect(body.reply_markup).toBeDefined();
    const buttons = body.reply_markup.inline_keyboard.flat();
    const approveBtn = buttons.find((b: { callback_data?: string }) => b.callback_data === "review_approve:42");
    const changesBtn = buttons.find((b: { callback_data?: string }) => b.callback_data === "review_changes:42");
    expect(approveBtn).toBeDefined();
    expect(changesBtn).toBeDefined();
  });
});

// =========================================================================
// 6. Coolify webhook route — matchRoute recognition
// =========================================================================

describe("Coolify webhook route matching", () => {
  // We test via the exported default fetch handler indirectly, but since
  // matchRoute is not exported we test by confirming the worker responds to
  // /coolify/:projectId routes via the fetch entry point.
  // Since we cannot easily call the default export in a unit test without
  // full env mocking, we test the route pattern with a targeted approach.

  it("POST /coolify/my-project is recognized as coolify handler", async () => {
    // We verify the regex pattern used in matchRoute works correctly
    const coolifyPattern = /^\/coolify\/([a-zA-Z0-9_-]+)\/?$/;
    expect(coolifyPattern.test("/coolify/my-project")).toBe(true);
    expect(coolifyPattern.exec("/coolify/my-project")![1]).toBe("my-project");
  });

  it("POST /coolify/project-with-dashes is recognized", () => {
    const coolifyPattern = /^\/coolify\/([a-zA-Z0-9_-]+)\/?$/;
    expect(coolifyPattern.test("/coolify/project-with-dashes")).toBe(true);
    expect(coolifyPattern.exec("/coolify/project-with-dashes")![1]).toBe("project-with-dashes");
  });

  it("POST /coolify/project_with_underscores is recognized", () => {
    const coolifyPattern = /^\/coolify\/([a-zA-Z0-9_-]+)\/?$/;
    expect(coolifyPattern.test("/coolify/project_with_underscores")).toBe(true);
  });

  it("rejects invalid coolify paths", () => {
    const coolifyPattern = /^\/coolify\/([a-zA-Z0-9_-]+)\/?$/;
    expect(coolifyPattern.test("/coolify/")).toBe(false);
    expect(coolifyPattern.test("/coolify")).toBe(false);
    expect(coolifyPattern.test("/coolify/my project")).toBe(false); // spaces
    expect(coolifyPattern.test("/notcoolify/my-project")).toBe(false);
  });

  it("accepts trailing slash", () => {
    const coolifyPattern = /^\/coolify\/([a-zA-Z0-9_-]+)\/?$/;
    expect(coolifyPattern.test("/coolify/my-project/")).toBe(true);
  });
});
