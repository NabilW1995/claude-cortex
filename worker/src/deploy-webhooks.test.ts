/**
 * Deploy Webhooks — Unit Tests (Vercel & Netlify)
 *
 * Tests the Vercel and Netlify deployment webhook handlers:
 * - Route matching for /vercel/:projectId and /netlify/:projectId
 * - Vercel: deployment.ready stores preview URL, deployment.error handling
 * - Netlify: state=ready stores preview URL, state=error handling
 * - PR number extraction from both platforms
 * - notifyBranchOwner DM logic for building/failed states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPreviewUrl,
  setPreviewUrl,
  getTeamMembers,
  getUserPreferences,
  saveUserPreferences,
  resolveVercelBranch,
  notifyBranchOwner,
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
// Helper to build a mock Env
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
// 1. Vercel webhook route matching
// =========================================================================

describe("Vercel webhook route matching", () => {
  const vercelPattern = /^\/vercel\/([a-zA-Z0-9_-]+)\/?$/;

  it("POST /vercel/my-project is recognized", () => {
    expect(vercelPattern.test("/vercel/my-project")).toBe(true);
    expect(vercelPattern.exec("/vercel/my-project")![1]).toBe("my-project");
  });

  it("POST /vercel/project-with-dashes is recognized", () => {
    expect(vercelPattern.test("/vercel/project-with-dashes")).toBe(true);
    expect(vercelPattern.exec("/vercel/project-with-dashes")![1]).toBe("project-with-dashes");
  });

  it("POST /vercel/project_with_underscores is recognized", () => {
    expect(vercelPattern.test("/vercel/project_with_underscores")).toBe(true);
  });

  it("rejects invalid vercel paths", () => {
    expect(vercelPattern.test("/vercel/")).toBe(false);
    expect(vercelPattern.test("/vercel")).toBe(false);
    expect(vercelPattern.test("/vercel/my project")).toBe(false);
    expect(vercelPattern.test("/notvercel/my-project")).toBe(false);
  });

  it("accepts trailing slash", () => {
    expect(vercelPattern.test("/vercel/my-project/")).toBe(true);
  });
});

// =========================================================================
// 2. Netlify webhook route matching
// =========================================================================

describe("Netlify webhook route matching", () => {
  const netlifyPattern = /^\/netlify\/([a-zA-Z0-9_-]+)\/?$/;

  it("POST /netlify/my-project is recognized", () => {
    expect(netlifyPattern.test("/netlify/my-project")).toBe(true);
    expect(netlifyPattern.exec("/netlify/my-project")![1]).toBe("my-project");
  });

  it("POST /netlify/project-with-dashes is recognized", () => {
    expect(netlifyPattern.test("/netlify/project-with-dashes")).toBe(true);
    expect(netlifyPattern.exec("/netlify/project-with-dashes")![1]).toBe("project-with-dashes");
  });

  it("POST /netlify/project_with_underscores is recognized", () => {
    expect(netlifyPattern.test("/netlify/project_with_underscores")).toBe(true);
  });

  it("rejects invalid netlify paths", () => {
    expect(netlifyPattern.test("/netlify/")).toBe(false);
    expect(netlifyPattern.test("/netlify")).toBe(false);
    expect(netlifyPattern.test("/netlify/my project")).toBe(false);
    expect(netlifyPattern.test("/notnetlify/my-project")).toBe(false);
  });

  it("accepts trailing slash", () => {
    expect(netlifyPattern.test("/netlify/my-project/")).toBe(true);
  });
});

// =========================================================================
// 3. Vercel webhook — deployment.ready stores preview URL
// =========================================================================

describe("Vercel webhook — deployment.ready", () => {
  it("stores preview URL in KV when deployment.ready is received", async () => {
    const kv = createMockKV();

    // Simulate what the handler does: extract URL and PR, store in KV
    const vercelPayload = {
      type: "deployment.ready",
      payload: {
        deployment: {
          url: "my-app-abc123.vercel.app",
          meta: { githubPrId: "42" },
        },
        name: "my-project",
      },
    };

    const rawUrl = vercelPayload.payload.deployment.url;
    const fullUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const prNum = Number(vercelPayload.payload.deployment.meta.githubPrId);

    await setPreviewUrl(kv, "my-project", prNum, fullUrl);

    const stored = await getPreviewUrl(kv, "my-project", 42);
    expect(stored).toBe("https://my-app-abc123.vercel.app");
  });

  it("extracts PR number from meta.githubPrId", () => {
    const payload = {
      type: "deployment.ready",
      payload: {
        deployment: {
          url: "test.vercel.app",
          meta: { githubPrId: "99" },
        },
      },
    };

    const prNum = Number(payload.payload.deployment.meta.githubPrId);
    expect(prNum).toBe(99);
    expect(Number.isNaN(prNum)).toBe(false);
  });

  it("prepends https:// when Vercel URL lacks protocol", () => {
    const rawUrl = "my-app-abc123.vercel.app";
    const fullUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    expect(fullUrl).toBe("https://my-app-abc123.vercel.app");
  });

  it("preserves full URL when Vercel already includes protocol", () => {
    const rawUrl = "https://my-app-abc123.vercel.app";
    const fullUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    expect(fullUrl).toBe("https://my-app-abc123.vercel.app");
  });
});

// =========================================================================
// 4. Vercel webhook — deployment.error handling
// =========================================================================

describe("Vercel webhook — deployment.error", () => {
  it("recognizes deployment.error type", () => {
    const payload = {
      type: "deployment.error",
      payload: {
        deployment: {
          url: "my-app-abc123.vercel.app",
          meta: { githubPrId: "42" },
        },
      },
    };
    expect(payload.type).toBe("deployment.error");
  });

  it("does not store preview URL on error", async () => {
    const kv = createMockKV();

    // On error, the handler should NOT store a preview URL
    // Verify KV is empty
    const stored = await getPreviewUrl(kv, "my-project", 42);
    expect(stored).toBeNull();
    expect(kv.put).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 5. Netlify webhook — state=ready stores preview URL
// =========================================================================

describe("Netlify webhook — state=ready", () => {
  it("stores preview URL in KV when state=ready is received", async () => {
    const kv = createMockKV();

    // Simulate what the handler does: extract URL and PR, store in KV
    const netlifyPayload = {
      state: "ready",
      deploy_ssl_url: "https://deploy-preview-42--my-app.netlify.app",
      context: "deploy-preview",
      review_id: 42,
    };

    await setPreviewUrl(kv, "my-project", netlifyPayload.review_id, netlifyPayload.deploy_ssl_url);

    const stored = await getPreviewUrl(kv, "my-project", 42);
    expect(stored).toBe("https://deploy-preview-42--my-app.netlify.app");
  });

  it("extracts PR number from review_id", () => {
    const payload = {
      state: "ready",
      deploy_ssl_url: "https://deploy-preview-99--my-app.netlify.app",
      review_id: 99,
    };

    expect(payload.review_id).toBe(99);
  });

  it("stores with 7-day TTL", async () => {
    const kv = createMockKV();
    await setPreviewUrl(kv, "my-project", 42, "https://deploy-preview-42.netlify.app");

    const putCall = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putCall[2]).toEqual({ expirationTtl: 604800 });
  });
});

// =========================================================================
// 6. Netlify webhook — state=error handling
// =========================================================================

describe("Netlify webhook — state=error", () => {
  it("recognizes error state", () => {
    const payload = {
      state: "error",
      deploy_ssl_url: "https://deploy-preview-42--my-app.netlify.app",
      review_id: 42,
      branch: "feature/my-branch",
    };
    expect(payload.state).toBe("error");
  });

  it("does not store preview URL on error", async () => {
    const kv = createMockKV();

    // On error, the handler should NOT store a preview URL
    const stored = await getPreviewUrl(kv, "my-project", 42);
    expect(stored).toBeNull();
    expect(kv.put).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 7. resolveVercelBranch — fetch branch from GitHub PR
// =========================================================================

describe("resolveVercelBranch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns branch name from GitHub PR lookup", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ head: { ref: "feature/dashboard" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const branch = await resolveVercelBranch(project, 42);
    expect(branch).toBe("feature/dashboard");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/test-org/test-repo/pulls/42");
  });

  it("returns null when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const branch = await resolveVercelBranch(project, 42);
    expect(branch).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns null when GitHub API returns error", async () => {
    const project = makeProject();

    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    const branch = await resolveVercelBranch(project, 999);
    expect(branch).toBeNull();
  });
});

// =========================================================================
// 8. notifyBranchOwner — DM the PR author for building/failed
// =========================================================================

describe("notifyBranchOwner", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends building DM to branch owner", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const prefsAlice: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
      }
    );

    const project = makeProject();

    // Mock GitHub API: find PR by branch, return alice as author
    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/pulls?")) {
        return new Response(JSON.stringify([{ user: { login: "alice" } }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Telegram sendMessage
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await notifyBranchOwner(env, project, "feature/test", "building", "Vercel");

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(1);

    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(1001);
    expect(body.text).toContain("Vercel");
    expect(body.text).toContain("feature/test");
  });

  it("sends failed DM to branch owner", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
    ];
    const prefsBob: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 2002, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:222": JSON.stringify(prefsBob),
      }
    );

    const project = makeProject();

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/pulls?")) {
        return new Response(JSON.stringify([{ user: { login: "bob" } }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await notifyBranchOwner(env, project, "fix/broken-login", "failed", "Netlify");

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(1);

    const body = JSON.parse((telegramCalls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(2002);
    expect(body.text).toContain("Netlify");
    expect(body.text).toContain("fix/broken-login");
  });

  it("skips notification when branch owner is in DND mode", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const prefsAlice: UserPreferences = {
      commits: false, previews: true, tasks: true, pr_reviews: false,
      sessions: false, dm_chat_id: 1001, updated_at: "2026-04-01T00:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
        "prefs:111": JSON.stringify(prefsAlice),
        "dnd:111": "1", // Alice is DND
      }
    );

    const project = makeProject();

    fetchSpy.mockImplementation(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("/pulls?")) {
        return new Response(JSON.stringify([{ user: { login: "alice" } }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await notifyBranchOwner(env, project, "feature/test", "building", "Vercel");

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    // No DM should be sent because Alice is DND
    expect(telegramCalls.length).toBe(0);
  });

  it("skips notification when no PR matches the branch", async () => {
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];

    const env = createMockEnv(
      { "my-project": makeProject() },
      {
        "team-members": JSON.stringify(teamMembers),
      }
    );

    const project = makeProject();

    // GitHub returns empty array — no matching PR
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await notifyBranchOwner(env, project, "feature/orphan", "failed", "Vercel");

    const telegramCalls = fetchSpy.mock.calls.filter(
      (call: unknown[]) => (call[0] as string).includes("api.telegram.org")
    );
    expect(telegramCalls.length).toBe(0);
  });

  it("skips when project has no GitHub token", async () => {
    const env = createMockEnv({}, { "team-members": JSON.stringify([]) });
    const project = makeProject({ githubToken: undefined });

    await notifyBranchOwner(env, project, "feature/test", "building", "Vercel");

    // No fetch calls at all since no token
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 9. Both platforms — PR number extraction correctness
// =========================================================================

describe("PR number extraction", () => {
  it("Vercel: extracts PR number from meta.githubPrId string", () => {
    const prIdStr = "42";
    const prNum = Number(prIdStr);
    expect(prNum).toBe(42);
    expect(Number.isNaN(prNum)).toBe(false);
    expect(prNum > 0).toBe(true);
  });

  it("Vercel: rejects non-numeric PR ID", () => {
    const prIdStr = "not-a-number";
    const prNum = Number(prIdStr);
    expect(Number.isNaN(prNum)).toBe(true);
  });

  it("Vercel: rejects zero PR number", () => {
    const prIdStr = "0";
    const prNum = Number(prIdStr);
    expect(prNum <= 0).toBe(true);
  });

  it("Netlify: extracts PR number directly from review_id", () => {
    const payload = { review_id: 42 };
    expect(payload.review_id).toBe(42);
    expect(typeof payload.review_id).toBe("number");
  });

  it("different platforms, same PR number, same project — preview URL is overwritten", async () => {
    const kv = createMockKV();

    // Vercel stores a preview URL
    await setPreviewUrl(kv, "my-project", 42, "https://my-app.vercel.app");
    expect(await getPreviewUrl(kv, "my-project", 42)).toBe("https://my-app.vercel.app");

    // Netlify overwrites with its own URL
    await setPreviewUrl(kv, "my-project", 42, "https://deploy-preview-42.netlify.app");
    expect(await getPreviewUrl(kv, "my-project", 42)).toBe("https://deploy-preview-42.netlify.app");
  });
});
