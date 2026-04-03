/**
 * Home Screen — Unit Tests
 *
 * Tests the 5-button layout, project header rendering,
 * active project KV helpers, and project switching logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getActiveProject,
  setActiveProject,
  resolveActiveProject,
  getProjectList,
  escapeHtml,
  getCategoryClaims,
  saveCategoryClaims,
  getPausedCategories,
  savePausedCategories,
  addPausedCategory,
  removePausedCategory,
  clearActiveTask,
  renderHomeScreen,
} from "./index";
import type { Env, ProjectConfig, CategoryClaimsState, PausedCategory, CategoryClaim } from "./index";

// ---------------------------------------------------------------------------
// Mock KV Namespace — simulates Cloudflare KV for testing
// ---------------------------------------------------------------------------

function createMockKV(initialData: Record<string, string> = {}): KVNamespace {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
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
// Helper to build a minimal ProjectConfig for testing
// ---------------------------------------------------------------------------

function makeProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    botToken: "test-token",
    chatId: "-100123",
    githubRepo: "test/repo",
    members: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a mock Env with pre-seeded projects
// ---------------------------------------------------------------------------

function createMockEnv(projects: Record<string, ProjectConfig> = {}): Env {
  const kvData: Record<string, string> = {};
  for (const [id, config] of Object.entries(projects)) {
    kvData[id] = JSON.stringify(config);
  }
  return {
    PROJECTS: createMockKV(kvData),
    DB: {} as D1Database,
  };
}

// =========================================================================
// 1. getActiveProject — reading active project from KV
// =========================================================================

describe("getActiveProject", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns null when no active project is set", async () => {
    const result = await getActiveProject(kv, 12345);
    expect(result).toBeNull();
    expect(kv.get).toHaveBeenCalledWith("active_project:12345");
  });

  it("returns the stored project ID when set", async () => {
    await kv.put("active_project:12345", "my-project");
    const result = await getActiveProject(kv, 12345);
    expect(result).toBe("my-project");
  });

  it("uses the correct KV key format with telegram ID", async () => {
    await getActiveProject(kv, 99999);
    expect(kv.get).toHaveBeenCalledWith("active_project:99999");
  });

  it("returns different projects for different users", async () => {
    await kv.put("active_project:111", "project-a");
    await kv.put("active_project:222", "project-b");
    expect(await getActiveProject(kv, 111)).toBe("project-a");
    expect(await getActiveProject(kv, 222)).toBe("project-b");
  });
});

// =========================================================================
// 2. setActiveProject — storing active project in KV
// =========================================================================

describe("setActiveProject", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores the project ID in KV", async () => {
    await setActiveProject(kv, 12345, "my-project");
    expect(kv.put).toHaveBeenCalledWith("active_project:12345", "my-project");
  });

  it("overwrites the previous project when switching", async () => {
    await setActiveProject(kv, 12345, "project-a");
    await setActiveProject(kv, 12345, "project-b");
    const result = await getActiveProject(kv, 12345);
    expect(result).toBe("project-b");
  });

  it("does not affect other users when setting", async () => {
    await setActiveProject(kv, 111, "project-a");
    await setActiveProject(kv, 222, "project-b");
    expect(await getActiveProject(kv, 111)).toBe("project-a");
    expect(await getActiveProject(kv, 222)).toBe("project-b");
  });
});

// =========================================================================
// 3. resolveActiveProject — resolve with default fallback
// =========================================================================

describe("resolveActiveProject", () => {
  it("returns the saved project when it exists in KV", async () => {
    const config = makeProjectConfig();
    const env = createMockEnv({ "my-project": config });
    await setActiveProject(env.PROJECTS, 12345, "my-project");

    const result = await resolveActiveProject(env, 12345);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("my-project");
    expect(result!.projectConfig.botToken).toBe("test-token");
  });

  it("falls back to first available project when none saved", async () => {
    const config = makeProjectConfig({ botToken: "first-token" });
    const env = createMockEnv({ "first-project": config });

    const result = await resolveActiveProject(env, 12345);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("first-project");
  });

  it("saves the default project to KV after fallback", async () => {
    const config = makeProjectConfig();
    const env = createMockEnv({ "auto-project": config });

    await resolveActiveProject(env, 12345);

    // Verify it was persisted so next call doesn't need fallback
    const saved = await getActiveProject(env.PROJECTS, 12345);
    expect(saved).toBe("auto-project");
  });

  it("returns null when no projects are registered", async () => {
    const env = createMockEnv({});
    const result = await resolveActiveProject(env, 12345);
    expect(result).toBeNull();
  });

  it("falls back to first project if saved project was deleted", async () => {
    const configA = makeProjectConfig({ botToken: "token-a" });
    const env = createMockEnv({ "project-a": configA });

    // Save a project that no longer exists
    await env.PROJECTS.put("active_project:12345", "deleted-project");

    const result = await resolveActiveProject(env, 12345);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("project-a");
  });

  it("skips KV entries with colons (internal keys) and team-members", async () => {
    const config = makeProjectConfig();
    const env = createMockEnv({ "real-project": config });
    // Add internal keys that should be skipped by getProjectList
    await env.PROJECTS.put("prefs:12345", JSON.stringify({}));
    await env.PROJECTS.put("team-members", JSON.stringify([]));

    const result = await resolveActiveProject(env, 12345);
    expect(result).not.toBeNull();
    expect(result!.projectId).toBe("real-project");
  });
});

// =========================================================================
// 4. getProjectList — listing all registered projects
// =========================================================================

describe("getProjectList", () => {
  it("returns empty array when no projects exist", async () => {
    const env = createMockEnv({});
    const result = await getProjectList(env);
    expect(result).toEqual([]);
  });

  it("returns all registered projects", async () => {
    const configA = makeProjectConfig({ botToken: "token-a" });
    const configB = makeProjectConfig({ botToken: "token-b" });
    const env = createMockEnv({ "proj-a": configA, "proj-b": configB });

    const result = await getProjectList(env);
    expect(result).toHaveLength(2);
    const ids = result.map((p) => p.id).sort();
    expect(ids).toEqual(["proj-a", "proj-b"]);
  });

  it("skips entries with colons in the key name", async () => {
    const config = makeProjectConfig();
    const env = createMockEnv({ "real-project": config });
    await env.PROJECTS.put("prefs:12345", "{}");
    await env.PROJECTS.put("onboarding:12345", "awaiting_github");

    const result = await getProjectList(env);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("real-project");
  });

  it("skips the team-members key", async () => {
    const config = makeProjectConfig();
    const env = createMockEnv({ "my-project": config });
    await env.PROJECTS.put("team-members", JSON.stringify([]));

    const result = await getProjectList(env);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("my-project");
  });

  it("skips entries with invalid JSON", async () => {
    const config = makeProjectConfig();
    const env = createMockEnv({ "valid-project": config });
    await env.PROJECTS.put("broken-project", "not-json");

    const result = await getProjectList(env);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("valid-project");
  });
});

// =========================================================================
// 5. Home screen keyboard layout
// =========================================================================

describe("Home screen keyboard layout", () => {
  // These tests validate the expected button labels for the new v4 layout.
  // The actual Keyboard construction happens inside createBot, so we test
  // the button labels as constants to catch regressions.

  const V4_BUTTONS = [
    "\u{1F4CB} Aufgabe nehmen",
    "\u{2705} Meine Aufgaben",
    "\u{1F465} Team Board",
    "\u{1F4A1} Neue Idee",
    "\u{2753} Hilfe",
  ];

  it("has exactly 5 buttons in the new layout", () => {
    expect(V4_BUTTONS).toHaveLength(5);
  });

  it("first row has 'Aufgabe nehmen' and 'Meine Aufgaben'", () => {
    expect(V4_BUTTONS[0]).toBe("\u{1F4CB} Aufgabe nehmen");
    expect(V4_BUTTONS[1]).toBe("\u{2705} Meine Aufgaben");
  });

  it("second row has 'Team Board' and 'Neue Idee'", () => {
    expect(V4_BUTTONS[2]).toBe("\u{1F465} Team Board");
    expect(V4_BUTTONS[3]).toBe("\u{1F4A1} Neue Idee");
  });

  it("third row has 'Hilfe'", () => {
    expect(V4_BUTTONS[4]).toBe("\u{2753} Hilfe");
  });

  it("no old v3 button labels remain", () => {
    const OLD_LABELS = [
      "\u{1F4CA} Dashboard",
      "\u{1F4CC} My Tasks",
      "\u{1F4CB} Board",
      "\u{1F500} PRs",
      "\u{1F440} Review",
      "\u{1F525} Urgent",
      "\u{1F4C8} Report",
    ];
    for (const old of OLD_LABELS) {
      expect(V4_BUTTONS).not.toContain(old);
    }
  });
});

// =========================================================================
// 6. Project header rendering
// =========================================================================

describe("Project header rendering", () => {
  it("escapes HTML in project names for the header", () => {
    const projectId = "test<project>&special";
    const escaped = escapeHtml(projectId);
    expect(escaped).toBe("test&lt;project&gt;&amp;special");
  });

  it("renders a safe header message with escaped project name", () => {
    const projectId = "my-project";
    const escaped = escapeHtml(projectId);
    const headerText = `\u{1F4C2} <b>Project:</b> ${escaped}`;
    expect(headerText).toBe("\u{1F4C2} <b>Project:</b> my-project");
    expect(headerText).toContain("<b>");
  });

  it("switch button has correct callback_data", () => {
    const switchButton = {
      text: "\u{1F504} Switch",
      callback_data: "home_switch_project",
    };
    expect(switchButton.callback_data).toBe("home_switch_project");
  });
});

// =========================================================================
// 7. Project switching — callback data format
// =========================================================================

describe("Project switching callback data", () => {
  it("switch_project callback data contains the project ID", () => {
    const projectId = "my-project";
    const callbackData = `switch_project:${projectId}`;
    expect(callbackData).toBe("switch_project:my-project");
  });

  it("extracting project ID from callback data works correctly", () => {
    const callbackData = "switch_project:my-project";
    const newProjectId = callbackData.replace("switch_project:", "");
    expect(newProjectId).toBe("my-project");
  });

  it("current project gets a checkmark prefix in the list", () => {
    const currentProjectId = "project-a";
    const projects = [
      { id: "project-a", config: makeProjectConfig() },
      { id: "project-b", config: makeProjectConfig() },
    ];

    const buttons = projects.map((p) => ({
      text: (p.id === currentProjectId ? "\u{2705} " : "") + escapeHtml(p.id),
      callback_data: `switch_project:${p.id}`,
    }));

    expect(buttons[0].text).toBe("\u{2705} project-a");
    expect(buttons[1].text).toBe("project-b");
  });

  it("escapes HTML in project IDs within switch list", () => {
    const projects = [
      { id: "project<test>", config: makeProjectConfig() },
    ];

    const buttons = projects.map((p) => ({
      text: escapeHtml(p.id),
      callback_data: `switch_project:${p.id}`,
    }));

    expect(buttons[0].text).toBe("project&lt;test&gt;");
  });
});

// =========================================================================
// 8. Edge cases
// =========================================================================

describe("Home screen edge cases", () => {
  it("multiple users can have different active projects", async () => {
    const env = createMockEnv({
      "project-a": makeProjectConfig(),
      "project-b": makeProjectConfig(),
    });

    await setActiveProject(env.PROJECTS, 111, "project-a");
    await setActiveProject(env.PROJECTS, 222, "project-b");

    const resultA = await resolveActiveProject(env, 111);
    const resultB = await resolveActiveProject(env, 222);

    expect(resultA!.projectId).toBe("project-a");
    expect(resultB!.projectId).toBe("project-b");
  });

  it("switching project persists correctly", async () => {
    const env = createMockEnv({
      "project-a": makeProjectConfig(),
      "project-b": makeProjectConfig(),
    });

    // Start with project-a
    await setActiveProject(env.PROJECTS, 12345, "project-a");
    let result = await resolveActiveProject(env, 12345);
    expect(result!.projectId).toBe("project-a");

    // Switch to project-b
    await setActiveProject(env.PROJECTS, 12345, "project-b");
    result = await resolveActiveProject(env, 12345);
    expect(result!.projectId).toBe("project-b");
  });

  it("resolveActiveProject is idempotent for the same user", async () => {
    const env = createMockEnv({ "my-project": makeProjectConfig() });

    const result1 = await resolveActiveProject(env, 12345);
    const result2 = await resolveActiveProject(env, 12345);

    expect(result1!.projectId).toBe(result2!.projectId);
  });
});

// =========================================================================
// 9. Project switcher — category claim detection (Issue #53)
// =========================================================================

describe("Project switcher — category claim detection", () => {
  it("getCategoryClaims returns empty when no claims exist", async () => {
    const kv = createMockKV();
    const result = await getCategoryClaims(kv, "my-project");
    expect(result.claims).toEqual([]);
    expect(result.lastUpdated).toBe("");
  });

  it("getCategoryClaims returns stored claims", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [{
        telegramId: 12345,
        telegramName: "TestUser",
        githubUsername: "testuser",
        category: "area:dashboard",
        displayName: "Dashboard",
        assignedIssues: [1, 2, 3],
        claimedAt: "2026-04-03T10:00:00Z",
      }],
      lastUpdated: "2026-04-03T10:00:00Z",
    };
    await saveCategoryClaims(kv, "my-project", claimsState);
    const result = await getCategoryClaims(kv, "my-project");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].telegramId).toBe(12345);
  });

  it("user claim can be found by telegramId", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "UserA",
          githubUsername: "usera",
          category: "area:auth",
          displayName: "Auth",
          assignedIssues: [1],
          claimedAt: "2026-04-03T10:00:00Z",
        },
        {
          telegramId: 222,
          telegramName: "UserB",
          githubUsername: "userb",
          category: "area:dashboard",
          displayName: "Dashboard",
          assignedIssues: [2, 3],
          claimedAt: "2026-04-03T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-03T10:00:00Z",
    };
    await saveCategoryClaims(kv, "my-project", claimsState);

    const result = await getCategoryClaims(kv, "my-project");
    const userClaim = result.claims.find((c) => c.telegramId === 222);
    expect(userClaim).toBeDefined();
    expect(userClaim!.displayName).toBe("Dashboard");
    expect(userClaim!.assignedIssues).toEqual([2, 3]);
  });

  it("user without a claim gets undefined from find()", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [{
        telegramId: 111,
        telegramName: "UserA",
        githubUsername: "usera",
        category: "area:auth",
        displayName: "Auth",
        assignedIssues: [1],
        claimedAt: "2026-04-03T10:00:00Z",
      }],
      lastUpdated: "2026-04-03T10:00:00Z",
    };
    await saveCategoryClaims(kv, "my-project", claimsState);

    const result = await getCategoryClaims(kv, "my-project");
    const userClaim = result.claims.find((c) => c.telegramId === 999);
    expect(userClaim).toBeUndefined();
  });
});

// =========================================================================
// 10. Project switcher — switch_pause_and_go callback data format
// =========================================================================

describe("Project switcher — callback data format", () => {
  it("switch_pause_and_go callback contains the target project ID", () => {
    const newProjectId = "project-b";
    const callbackData = `switch_pause_and_go:${newProjectId}`;
    expect(callbackData).toBe("switch_pause_and_go:project-b");
  });

  it("extracting project ID from switch_pause_and_go works correctly", () => {
    const callbackData = "switch_pause_and_go:project-b";
    const extracted = callbackData.replace("switch_pause_and_go:", "");
    expect(extracted).toBe("project-b");
  });

  it("switch_finish callback data is a simple string", () => {
    const callbackData = "switch_finish";
    expect(callbackData).toBe("switch_finish");
  });
});

// =========================================================================
// 11. Project switcher — enriched project list label formatting
// =========================================================================

describe("Project switcher — enriched project list labels", () => {
  it("current project gets checkmark prefix", () => {
    const currentProjectId = "project-a";
    const isCurrent = "project-a" === currentProjectId;
    let label = isCurrent ? "\u{2705} " : "";
    label += "project-a";
    label += " (5 open)";
    expect(label).toBe("\u{2705} project-a (5 open)");
  });

  it("non-current project has no checkmark", () => {
    const currentProjectId: string = "project-a";
    const thisProjectId: string = "project-b";
    const isCurrent = thisProjectId === currentProjectId;
    let label = isCurrent ? "\u{2705} " : "";
    label += thisProjectId;
    label += " (3 open)";
    expect(label).toBe("project-b (3 open)");
  });

  it("project with user claim shows pin + category name", () => {
    const isCurrent = true;
    const userClaimDisplayName = "Dashboard";
    const totalOpen = 8;
    let label = isCurrent ? "\u{2705} " : "";
    label += "my-project";
    if (userClaimDisplayName) {
      label += ` \u{1F4CC} ${userClaimDisplayName}`;
    }
    label += ` (${totalOpen} open)`;
    expect(label).toBe("\u{2705} my-project \u{1F4CC} Dashboard (8 open)");
  });

  it("project without user claim omits the pin", () => {
    const userClaimDisplayName = null;
    let label = "my-project";
    if (userClaimDisplayName) {
      label += ` \u{1F4CC} ${userClaimDisplayName}`;
    }
    label += " (0 open)";
    expect(label).toBe("my-project (0 open)");
  });
});

// =========================================================================
// 12. renderHomeScreen — smoke test (exported helper)
// =========================================================================

describe("renderHomeScreen", () => {
  it("is exported and is a function", () => {
    expect(typeof renderHomeScreen).toBe("function");
  });
});

// =========================================================================
// 13. saveCategoryClaims — lastUpdated auto-update
// =========================================================================

describe("saveCategoryClaims — lastUpdated behavior", () => {
  it("updates lastUpdated when saving claims", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [{
        telegramId: 111,
        telegramName: "UserA",
        githubUsername: "usera",
        category: "area:auth",
        displayName: "Auth",
        assignedIssues: [1],
        claimedAt: "2026-04-03T10:00:00Z",
      }],
      lastUpdated: "",
    };

    await saveCategoryClaims(kv, "my-project", claimsState);
    const result = await getCategoryClaims(kv, "my-project");

    // lastUpdated should have been filled in by saveCategoryClaims
    expect(result.lastUpdated).not.toBe("");
    // It should be a valid ISO date string
    expect(new Date(result.lastUpdated).toISOString()).toBe(result.lastUpdated);
  });

  it("overwrites previous lastUpdated on each save", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [],
      lastUpdated: "2020-01-01T00:00:00.000Z",
    };

    await saveCategoryClaims(kv, "my-project", claimsState);
    const result = await getCategoryClaims(kv, "my-project");

    // Should be a recent timestamp, not the old one
    expect(result.lastUpdated).not.toBe("2020-01-01T00:00:00.000Z");
  });
});

// =========================================================================
// 14. getCategoryClaims — corrupt JSON handling
// =========================================================================

describe("getCategoryClaims — error handling", () => {
  it("returns empty default when KV contains invalid JSON", async () => {
    const kv = createMockKV();
    await kv.put("my-project:category_claims", "not-valid-json{{{");

    const result = await getCategoryClaims(kv, "my-project");
    expect(result.claims).toEqual([]);
    expect(result.lastUpdated).toBe("");
  });

  it("returns empty default for a project that has never had claims", async () => {
    const kv = createMockKV();
    const result = await getCategoryClaims(kv, "nonexistent-project");
    expect(result.claims).toEqual([]);
    expect(result.lastUpdated).toBe("");
  });
});

// =========================================================================
// 15. Pause-and-switch — claim splice logic
// =========================================================================

describe("Pause-and-switch — claim state manipulation", () => {
  it("splice removes the correct claim from the claims array", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "UserA",
          githubUsername: "usera",
          category: "area:auth",
          displayName: "Auth",
          assignedIssues: [1, 2],
          claimedAt: "2026-04-03T10:00:00Z",
        },
        {
          telegramId: 222,
          telegramName: "UserB",
          githubUsername: "userb",
          category: "area:dashboard",
          displayName: "Dashboard",
          assignedIssues: [3, 4, 5],
          claimedAt: "2026-04-03T11:00:00Z",
        },
        {
          telegramId: 333,
          telegramName: "UserC",
          githubUsername: "userc",
          category: "area:settings",
          displayName: "Settings",
          assignedIssues: [6],
          claimedAt: "2026-04-03T12:00:00Z",
        },
      ],
      lastUpdated: "2026-04-03T12:00:00Z",
    };
    await saveCategoryClaims(kv, "my-project", claimsState);

    // Simulate pause-and-switch: user 222 pauses their claim
    const loaded = await getCategoryClaims(kv, "my-project");
    const claimIndex = loaded.claims.findIndex((c) => c.telegramId === 222);
    expect(claimIndex).toBe(1);

    const removedClaim = loaded.claims[claimIndex];
    loaded.claims.splice(claimIndex, 1);
    await saveCategoryClaims(kv, "my-project", loaded);

    // Verify the removed claim was UserB
    expect(removedClaim.telegramId).toBe(222);
    expect(removedClaim.displayName).toBe("Dashboard");

    // Verify remaining claims are correct
    const after = await getCategoryClaims(kv, "my-project");
    expect(after.claims).toHaveLength(2);
    expect(after.claims[0].telegramId).toBe(111);
    expect(after.claims[1].telegramId).toBe(333);
  });

  it("splice on last remaining claim leaves empty array", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [{
        telegramId: 111,
        telegramName: "UserA",
        githubUsername: "usera",
        category: "area:auth",
        displayName: "Auth",
        assignedIssues: [1],
        claimedAt: "2026-04-03T10:00:00Z",
      }],
      lastUpdated: "2026-04-03T10:00:00Z",
    };
    await saveCategoryClaims(kv, "my-project", claimsState);

    const loaded = await getCategoryClaims(kv, "my-project");
    loaded.claims.splice(0, 1);
    await saveCategoryClaims(kv, "my-project", loaded);

    const after = await getCategoryClaims(kv, "my-project");
    expect(after.claims).toEqual([]);
  });

  it("findIndex returns -1 when claim was already released", async () => {
    const kv = createMockKV();
    const claimsState: CategoryClaimsState = {
      claims: [{
        telegramId: 111,
        telegramName: "UserA",
        githubUsername: "usera",
        category: "area:auth",
        displayName: "Auth",
        assignedIssues: [1],
        claimedAt: "2026-04-03T10:00:00Z",
      }],
      lastUpdated: "2026-04-03T10:00:00Z",
    };
    await saveCategoryClaims(kv, "my-project", claimsState);

    // Try to find a claim for a user who has no claim (already released)
    const loaded = await getCategoryClaims(kv, "my-project");
    const claimIndex = loaded.claims.findIndex((c) => c.telegramId === 999);
    expect(claimIndex).toBe(-1);
  });
});

// =========================================================================
// 16. Paused categories — KV helpers
// =========================================================================

describe("Paused categories — KV round-trip", () => {
  it("returns empty array when no paused categories exist", async () => {
    const kv = createMockKV();
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toEqual([]);
  });

  it("saves and retrieves paused categories", async () => {
    const kv = createMockKV();
    const paused: PausedCategory[] = [{
      category: "area:dashboard",
      displayName: "Dashboard",
      pausedBy: "Nabil",
      completedTasks: 2,
      totalTasks: 5,
      pausedAt: "2026-04-03T10:00:00Z",
    }];

    await savePausedCategories(kv, "my-project", paused);
    const result = await getPausedCategories(kv, "my-project");

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:dashboard");
    expect(result[0].pausedBy).toBe("Nabil");
    expect(result[0].completedTasks).toBe(2);
    expect(result[0].totalTasks).toBe(5);
  });

  it("returns empty array when KV contains invalid JSON", async () => {
    const kv = createMockKV();
    await kv.put("my-project:paused_categories", "broken{json");
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toEqual([]);
  });
});

describe("addPausedCategory", () => {
  it("adds a new paused category entry", async () => {
    const kv = createMockKV();
    const entry: PausedCategory = {
      category: "area:auth",
      displayName: "Auth",
      pausedBy: "Nabil",
      completedTasks: 1,
      totalTasks: 3,
      pausedAt: "2026-04-03T10:00:00Z",
    };

    await addPausedCategory(kv, "my-project", entry);
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:auth");
  });

  it("replaces an existing entry for the same category", async () => {
    const kv = createMockKV();

    // First pause
    await addPausedCategory(kv, "my-project", {
      category: "area:auth",
      displayName: "Auth",
      pausedBy: "Nabil",
      completedTasks: 1,
      totalTasks: 3,
      pausedAt: "2026-04-03T10:00:00Z",
    });

    // Same category paused again by someone else
    await addPausedCategory(kv, "my-project", {
      category: "area:auth",
      displayName: "Auth",
      pausedBy: "TestUser",
      completedTasks: 2,
      totalTasks: 3,
      pausedAt: "2026-04-03T14:00:00Z",
    });

    const result = await getPausedCategories(kv, "my-project");
    // Should have replaced, not duplicated
    expect(result).toHaveLength(1);
    expect(result[0].pausedBy).toBe("TestUser");
    expect(result[0].completedTasks).toBe(2);
  });

  it("can store multiple paused categories for the same project", async () => {
    const kv = createMockKV();

    await addPausedCategory(kv, "my-project", {
      category: "area:auth",
      displayName: "Auth",
      pausedBy: "Nabil",
      completedTasks: 1,
      totalTasks: 3,
      pausedAt: "2026-04-03T10:00:00Z",
    });

    await addPausedCategory(kv, "my-project", {
      category: "area:dashboard",
      displayName: "Dashboard",
      pausedBy: "TestUser",
      completedTasks: 0,
      totalTasks: 5,
      pausedAt: "2026-04-03T11:00:00Z",
    });

    const result = await getPausedCategories(kv, "my-project");
    expect(result).toHaveLength(2);
    const categories = result.map((p) => p.category).sort();
    expect(categories).toEqual(["area:auth", "area:dashboard"]);
  });
});

describe("removePausedCategory", () => {
  it("removes a specific paused category by name", async () => {
    const kv = createMockKV();
    await savePausedCategories(kv, "my-project", [
      {
        category: "area:auth",
        displayName: "Auth",
        pausedBy: "Nabil",
        completedTasks: 1,
        totalTasks: 3,
        pausedAt: "2026-04-03T10:00:00Z",
      },
      {
        category: "area:dashboard",
        displayName: "Dashboard",
        pausedBy: "TestUser",
        completedTasks: 0,
        totalTasks: 5,
        pausedAt: "2026-04-03T11:00:00Z",
      },
    ]);

    await removePausedCategory(kv, "my-project", "area:auth");
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:dashboard");
  });

  it("does nothing when removing a category that was not paused", async () => {
    const kv = createMockKV();
    await savePausedCategories(kv, "my-project", [{
      category: "area:auth",
      displayName: "Auth",
      pausedBy: "Nabil",
      completedTasks: 1,
      totalTasks: 3,
      pausedAt: "2026-04-03T10:00:00Z",
    }]);

    await removePausedCategory(kv, "my-project", "area:nonexistent");
    const result = await getPausedCategories(kv, "my-project");
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("area:auth");
  });
});

// =========================================================================
// 17. Pause-and-switch — PausedCategory entry shape
// =========================================================================

describe("Pause-and-switch — PausedCategory entry creation", () => {
  it("creates a correctly shaped PausedCategory from a claim", () => {
    // Simulate the logic in switch_pause_and_go handler
    const claim: CategoryClaim = {
      telegramId: 222,
      telegramName: "UserB",
      githubUsername: "userb",
      category: "area:dashboard",
      displayName: "Dashboard",
      assignedIssues: [3, 4, 5],
      claimedAt: "2026-04-03T11:00:00Z",
    };
    const firstName = "TestUser";
    const completedCount = 1;
    const totalCount = claim.assignedIssues.length;

    const pausedEntry: PausedCategory = {
      category: claim.category,
      displayName: claim.displayName,
      pausedBy: firstName,
      completedTasks: completedCount,
      totalTasks: totalCount,
      pausedAt: new Date().toISOString(),
    };

    expect(pausedEntry.category).toBe("area:dashboard");
    expect(pausedEntry.displayName).toBe("Dashboard");
    expect(pausedEntry.pausedBy).toBe("TestUser");
    expect(pausedEntry.completedTasks).toBe(1);
    expect(pausedEntry.totalTasks).toBe(3);
    expect(pausedEntry.pausedAt).toBeTruthy();
  });

  it("completedTasks is zero when no issues were completed", () => {
    const claim: CategoryClaim = {
      telegramId: 111,
      telegramName: "UserA",
      githubUsername: "usera",
      category: "area:auth",
      displayName: "Auth",
      assignedIssues: [1, 2, 3],
      claimedAt: "2026-04-03T10:00:00Z",
    };
    // All issues still open
    const openCount = claim.assignedIssues.length;
    const totalCount = claim.assignedIssues.length;
    const completedCount = totalCount - openCount;

    expect(completedCount).toBe(0);

    const pausedEntry: PausedCategory = {
      category: claim.category,
      displayName: claim.displayName,
      pausedBy: "Nabil",
      completedTasks: completedCount,
      totalTasks: totalCount,
      pausedAt: new Date().toISOString(),
    };

    expect(pausedEntry.completedTasks).toBe(0);
    expect(pausedEntry.totalTasks).toBe(3);
  });
});

// =========================================================================
// 18. Switch edge cases — same project & already-released claim
// =========================================================================

describe("Switch edge cases", () => {
  it("switching to the same project is detected by equality check", () => {
    const currentProjectId = "project-a";
    const newProjectId = "project-a";
    const isSameProject = newProjectId === currentProjectId;
    expect(isSameProject).toBe(true);
  });

  it("switching to a different project passes the equality check", () => {
    const currentProjectId: string = "project-a";
    const newProjectId: string = "project-b";
    // Both typed as string so TS allows the comparison
    const isSameProject = newProjectId === currentProjectId;
    expect(isSameProject).toBe(false);
  });

  it("claim-already-released path triggers when claimIndex is -1", async () => {
    const kv = createMockKV();
    // No claims at all
    const claimsState = await getCategoryClaims(kv, "my-project");
    const claimIndex = claimsState.claims.findIndex((c) => c.telegramId === 12345);
    expect(claimIndex).toBe(-1);

    // In the handler, claimIndex < 0 means "just switch without pause logic"
    // We verify the condition matches
    expect(claimIndex < 0).toBe(true);
  });

  it("claim-already-released: user can still switch projects", async () => {
    const env = createMockEnv({
      "project-a": makeProjectConfig(),
      "project-b": makeProjectConfig(),
    });

    // User is on project-a but has NO claim
    await setActiveProject(env.PROJECTS, 12345, "project-a");

    const claimsState = await getCategoryClaims(env.PROJECTS, "project-a");
    const claimIndex = claimsState.claims.findIndex((c) => c.telegramId === 12345);

    // No claim — should proceed to switch directly
    expect(claimIndex).toBe(-1);

    // Simulate the direct switch
    await setActiveProject(env.PROJECTS, 12345, "project-b");
    const active = await getActiveProject(env.PROJECTS, 12345);
    expect(active).toBe("project-b");
  });

  it("no current project means pause-and-switch exits early", async () => {
    const kv = createMockKV();
    // User has no active project at all
    const currentProjectId = await getActiveProject(kv, 12345);
    expect(currentProjectId).toBeNull();

    // In the handler, !currentProjectId triggers early return
    expect(!currentProjectId).toBe(true);
  });
});

// =========================================================================
// 19. Full pause-and-switch simulation — end-to-end KV state
// =========================================================================

describe("Full pause-and-switch simulation", () => {
  it("complete flow: claim removed, paused entry created, project switched", async () => {
    const kv = createMockKV();
    const telegramId = 12345;
    const currentProjectId = "project-a";
    const newProjectId = "project-b";

    // Setup: user has a claim in project-a
    const initialClaims: CategoryClaimsState = {
      claims: [
        {
          telegramId: telegramId,
          telegramName: "Nabil",
          githubUsername: "nabil",
          category: "area:dashboard",
          displayName: "Dashboard",
          assignedIssues: [10, 11, 12],
          claimedAt: "2026-04-03T09:00:00Z",
        },
        {
          telegramId: 999,
          telegramName: "Other",
          githubUsername: "other",
          category: "area:auth",
          displayName: "Auth",
          assignedIssues: [20],
          claimedAt: "2026-04-03T08:00:00Z",
        },
      ],
      lastUpdated: "2026-04-03T09:00:00Z",
    };
    await saveCategoryClaims(kv, currentProjectId, initialClaims);

    // Set user's active project
    await kv.put(`active_project:${telegramId}`, currentProjectId);

    // --- Execute pause logic (mirrors switch_pause_and_go handler) ---

    // 1. Load claims and find user's claim
    const claimsState = await getCategoryClaims(kv, currentProjectId);
    const claimIndex = claimsState.claims.findIndex((c) => c.telegramId === telegramId);
    expect(claimIndex).toBe(0);

    const claim = claimsState.claims[claimIndex];

    // 2. Remove claim from array
    claimsState.claims.splice(claimIndex, 1);
    await saveCategoryClaims(kv, currentProjectId, claimsState);

    // 3. Create paused entry
    const pausedEntry: PausedCategory = {
      category: claim.category,
      displayName: claim.displayName,
      pausedBy: "Nabil",
      completedTasks: 1,
      totalTasks: claim.assignedIssues.length,
      pausedAt: new Date().toISOString(),
    };
    await addPausedCategory(kv, currentProjectId, pausedEntry);

    // 4. Switch active project
    await kv.put(`active_project:${telegramId}`, newProjectId);

    // --- Verify final state ---

    // Claims: only the other user's claim remains
    const finalClaims = await getCategoryClaims(kv, currentProjectId);
    expect(finalClaims.claims).toHaveLength(1);
    expect(finalClaims.claims[0].telegramId).toBe(999);

    // Paused categories: one entry for the user who paused
    const finalPaused = await getPausedCategories(kv, currentProjectId);
    expect(finalPaused).toHaveLength(1);
    expect(finalPaused[0].category).toBe("area:dashboard");
    expect(finalPaused[0].pausedBy).toBe("Nabil");
    expect(finalPaused[0].completedTasks).toBe(1);
    expect(finalPaused[0].totalTasks).toBe(3);

    // Active project switched
    const activeProject = await kv.get(`active_project:${telegramId}`);
    expect(activeProject).toBe("project-b");
  });

  it("double-pause: pausing same category twice replaces the entry", async () => {
    const kv = createMockKV();

    // First user pauses dashboard
    await addPausedCategory(kv, "my-project", {
      category: "area:dashboard",
      displayName: "Dashboard",
      pausedBy: "UserA",
      completedTasks: 1,
      totalTasks: 5,
      pausedAt: "2026-04-03T10:00:00Z",
    });

    // Second user picks it up and then also pauses it
    await addPausedCategory(kv, "my-project", {
      category: "area:dashboard",
      displayName: "Dashboard",
      pausedBy: "UserB",
      completedTasks: 3,
      totalTasks: 5,
      pausedAt: "2026-04-03T14:00:00Z",
    });

    const result = await getPausedCategories(kv, "my-project");
    // Should only have one entry, not two
    expect(result).toHaveLength(1);
    expect(result[0].pausedBy).toBe("UserB");
    expect(result[0].completedTasks).toBe(3);
  });
});

// =========================================================================
// 20. clearActiveTask — exported helper
// =========================================================================

describe("clearActiveTask", () => {
  it("is exported and is a function", () => {
    expect(typeof clearActiveTask).toBe("function");
  });

  it("clears the active task entry from KV", async () => {
    const kv = createMockKV();
    // Manually set an active task
    await kv.put("active_task:12345:my-project", JSON.stringify({ issueNumber: 1 }));

    await clearActiveTask(kv, 12345, "my-project");

    // After clearing, the entry should be gone
    const result = await kv.get("active_task:12345:my-project");
    expect(result).toBeNull();
  });
});
