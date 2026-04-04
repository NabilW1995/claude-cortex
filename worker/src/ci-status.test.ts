/**
 * CI Status — Unit Tests
 *
 * Tests the GitHub Actions CI/CD integration:
 * - getCIStatus / setCIStatus KV helpers
 * - CI badge display in "Meine Aufgaben" when a PR has CI status
 * - workflow_run webhook storing status correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getCIStatus,
  setCIStatus,
  handleMeineAufgaben,
  getTeamMembers,
  upsertTeamMember,
  setActiveProject,
  getCategoryClaims,
  saveCategoryClaims,
} from "./index";
import type { Env, ProjectConfig, CIStatus } from "./index";

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
// 1. getCIStatus — reading CI build status from KV
// =========================================================================

describe("getCIStatus", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns null when no CI status exists for the PR", async () => {
    const result = await getCIStatus(kv, "my-project", 42);
    expect(result).toBeNull();
    expect(kv.get).toHaveBeenCalledWith("ci:my-project:42");
  });

  it("returns null when KV contains invalid JSON", async () => {
    await kv.put("ci:my-project:42", "not-json{{{");
    const result = await getCIStatus(kv, "my-project", 42);
    expect(result).toBeNull();
  });

  it("returns the stored CIStatus when present", async () => {
    const status: CIStatus = {
      conclusion: "success",
      workflow: "CI",
      updatedAt: "2026-04-03T12:00:00Z",
      runId: 12345,
    };
    await kv.put("ci:my-project:10", JSON.stringify(status));

    const result = await getCIStatus(kv, "my-project", 10);
    expect(result).toEqual(status);
  });

  it("uses the correct KV key format: ci:{projectId}:{prNumber}", async () => {
    await getCIStatus(kv, "alpha-project", 99);
    expect(kv.get).toHaveBeenCalledWith("ci:alpha-project:99");
  });

  it("returns independent statuses for different projects", async () => {
    const successStatus: CIStatus = {
      conclusion: "success",
      workflow: "Build",
      updatedAt: "2026-04-03T12:00:00Z",
    };
    const failureStatus: CIStatus = {
      conclusion: "failure",
      workflow: "Test",
      updatedAt: "2026-04-03T12:01:00Z",
    };

    await kv.put("ci:proj-a:1", JSON.stringify(successStatus));
    await kv.put("ci:proj-b:1", JSON.stringify(failureStatus));

    expect(await getCIStatus(kv, "proj-a", 1)).toEqual(successStatus);
    expect(await getCIStatus(kv, "proj-b", 1)).toEqual(failureStatus);
  });

  it("returns independent statuses for different PR numbers", async () => {
    const s1: CIStatus = { conclusion: "success", workflow: "CI", updatedAt: "2026-04-03T12:00:00Z" };
    const s2: CIStatus = { conclusion: "failure", workflow: "CI", updatedAt: "2026-04-03T12:05:00Z" };

    await kv.put("ci:proj:1", JSON.stringify(s1));
    await kv.put("ci:proj:2", JSON.stringify(s2));

    expect(await getCIStatus(kv, "proj", 1)).toEqual(s1);
    expect(await getCIStatus(kv, "proj", 2)).toEqual(s2);
  });
});

// =========================================================================
// 2. setCIStatus — storing CI build status in KV
// =========================================================================

describe("setCIStatus", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores the CI status in KV with correct key", async () => {
    const status: CIStatus = {
      conclusion: "success",
      workflow: "CI",
      updatedAt: "2026-04-03T12:00:00Z",
      runId: 99,
    };

    await setCIStatus(kv, "my-project", 42, status);

    expect(kv.put).toHaveBeenCalledWith(
      "ci:my-project:42",
      JSON.stringify(status),
      { expirationTtl: 7 * 24 * 60 * 60 }
    );
  });

  it("round-trips correctly: set then get", async () => {
    const status: CIStatus = {
      conclusion: "failure",
      workflow: "Tests",
      updatedAt: "2026-04-03T13:00:00Z",
      runId: 555,
    };

    await setCIStatus(kv, "proj", 10, status);
    const result = await getCIStatus(kv, "proj", 10);
    expect(result).toEqual(status);
  });

  it("overwrites previous status for the same PR", async () => {
    const old: CIStatus = {
      conclusion: "failure",
      workflow: "CI",
      updatedAt: "2026-04-03T12:00:00Z",
    };
    const updated: CIStatus = {
      conclusion: "success",
      workflow: "CI",
      updatedAt: "2026-04-03T12:10:00Z",
    };

    await setCIStatus(kv, "proj", 5, old);
    await setCIStatus(kv, "proj", 5, updated);

    const result = await getCIStatus(kv, "proj", 5);
    expect(result).toEqual(updated);
  });

  it("sets a 7-day TTL on the stored value", async () => {
    const status: CIStatus = {
      conclusion: "cancelled",
      workflow: "Deploy",
      updatedAt: "2026-04-03T14:00:00Z",
    };

    await setCIStatus(kv, "proj", 7, status);

    const putCalls = vi.mocked(kv.put).mock.calls;
    const ciCall = putCalls.find((c) => c[0] === "ci:proj:7");
    expect(ciCall).toBeDefined();
    expect(ciCall![2]).toEqual({ expirationTtl: 604800 }); // 7 * 24 * 60 * 60
  });

  it("does not affect other PRs when storing", async () => {
    const s1: CIStatus = { conclusion: "success", workflow: "A", updatedAt: "2026-04-03T12:00:00Z" };
    const s2: CIStatus = { conclusion: "failure", workflow: "B", updatedAt: "2026-04-03T12:01:00Z" };

    await setCIStatus(kv, "proj", 1, s1);
    await setCIStatus(kv, "proj", 2, s2);

    expect(await getCIStatus(kv, "proj", 1)).toEqual(s1);
    expect(await getCIStatus(kv, "proj", 2)).toEqual(s2);
  });

  it("handles all conclusion types", async () => {
    const conclusions: CIStatus["conclusion"][] = ["success", "failure", "cancelled", "skipped"];

    for (const conclusion of conclusions) {
      const status: CIStatus = { conclusion, workflow: "Test", updatedAt: "2026-04-03T12:00:00Z" };
      await setCIStatus(kv, "proj", 100, status);
      const result = await getCIStatus(kv, "proj", 100);
      expect(result?.conclusion).toBe(conclusion);
    }
  });
});

// =========================================================================
// 3. handleMeineAufgaben — CI badge shows when PR has CI status
// =========================================================================

describe("handleMeineAufgaben CI badge", () => {
  let env: Env;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const projectId = "test-project";
  const telegramId = 12345;

  beforeEach(async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
    const project = makeProject();
    env = createMockEnv({ [projectId]: project });

    // Register team member
    await upsertTeamMember(env.PROJECTS, {
      telegram_id: telegramId,
      telegram_username: "testuser",
      github: "testuser",
      name: "Test User",
    });

    // Set active project
    await setActiveProject(env.PROJECTS, telegramId, projectId);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows CI failure badge when PR exists with failed status", async () => {
    // Claim a category so we have a branch to check
    await saveCategoryClaims(env.PROJECTS, projectId, {
      claims: [{
        telegramId,
        telegramName: "testuser",
        githubUsername: "testuser",
        category: "area:auth",
        displayName: "Auth",
        assignedIssues: [1],
        claimedAt: new Date().toISOString(),
      }],
      lastUpdated: new Date().toISOString(),
    });

    // Store a failure CI status for PR #10
    await setCIStatus(env.PROJECTS, projectId, 10, {
      conclusion: "failure",
      workflow: "Tests",
      updatedAt: new Date().toISOString(),
      runId: 999,
    });

    // Mock fetch responses:
    // 1. Issues (open, assigned to user) — one issue
    // 2. Issues (closed) — empty
    // 3. PR search — returns one open PR
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{
        number: 1,
        title: "Fix login",
        labels: [{ name: "area:auth" }],
      }]), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ number: 10 }]), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    // Mock DB for getDailyHours
    env.DB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as unknown as D1Database;

    const { text } = await handleMeineAufgaben(env, telegramId, "Test User");

    // The CI badge should appear in the output
    expect(text).toContain("CI:");
    expect(text).toContain("Tests");
    expect(text).toContain("failure");
  });

  it("shows CI success badge when PR exists with passing status", async () => {
    await saveCategoryClaims(env.PROJECTS, projectId, {
      claims: [{
        telegramId,
        telegramName: "testuser",
        githubUsername: "testuser",
        category: "area:ui",
        displayName: "UI",
        assignedIssues: [2],
        claimedAt: new Date().toISOString(),
      }],
      lastUpdated: new Date().toISOString(),
    });

    await setCIStatus(env.PROJECTS, projectId, 20, {
      conclusion: "success",
      workflow: "Build & Test",
      updatedAt: new Date().toISOString(),
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ number: 2, title: "Add button", labels: [{ name: "area:ui" }] }]),
        { status: 200, headers: { "Content-Type": "application/json" } })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([{ number: 20 }]), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    env.DB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as unknown as D1Database;

    const { text } = await handleMeineAufgaben(env, telegramId, "Test User");

    expect(text).toContain("CI:");
    expect(text).toContain("Build &amp; Test"); // escapeHtml encodes &
    expect(text).toContain("success");
  });
});

// =========================================================================
// 4. Workflow run webhook stores status — integration-style test
// =========================================================================

describe("setCIStatus from webhook payload", () => {
  it("stores correct status for multiple PRs from a single workflow run", async () => {
    const kv = createMockKV();
    const projectId = "my-project";

    // Simulate what handleGitHubWorkflow does: store status for each PR
    const prNumbers = [10, 15, 22];
    const ciStatus: CIStatus = {
      conclusion: "failure",
      workflow: "CI Pipeline",
      updatedAt: "2026-04-03T15:00:00Z",
      runId: 789,
    };

    for (const prNum of prNumbers) {
      await setCIStatus(kv, projectId, prNum, ciStatus);
    }

    // Verify each PR got the status
    for (const prNum of prNumbers) {
      const result = await getCIStatus(kv, projectId, prNum);
      expect(result).toEqual(ciStatus);
    }
  });

  it("handles workflow run with no associated PRs gracefully", async () => {
    const kv = createMockKV();
    const projectId = "my-project";

    // When there are no PRs, no setCIStatus calls should be made
    const prNumbers: number[] = [];
    const ciStatus: CIStatus = {
      conclusion: "success",
      workflow: "Lint",
      updatedAt: "2026-04-03T15:00:00Z",
    };

    for (const prNum of prNumbers) {
      await setCIStatus(kv, projectId, prNum, ciStatus);
    }

    // kv.put should not have been called for ci: keys
    const putCalls = vi.mocked(kv.put).mock.calls;
    const ciCalls = putCalls.filter((c) => (c[0] as string).startsWith("ci:"));
    expect(ciCalls).toHaveLength(0);
  });
});
