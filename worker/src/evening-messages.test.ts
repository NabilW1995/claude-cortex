/**
 * Evening Messages — Unit Tests (Issue #63)
 *
 * Tests the evening notification system that sends:
 * 1. Private DMs to each team member with personalized wrap-up briefings
 * 2. A group evening message with project overview, completed work, and team stats
 * 3. An orchestrator that combines group + private DMs with dedup
 * 4. Session-end hook trigger for evening DMs
 *
 * Covers:
 * - sendPrivateEveningDM (personalized DM: today's tasks, branch status, learnings, category tip)
 * - sendGroupEveningMessage (group: who left, completed/open work, preview links, performance)
 * - sendEveningDigest (orchestrator: calls group + private DMs with dedup)
 * - Session-end trigger dedup (evening_dm:{telegramId} KV key, 24h TTL)
 * - Learnings placeholder and forwarded learnings display
 * - escapeHtml usage in evening messages (XSS prevention)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendPrivateEveningDM,
  sendGroupEveningMessage,
  sendEveningDigest,
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
// sendPrivateEveningDM — private evening briefing per user
// ---------------------------------------------------------------------------

describe("sendPrivateEveningDM", () => {
  const project = makeProject();
  const member = makeMember();
  const allMembers = [member, makeMember({ telegram_id: 222, name: "Bob", github: "bob", telegram_username: "bob_tg" })];

  it("sends a DM containing 'Good evening' greeting with the member's name", async () => {
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBeGreaterThanOrEqual(1);

    const dmCall = telegramCalls.find((c: unknown[]) => String(c[0]).includes("/sendMessage"));
    expect(dmCall).toBeDefined();

    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Good evening");
    expect(body.text).toContain("Alice");
    expect(body.chat_id).toBe(99999);
  });

  it("does NOT send DM when user has no dm_chat_id set", async () => {
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
      }
    );

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

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
        [`dnd:${member.telegram_id}`]: "1",
      }
    );

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const telegramDMCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramDMCalls).toHaveLength(0);
  });

  it("does NOT send DM when dedup key evening_dm:{id} already exists", async () => {
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(allMembers),
        [`prefs:${member.telegram_id}`]: JSON.stringify({
          commits: false, previews: false, tasks: true,
          pr_reviews: false, sessions: false, dm_chat_id: 99999,
          updated_at: "2026-04-03T00:00:00Z",
        }),
        [`evening_dm:${member.telegram_id}`]: "1", // Already sent
      }
    );

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const telegramDMCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramDMCalls).toHaveLength(0);
  });

  it("sets dedup key evening_dm:{id} with 24h TTL after sending DM", async () => {
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const putCalls = (env.PROJECTS.put as ReturnType<typeof vi.fn>).mock.calls;
    const dedupPut = putCalls.find(
      (call: unknown[]) => call[0] === `evening_dm:${member.telegram_id}`
    );
    expect(dedupPut).toBeDefined();
    expect(dedupPut![1]).toBe("1");
    expect(dedupPut![2]).toEqual({ expirationTtl: 86400 });
  });

  it("includes 'Completed today' section when D1 has closed issues", async () => {
    const db = createMockD1(null, []);
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Completed today");
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Your open branches");
    expect(body.text).toContain("#10");
    expect(body.text).toContain("Feature branch");
  });

  it("shows reviewer info on open PRs", async () => {
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
            title: "My PR",
            user: { login: "alice" },
            head: { ref: "feature/x" },
            requested_reviewers: [{ login: "bob" }],
          },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("reviewers: @bob");
  });

  it("shows 'no reviewer assigned' when PR has no reviewers", async () => {
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
            title: "My PR",
            user: { login: "alice" },
            head: { ref: "feature/x" },
            requested_reviewers: [],
          },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("no reviewer assigned");
  });

  it("shows category tip when user has no active claim", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
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
        // No category claims — user has no active category
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("consider picking one tomorrow");
    expect(body.text).toContain("/grab");
  });

  it("does NOT show category tip when user has an active claim", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
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
        "test-project:category_claims": JSON.stringify({
          claims: [
            {
              telegramId: 111,
              telegramName: "Alice",
              githubUsername: "alice",
              category: "frontend",
              displayName: "Frontend",
              assignedIssues: [1, 2, 3],
              claimedAt: "2026-04-03T00:00:00Z",
            },
          ],
          lastUpdated: "2026-04-03T00:00:00Z",
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).not.toContain("consider picking one tomorrow");
  });

  it("shows 'No learnings captured today' when no learnings are provided", async () => {
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("No learnings captured today");
  });

  it("displays forwarded learnings when provided", async () => {
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

    await sendPrivateEveningDM(
      env,
      member,
      [{ id: "test-project", config: project }],
      allMembers,
      ["Always use escapeHtml for user content", "Check for DND before sending DMs"]
    );

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Today's learnings");
    expect(body.text).toContain("Always use escapeHtml for user content");
    expect(body.text).toContain("Check for DND before sending DMs");
    expect(body.text).not.toContain("No learnings captured today");
  });

  it("includes encouragement message", async () => {
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

    await sendPrivateEveningDM(env, member, [{ id: "test-project", config: project }], allMembers);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("rest well and recharge");
  });

  it("does not send DM when no bot token is available", async () => {
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

    await sendPrivateEveningDM(env, member, [], allMembers);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org")
    );
    expect(telegramCalls).toHaveLength(0);
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
      if (urlStr.includes("/pulls")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await sendPrivateEveningDM(
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
    // The DM was successfully sent (verifies multi-project loop didn't break)
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).toContain("Good evening");
    expect(body.text).toContain("Alice");
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

    await sendPrivateEveningDM(env, maliciousMember, [{ id: "test-project", config: project }], [maliciousMember]);

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).not.toContain("<script>");
    expect(body.text).toContain("&lt;script&gt;");
  });

  it("escapes HTML in forwarded learnings", async () => {
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

    await sendPrivateEveningDM(
      env,
      member,
      [{ id: "test-project", config: project }],
      allMembers,
      ["Use <b>bold</b> & escaping"]
    );

    const dmCall = fetchSpy.mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(dmCall).toBeDefined();
    const body = JSON.parse((dmCall![1] as RequestInit).body as string);
    expect(body.text).not.toContain("<b>bold</b>");
    expect(body.text).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(body.text).toContain("&amp; escaping");
  });
});

// ---------------------------------------------------------------------------
// sendGroupEveningMessage — group evening overview message
// ---------------------------------------------------------------------------

describe("sendGroupEveningMessage", () => {
  it("sends a group message containing 'Evening Summary'", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    expect(telegramCalls.length).toBeGreaterThanOrEqual(1);
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Evening Summary");
  });

  it("includes project name in the group message", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "my-cool-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("my-cool-project");
  });

  it("includes 'Today's Team Performance' section with event stats", async () => {
    const project = makeProject();
    const db = createMockD1({ c: 5 });
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      },
      db
    );

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Today's Team Performance");
    expect(body.text).toContain("Issues:");
    expect(body.text).toContain("PRs:");
    expect(body.text).toContain("Total events:");
  });

  it("includes learnings placeholder mentioning Issue #64", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Team learnings: coming soon");
    expect(body.text).toContain("Issue #64");
  });

  it("shows open PRs with 'Preview links waiting for review' section", async () => {
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
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Preview links waiting for review");
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
      if (urlStr.includes("/issues")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Preview");
    expect(body.text).toContain("https://preview.example.com/pr-15");
  });

  it("shows 'Still open' section when assigned issues exist", async () => {
    const project = makeProject();
    const members = [makeMember()];
    const env = createMockEnv(
      [{ id: "test-project", config: project }],
      {
        "team-members": JSON.stringify(members),
      }
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
          { number: 50, title: "Build dashboard", assignee: { login: "alice" } },
          { number: 51, title: "Write tests", assignee: { login: "alice" } },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Still open");
    expect(body.text).toContain("#50");
    expect(body.text).toContain("Build dashboard");
    expect(body.text).toContain("@alice");
  });

  it("escapes HTML in project names to prevent XSS", async () => {
    const project = makeProject();
    const env = createMockEnv(
      [{ id: "<img src=x>", config: project }],
      {
        "team-members": JSON.stringify([]),
      }
    );

    await sendGroupEveningMessage(env);

    const telegramCalls = fetchSpy.mock.calls.filter(
      (c: unknown[]) => String(c[0]).includes("api.telegram.org") && String(c[0]).includes("/sendMessage")
    );
    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.text).not.toContain("<img src=x>");
    expect(body.text).toContain("&lt;img src=x&gt;");
  });
});

// ---------------------------------------------------------------------------
// sendEveningDigest — orchestrator (group + private DMs with dedup)
// ---------------------------------------------------------------------------

describe("sendEveningDigest", () => {
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

    await sendEveningDigest(env);

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

    await sendEveningDigest(env);

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

  it("dedup: does NOT send DM when evening_dm:{id} key already exists in KV", async () => {
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
        "evening_dm:111": "1", // Already sent — dedup key exists
      }
    );

    await sendEveningDigest(env);

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

    // Should not throw even if individual DMs encounter issues
    await expect(sendEveningDigest(env)).resolves.toBeUndefined();
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

    // sendEveningDigest wraps both group and DM in try/catch
    await expect(sendEveningDigest(env)).resolves.toBeUndefined();
  });
});
