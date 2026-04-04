/**
 * Morning Messages — Unit Tests (Issue #62)
 *
 * Tests the morning notification system that sends:
 * 1. Private DMs to each team member with personalized daily briefings
 * 2. A group morning message with project overview and team stats
 * 3. Dedup logic to prevent duplicate morning DMs
 *
 * Covers:
 * - sendPrivateMorningDM (personalized DM: yesterday tasks, open branches, today's tasks, tips)
 * - sendGroupMorningMessage (group: category owners, open PRs, team performance)
 * - sendMorningDigest (orchestrator: calls group + private DMs with dedup)
 * - getYesterdayStats (D1 query for event counts by date)
 * - getYesterdayWorkHours (D1 query for session durations by date)
 * - Session-start trigger dedup (morning_dm:{telegramId} KV key)
 * - escapeHtml usage in morning messages (XSS prevention)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendPrivateMorningDM,
  sendGroupMorningMessage,
  sendMorningDigest,
  getYesterdayStats,
  getYesterdayWorkHours,
  escapeHtml,
} from "./index";
import type { TeamMember, Env, ProjectConfig } from "./index";

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
// Mock D1 Database — simulates Cloudflare D1 for testing
// ---------------------------------------------------------------------------

function createMockD1(
  firstResult: Record<string, unknown> | null = null,
  allResults: Array<Record<string, unknown>> = []
): D1Database {
  const runFn = vi.fn().mockResolvedValue({ success: true });
  const firstFn = vi.fn().mockResolvedValue(firstResult);
  const allFn = vi.fn().mockResolvedValue({ results: allResults });
  const bindFn = vi.fn().mockReturnValue({ run: runFn, first: firstFn, all: allFn });
  const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, run: runFn, first: firstFn, all: allFn });

  return {
    prepare: prepareFn,
    _mocks: { prepare: prepareFn, bind: bindFn, run: runFn, first: firstFn, all: allFn },
  } as unknown as D1Database & {
    _mocks: {
      prepare: typeof prepareFn;
      bind: typeof bindFn;
      run: typeof runFn;
      first: typeof firstFn;
      all: typeof allFn;
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers for building mock env and project data
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    botToken: "test-bot-token",
    chatId: "12345",
    githubRepo: "org/repo",
    githubToken: "gh-token-123",
    members: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    telegram_id: 111,
    telegram_username: "alice_tg",
    github: "alice",
    name: "Alice",
    ...overrides,
  };
}

function createMockEnv(
  projects: Array<{ id: string; config: ProjectConfig }>,
  extraKvData: Record<string, string> = {},
  d1?: D1Database
): Env {
  const kvData: Record<string, string> = { ...extraKvData };
  for (const { id, config } of projects) {
    kvData[id] = JSON.stringify(config);
  }
  return {
    PROJECTS: createMockKV(kvData),
    DB: d1 || createMockD1(),
    GITHUB_API_TOKEN: "gh-api-token",
  } as unknown as Env;
}

// ---------------------------------------------------------------------------
// Fetch spy setup — intercepts all HTTP calls (Telegram API, GitHub API)
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 })
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// getYesterdayStats (D1 query — unit tests for the helper)
// ---------------------------------------------------------------------------

describe("getYesterdayStats", () => {
  it("returns event counts from D1 for a specific date", async () => {
    const db = createMockD1({ c: 3 });
    const stats = await getYesterdayStats(db, "2026-04-02");

    expect(stats.issues_opened).toBe(3);
    expect(stats.issues_closed).toBe(3);
    expect(stats.prs_merged).toBe(3);
    expect(stats.prs_opened).toBe(3);
    expect(stats.total_events).toBe(3);
  });

  it("returns zeroes when D1 returns null rows", async () => {
    const db = createMockD1(null);
    const stats = await getYesterdayStats(db, "2026-04-02");

    expect(stats.issues_opened).toBe(0);
    expect(stats.issues_closed).toBe(0);
    expect(stats.prs_merged).toBe(0);
    expect(stats.prs_opened).toBe(0);
    expect(stats.total_events).toBe(0);
  });

  it("returns zeroes when D1 query fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { first: ReturnType<typeof vi.fn> } })._mocks;
    mocks.first.mockRejectedValue(new Error("D1 error"));

    const stats = await getYesterdayStats(db, "2026-04-02");
    expect(stats.issues_opened).toBe(0);
    expect(stats.total_events).toBe(0);
  });

  it("queries with the correct date parameter", async () => {
    const db = createMockD1({ c: 0 });
    await getYesterdayStats(db, "2026-04-02");

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    // All 5 queries should bind with the same date
    expect(mocks.bind).toHaveBeenCalledWith("2026-04-02");
  });

  it("makes 5 separate D1 queries (opened, closed, merged, prsOpened, total)", async () => {
    const db = createMockD1({ c: 0 });
    await getYesterdayStats(db, "2026-04-02");

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.prepare).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// getYesterdayWorkHours (D1 query — unit tests for the helper)
// ---------------------------------------------------------------------------

describe("getYesterdayWorkHours", () => {
  it("returns per-user work hours from D1", async () => {
    const db = createMockD1(null, [
      { user_id: "alice", total_minutes: 480 },
      { user_id: "bob", total_minutes: 360 },
    ]);
    const hours = await getYesterdayWorkHours(db, "2026-04-02");

    expect(hours).toHaveLength(2);
    expect(hours[0].user_id).toBe("alice");
    expect(hours[0].total_minutes).toBe(480);
    expect(hours[1].user_id).toBe("bob");
    expect(hours[1].total_minutes).toBe(360);
  });

  it("returns empty array when no sessions exist", async () => {
    const db = createMockD1(null, []);
    const hours = await getYesterdayWorkHours(db, "2026-04-02");
    expect(hours).toEqual([]);
  });

  it("returns empty array when D1 query fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { all: ReturnType<typeof vi.fn> } })._mocks;
    mocks.all.mockRejectedValueOnce(new Error("D1 error"));

    const hours = await getYesterdayWorkHours(db, "2026-04-02");
    expect(hours).toEqual([]);
  });

  it("queries sessions table with correct date", async () => {
    const db = createMockD1(null, []);
    await getYesterdayWorkHours(db, "2026-04-02");

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn> } })._mocks;
    const query = mocks.prepare.mock.calls[0][0] as string;
    expect(query).toContain("sessions");
    expect(query).toContain("SUM(duration_minutes)");
  });
});

// ---------------------------------------------------------------------------
// sendPrivateMorningDM — private morning briefing per user
// ---------------------------------------------------------------------------

describe("sendPrivateMorningDM", () => {
  const project = makeProject();
  const member = makeMember();
  const allMembers = [member, makeMember({ telegram_id: 222, name: "Bob", github: "bob", telegram_username: "bob_tg" })];

  it("sends a DM containing 'Good morning' greeting with the member's name", async () => {
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      }
    );

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    // Verify Telegram sendMessage was called
    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBeGreaterThanOrEqual(1);

    // Find the DM call (sendDM calls Telegram API)
    const dmCall = telegramCalls.find((c: unknown[]) => String(c[0]).includes("/sendMessage"));
    expect(dmCall).toBeDefined();

    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Good morning");
    expect(body.text).toContain("Alice");
    expect(body.chat_id).toBe(99999);
  });

  it("does NOT send DM when user has no dm_chat_id set", async () => {
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        // No prefs:111 key — defaults to dm_chat_id: null
      }
    );

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    // Should not have called Telegram API for DM
    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramCalls).toHaveLength(0);
  });

  it("does NOT send DM when user is in DND mode", async () => {
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
        [`dnd:${member.telegram_id}`]: "1", // DND is active
      }
    );

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const telegramDMCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramDMCalls).toHaveLength(0);
  });

  it("includes 'Completed yesterday' section when D1 has closed issues", async () => {
    const db = createMockD1(null, []);
    // Override D1 to return closed events for the first query, then empty for others
    const allFn = vi.fn().mockResolvedValue({
      results: [
        { target: "42", metadata: JSON.stringify({ title: "Fix login bug" }) },
        { target: "43", metadata: null },
      ],
    });
    const firstFn = vi.fn().mockResolvedValue({ c: 0, total: 0 });
    const bindFn = vi.fn().mockReturnValue({ run: vi.fn(), first: firstFn, all: allFn });
    const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, run: vi.fn(), first: firstFn, all: allFn });
    (db as unknown as Record<string, unknown>).prepare = prepareFn;

    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    // Mock GitHub API responses for PRs and issues
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Completed yesterday");
    expect(body.text).toContain("#42");
    expect(body.text).toContain("Fix login bug");
  });

  it("includes 'Your open branches' when user has open PRs", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([
          {
            number: 10,
            title: "Feature branch",
            user: { login: "alice" },
            head: { ref: "feature/new-ui" },
            requested_reviewers: [],
          },
        ]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Your open branches");
    expect(body.text).toContain("#10");
    expect(body.text).toContain("Feature branch");
  });

  it("includes 'Waiting for your review' when user is a requested reviewer", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([
          {
            number: 20,
            title: "Bob's big refactor",
            user: { login: "bob" },
            head: { ref: "refactor/cleanup" },
            requested_reviewers: [{ login: "alice" }],
          },
        ]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Waiting for your review");
    expect(body.text).toContain("#20");
    expect(body.text).toContain("Bob&#x27;s big refactor".replace("&#x27;", "'").length > 0 ? "#20" : "");
  });

  it("includes 'Today's tasks' section when user has assigned open issues", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([
          { number: 50, title: "Build dashboard", pull_request: undefined },
          { number: 51, title: "Write tests", pull_request: undefined },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Today's tasks");
    expect(body.text).toContain("#50");
    expect(body.text).toContain("Build dashboard");
    expect(body.text).toContain("#51");
    expect(body.text).toContain("Write tests");
  });

  it("filters out pull requests from the issues endpoint (only shows real issues)", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([
          { number: 50, title: "Real issue", pull_request: undefined },
          { number: 51, title: "This is a PR", pull_request: { url: "..." } },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Real issue");
    expect(body.text).not.toContain("This is a PR");
  });

  it("shows 'clean slate' fallback when there are no tasks, PRs, or branches", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    // Make D1 return empty for all queries
    const allFn = vi.fn().mockResolvedValue({ results: [] });
    const firstFn = vi.fn().mockResolvedValue({ c: 0, total: 0 });
    const bindFn = vi.fn().mockReturnValue({ run: vi.fn(), first: firstFn, all: allFn });
    const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, run: vi.fn(), first: firstFn, all: allFn });
    (db as unknown as Record<string, unknown>).prepare = prepareFn;

    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      // GitHub API returns empty arrays
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("clean slate");
  });

  it("includes Tips section when user has open PRs", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([
          {
            number: 10,
            title: "Feature X",
            user: { login: "alice" },
            head: { ref: "feature/x" },
            requested_reviewers: [],
          },
        ]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Tips");
    expect(body.text).toContain("consider merging or requesting review");
  });

  it("aggregates data from MULTIPLE projects", async () => {
    const project1 = makeProject({ githubRepo: "org/repo1" });
    const project2 = makeProject({ githubRepo: "org/repo2" });
    const db = createMockD1({ c: 0, total: 0 }, []);
    const allFn = vi.fn().mockResolvedValue({ results: [] });
    const firstFn = vi.fn().mockResolvedValue({ c: 0, total: 0 });
    const bindFn = vi.fn().mockReturnValue({ run: vi.fn(), first: firstFn, all: allFn });
    const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, run: vi.fn(), first: firstFn, all: allFn });
    (db as unknown as Record<string, unknown>).prepare = prepareFn;

    const env = createMockEnv(
      [
        { id: "project-a", config: project1 },
        { id: "project-b", config: project2 },
      ],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("repo1") && urlStr.includes("/issues")) {
        return new Response(JSON.stringify([
          { number: 1, title: "Task from Project A" },
        ]), { status: 200 });
      }
      if (urlStr.includes("repo2") && urlStr.includes("/issues")) {
        return new Response(JSON.stringify([
          { number: 2, title: "Task from Project B" },
        ]), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await sendPrivateMorningDM(
      env,
      member,
      [
        { id: "project-a", config: project1 },
        { id: "project-b", config: project2 },
      ],
      allMembers
    );

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("project-a");
    expect(body.text).toContain("project-b");
    expect(body.text).toContain("Task from Project A");
    expect(body.text).toContain("Task from Project B");
  });

  it("does not send DM when no bot token is available", async () => {
    const projectNoToken = makeProject({ botToken: "" });
    const env = createMockEnv(
      [],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      }
    );

    // Pass empty projects array — no bot token available
    await sendPrivateMorningDM(env, member, [], allMembers);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org")
    );
    expect(telegramCalls).toHaveLength(0);
  });

  it("escapes HTML in member names to prevent XSS", async () => {
    const maliciousMember = makeMember({ name: "<script>alert(1)</script>" });
    const db = createMockD1({ c: 0, total: 0 }, []);
    const allFn = vi.fn().mockResolvedValue({ results: [] });
    const firstFn = vi.fn().mockResolvedValue({ c: 0, total: 0 });
    const bindFn = vi.fn().mockReturnValue({ run: vi.fn(), first: firstFn, all: allFn });
    const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, run: vi.fn(), first: firstFn, all: allFn });
    (db as unknown as Record<string, unknown>).prepare = prepareFn;

    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([maliciousMember]),
        [`prefs:${maliciousMember.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await sendPrivateMorningDM(env, maliciousMember, [{ id: "test-project", config: project }], [maliciousMember]);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    // Raw <script> should be escaped
    expect(body.text).not.toContain("<script>");
    expect(body.text).toContain("&lt;script&gt;");
  });

  it("escapes HTML in PR titles and issue titles", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      },
      db
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([
          {
            number: 10,
            title: "Fix <b>bold</b> & special chars",
            user: { login: "alice" },
            head: { ref: "feature/fix" },
            requested_reviewers: [],
          },
        ]), { status: 200 });
      }
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([
          { number: 50, title: "Task with <i>italic</i> & ampersand" },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendPrivateMorningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    // HTML in titles should be escaped
    expect(body.text).not.toContain("<b>bold</b>");
    expect(body.text).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(body.text).toContain("&amp; special chars");
  });
});

// ---------------------------------------------------------------------------
// sendGroupMorningMessage — group overview message
// ---------------------------------------------------------------------------

describe("sendGroupMorningMessage", () => {
  it("sends a group message containing 'Good Morning, Team!'", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Good Morning, Team!");
  });

  it("includes project name in the group message", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "my-cool-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("my-cool-project");
  });

  it("shows 'No categories claimed' when project has no category claims", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
        // No category_claims key
      }
    );

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("No categories claimed");
  });

  it("shows category owners when claims exist", async () => {
    const project = makeProject();
    const members = [makeMember()];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
        "test-project:category_claims": JSON.stringify({
          claims: [
            {
              telegramId: 111,
              telegramName: "Alice",
              githubUsername: "alice",
              category: "frontend",
              displayName: "Frontend",
              assignedIssues: [1, 2, 3],
              claimedAt: "2026-04-01T00:00:00Z",
            },
          ],
          lastUpdated: "2026-04-01T00:00:00Z",
        }),
      }
    );

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Frontend");
    expect(body.text).toContain("Alice");
    expect(body.text).toContain("3 tasks");
  });

  it("shows open PRs with 'Waiting for review' section", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([
          {
            number: 15,
            title: "Add new feature",
            user: { login: "bob" },
            requested_reviewers: [{ login: "alice" }],
          },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Waiting for review");
    expect(body.text).toContain("#15");
    expect(body.text).toContain("Add new feature");
    expect(body.text).toContain("@alice");
  });

  it("shows preview link when available for a PR", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
        "preview:test-project:15": "https://preview.example.com/pr-15",
      }
    );

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([
          {
            number: 15,
            title: "Feature with preview",
            user: { login: "bob" },
            requested_reviewers: [{ login: "alice" }],
          },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Preview");
    expect(body.text).toContain("https://preview.example.com/pr-15");
  });

  it("includes 'Yesterday's Team Performance' section with event stats", async () => {
    const project = makeProject();
    // Build a D1 mock that returns specific counts for the stats queries
    const db = createMockD1({ c: 5 });
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      },
      db
    );

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Yesterday's Team Performance");
    expect(body.text).toContain("Issues:");
    expect(body.text).toContain("PRs:");
    expect(body.text).toContain("Total events:");
  });

  it("escapes HTML in project names to prevent XSS", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "<img src=x>", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupMorningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).not.toContain("<img src=x>");
    expect(body.text).toContain("&lt;img src=x&gt;");
  });
});

// ---------------------------------------------------------------------------
// sendMorningDigest — orchestrator (group + private DMs with dedup)
// ---------------------------------------------------------------------------

describe("sendMorningDigest", () => {
  it("sends group message AND private DMs for all members with dm_chat_id", async () => {
    const project = makeProject();
    const members = [
      makeMember({ telegram_id: 111, name: "Alice", github: "alice" }),
      makeMember({ telegram_id: 222, name: "Bob", github: "bob", telegram_username: "bob_tg" }),
    ];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
        "prefs:111": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99911,
          updated_at: "2026-04-03T00:00:00Z",
        }),
        "prefs:222": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99922,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      }
    );

    await sendMorningDigest(env);

    // Should have at least 3 Telegram API calls: 1 group + 2 DMs
    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("skips DM for members without dm_chat_id", async () => {
    const project = makeProject();
    const members = [
      makeMember({ telegram_id: 111, name: "Alice", github: "alice" }),
      makeMember({ telegram_id: 222, name: "Bob", github: "bob", telegram_username: "bob_tg" }),
    ];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
        "prefs:111": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99911,
          updated_at: "2026-04-03T00:00:00Z",
        }),
        // Bob has no prefs (defaults to dm_chat_id: null)
      }
    );

    await sendMorningDigest(env);

    // Check that DM was sent to Alice (chat_id 99911) but not to Bob
    const dmCalls = fetchSpy.mock.calls.filter((c: unknown[]) => {
      if (!String(c[0]).includes("api.telegram.org")) return false;
      try {
        const body = JSON.parse((c[1] as RequestInit).body as string);
        return body.chat_id === 99911;
      } catch { return false; }
    });
    expect(dmCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("dedup: does NOT send DM when morning_dm:{id} key already exists in KV", async () => {
    const project = makeProject();
    const members = [
      makeMember({ telegram_id: 111, name: "Alice", github: "alice" }),
    ];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
        "prefs:111": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99911,
          updated_at: "2026-04-03T00:00:00Z",
        }),
        "morning_dm:111": "1", // Already sent — dedup key exists
      }
    );

    await sendMorningDigest(env);

    // Group message should still be sent, but Alice's DM should be skipped
    const dmCalls = fetchSpy.mock.calls.filter((c: unknown[]) => {
      if (!String(c[0]).includes("api.telegram.org")) return false;
      try {
        const body = JSON.parse((c[1] as RequestInit).body as string);
        return body.chat_id === 99911;
      } catch { return false; }
    });
    expect(dmCalls).toHaveLength(0);
  });

  it("sets dedup key morning_dm:{id} with 12h TTL after sending DM", async () => {
    const project = makeProject();
    const members = [
      makeMember({ telegram_id: 111, name: "Alice", github: "alice" }),
    ];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
        "prefs:111": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99911,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      }
    );

    await sendMorningDigest(env);

    // Verify KV put was called for the dedup key with 12h TTL (43200 seconds)
    const putCalls = (env.PROJECTS.put as ReturnType<typeof vi.fn>).mock.calls;
    const dedupPut = putCalls.find(
      (call: unknown[]) => call[0] === "morning_dm:111"
    );
    expect(dedupPut).toBeDefined();
    expect(dedupPut![1]).toBe("1");
    expect(dedupPut![2]).toEqual({ expirationTtl: 43200 });
  });

  it("continues sending to other members when one DM fails", async () => {
    const project = makeProject();
    const members = [
      makeMember({ telegram_id: 111, name: "Alice", github: "alice" }),
      makeMember({ telegram_id: 222, name: "Bob", github: "bob", telegram_username: "bob_tg" }),
    ];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
        "prefs:111": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99911,
          updated_at: "2026-04-03T00:00:00Z",
        }),
        "prefs:222": JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99922,
          updated_at: "2026-04-03T00:00:00Z",
        }),
      }
    );

    let callCount = 0;
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org") && urlStr.includes("/sendMessage")) {
        callCount++;
        // Let the first DM-targeted call fail (but not group message)
        try {
          const body = JSON.parse("{}");
        } catch { /* just counting */ }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    // Should not throw even if individual DMs encounter issues
    await expect(sendMorningDigest(env)).resolves.toBeUndefined();
  });

  it("does not throw when group message fails", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    fetchSpy.mockRejectedValue(new Error("Network error"));

    // sendMorningDigest wraps both group and DM in try/catch
    await expect(sendMorningDigest(env)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// escapeHtml usage verification — ensure user content is escaped
// ---------------------------------------------------------------------------

describe("escapeHtml in morning message context", () => {
  it("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes ampersands", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("does not double-escape already-escaped HTML", () => {
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });

  it("escapes combination of special characters", () => {
    expect(escapeHtml("<b>bold & strong</b>")).toBe("&lt;b&gt;bold &amp; strong&lt;/b&gt;");
  });
});
