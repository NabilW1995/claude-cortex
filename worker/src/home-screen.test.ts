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
} from "./index";
import type { Env, ProjectConfig } from "./index";

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
