/**
 * Team Board — Unit Tests
 *
 * Tests the renderTeamBoard function: multi-project overview showing claimed
 * categories with member colors and progress, paused categories, unclaimed
 * (free) categories, branch/PR status, priority grouping, escapeHtml on
 * user-supplied strings, and various empty/edge states.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderTeamBoard,
  getTeamMembers,
  getCategoryClaims,
  saveCategoryClaims,
  getPausedCategories,
  savePausedCategories,
  setActiveProject,
  escapeHtml,
  getUserColor,
  sortByPriority,
  getIssuePriority,
  PRIORITY_EMOJIS,
  PRIORITY_DEFAULT,
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

// ---------------------------------------------------------------------------
// Helper to build a GitHub issues API response
// ---------------------------------------------------------------------------

function makeGitHubIssue(
  number: number,
  title: string,
  labels: string[] = [],
  extra: Record<string, unknown> = {}
) {
  return {
    number,
    title,
    html_url: `https://github.com/test-org/test-repo/issues/${number}`,
    labels: labels.map((name) => ({ name })),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a GitHub PR API response
// ---------------------------------------------------------------------------

function makeGitHubPR(
  number: number,
  title: string,
  branchRef: string,
  user: string = "testuser"
) {
  return {
    number,
    title,
    head: { ref: branchRef },
    user: { login: user },
  };
}

// =========================================================================
// 1. Empty state — no projects configured
// =========================================================================

describe("renderTeamBoard — empty state", () => {
  it("returns 'No projects configured' when there are no projects", async () => {
    const env = createMockEnv({});
    const { text, keyboard } = await renderTeamBoard(env, 12345);

    expect(text).toContain("Team Board");
    expect(text).toContain("No projects configured yet.");
    // Keyboard should have no buttons (grammy InlineKeyboard starts with one empty row)
    const allButtons = keyboard.inline_keyboard.flat();
    expect(allButtons).toHaveLength(0);
  });
});

// =========================================================================
// 2. Project with no categories at all
// =========================================================================

describe("renderTeamBoard — project with no categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows 'No categories found' when project has no claims, paused, or open issues", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    // GitHub issues API returns empty list
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    // GitHub PRs API returns empty list
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("No categories found.");
    expect(text).toContain("my-project");
  });
});

// =========================================================================
// 3. Claimed categories with progress and branch status
// =========================================================================

describe("renderTeamBoard — claimed categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows claimed category with member name, display name, and progress", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:dashboard",
          displayName: "Dashboard",
          assignedIssues: [10, 11, 12],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    // GitHub issues API: issues #10 and #11 are still open, #12 is closed (not in list)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(10, "Fix dashboard layout", ["area:dashboard", "priority:high"]),
          makeGitHubIssue(11, "Add chart widget", ["area:dashboard", "priority:medium"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    // GitHub PRs API: no matching PR
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);

    // Should show display name and telegram name
    expect(text).toContain("Dashboard");
    expect(text).toContain("alice_tg");
    // Progress: 1 done out of 3 total (issue #12 is no longer open)
    expect(text).toContain("1/3 done");
    // Branch status: no PR found => "in progress"
    expect(text).toContain("in progress");
  });

  it("shows 'PR open' when a matching PR exists for the category", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:auth",
          displayName: "Auth",
          assignedIssues: [20],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    // GitHub issues API: issue #20 is still open
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(20, "Implement login", ["area:auth", "priority:high"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    // GitHub PRs API: a PR matching "auth" branch
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubPR(50, "feat: auth system", "feature/auth-login", "alice"),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("PR open");
    expect(text).not.toContain("in progress");
  });

  it("shows '0 issues' when claimed category has no assigned issues", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:empty",
          displayName: "Empty",
          assignedIssues: [],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("0 issues");
  });

  it("shows all assigned issues done when none are still open", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:api",
          displayName: "API",
          assignedIssues: [30, 31, 32],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    // No issues open (all done)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("3/3 done");
  });
});

// =========================================================================
// 4. Priority grouping within categories
// =========================================================================

describe("renderTeamBoard — priority sorting within claimed categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows tasks sorted by priority (blocker > high > medium > low)", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:ui",
          displayName: "UI",
          assignedIssues: [1, 2, 3, 4],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(1, "Low task", ["area:ui", "priority:low"]),
          makeGitHubIssue(2, "Blocker task", ["area:ui", "priority:blocker"]),
          makeGitHubIssue(3, "High task", ["area:ui", "priority:high"]),
          makeGitHubIssue(4, "Medium task", ["area:ui", "priority:medium"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);

    // Verify order: blocker (#2) > high (#3) > medium (#4) > low (#1)
    const blockerPos = text.indexOf("#2");
    const highPos = text.indexOf("#3");
    const mediumPos = text.indexOf("#4");
    const lowPos = text.indexOf("#1 ");

    expect(blockerPos).toBeGreaterThan(-1);
    expect(highPos).toBeGreaterThan(-1);
    expect(mediumPos).toBeGreaterThan(-1);
    expect(lowPos).toBeGreaterThan(-1);

    expect(blockerPos).toBeLessThan(highPos);
    expect(highPos).toBeLessThan(mediumPos);
    expect(mediumPos).toBeLessThan(lowPos);
  });

  it("shows correct priority emojis next to each task", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:test",
          displayName: "Test",
          assignedIssues: [10, 11],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(10, "High item", ["area:test", "priority:high"]),
          makeGitHubIssue(11, "Low item", ["area:test", "priority:low"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain(PRIORITY_EMOJIS["priority:high"]);
    expect(text).toContain(PRIORITY_EMOJIS["priority:low"]);
  });
});

// =========================================================================
// 5. Paused categories
// =========================================================================

describe("renderTeamBoard — paused categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows paused categories with paused-by info and progress", async () => {
    const project = makeProject();
    const paused: PausedCategory[] = [
      {
        category: "area:billing",
        displayName: "Billing",
        pausedBy: "Bob",
        completedTasks: 3,
        totalTasks: 5,
        pausedAt: "2026-04-02T14:00:00Z",
      },
    ];

    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:paused_categories": JSON.stringify(paused),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("Billing");
    expect(text).toContain("paused by Bob");
    expect(text).toContain("3/5 done");
    // Should have pause icon
    expect(text).toContain("\u23F8"); // pause emoji
  });

  it("shows multiple paused categories", async () => {
    const project = makeProject();
    const paused: PausedCategory[] = [
      {
        category: "area:billing",
        displayName: "Billing",
        pausedBy: "Bob",
        completedTasks: 2,
        totalTasks: 4,
        pausedAt: "2026-04-02T14:00:00Z",
      },
      {
        category: "area:settings",
        displayName: "Settings",
        pausedBy: "Carol",
        completedTasks: 0,
        totalTasks: 3,
        pausedAt: "2026-04-02T15:00:00Z",
      },
    ];

    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:paused_categories": JSON.stringify(paused),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("Billing");
    expect(text).toContain("paused by Bob");
    expect(text).toContain("Settings");
    expect(text).toContain("paused by Carol");
  });
});

// =========================================================================
// 6. Unclaimed (free) categories
// =========================================================================

describe("renderTeamBoard — unclaimed categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows unclaimed categories as free with issue count", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    // GitHub issues: category "area:notifications" has 3 issues, not claimed
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(40, "Notify on PR", ["area:notifications", "priority:medium"]),
          makeGitHubIssue(41, "Email alerts", ["area:notifications", "priority:low"]),
          makeGitHubIssue(42, "Push notifications", ["area:notifications", "priority:high"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("Free categories:");
    expect(text).toContain("notifications");
    expect(text).toContain("free");
    expect(text).toContain("3 issues");
  });

  it("does not show claimed or paused categories as free", async () => {
    const project = makeProject();
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:claimed",
          displayName: "Claimed",
          assignedIssues: [50],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };
    const paused: PausedCategory[] = [
      {
        category: "area:paused",
        displayName: "Paused",
        pausedBy: "Bob",
        completedTasks: 1,
        totalTasks: 2,
        pausedAt: "2026-04-02T14:00:00Z",
      },
    ];
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
        "my-project:paused_categories": JSON.stringify(paused),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(50, "Claimed issue", ["area:claimed"]),
          makeGitHubIssue(51, "Paused issue", ["area:paused"]),
          makeGitHubIssue(52, "Free issue", ["area:free-stuff"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);

    // "free-stuff" should appear in free categories
    expect(text).toContain("free-stuff");
    expect(text).toContain("free");
    // "claimed" and "paused" should NOT be in the free section
    // We check that the free section does not contain them:
    const freeSection = text.substring(text.indexOf("Free categories:"));
    expect(freeSection).not.toContain("Claimed");
    expect(freeSection).not.toContain("Paused");
  });
});

// =========================================================================
// 7. Multi-project rendering
// =========================================================================

describe("renderTeamBoard — multi-project", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders separate sections for each project", async () => {
    const projectA = makeProject({ githubRepo: "org/project-alpha" });
    const projectB = makeProject({ githubRepo: "org/project-beta" });

    const env = createMockEnv({
      "project-alpha": projectA,
      "project-beta": projectB,
    });

    // project-alpha: issues + PRs (2 fetch calls)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    // project-beta: issues + PRs (2 fetch calls)
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("project-alpha");
    expect(text).toContain("project-beta");
  });
});

// =========================================================================
// 8. escapeHtml on user-supplied strings
// =========================================================================

describe("renderTeamBoard — escapeHtml on user content", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("escapes HTML in project IDs", async () => {
    // Project ID with angle brackets
    const project = makeProject();
    const env = createMockEnv({ "<script>xss</script>": project });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("escapes HTML in telegram names and display names of claimed categories", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "<b>evil</b>", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "<b>evil</b>",
          githubUsername: "alice",
          category: "area:test",
          displayName: "Test & <i>Dev</i>",
          assignedIssues: [],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    // telegramName should be escaped
    expect(text).toContain("&lt;b&gt;evil&lt;/b&gt;");
    // displayName should be escaped
    expect(text).toContain("Test &amp; &lt;i&gt;Dev&lt;/i&gt;");
    // Raw HTML tags should not appear
    expect(text).not.toMatch(/<b>evil<\/b>/);
    expect(text).not.toMatch(/<i>Dev<\/i>/);
  });

  it("escapes HTML in paused-by names", async () => {
    const project = makeProject();
    const paused: PausedCategory[] = [
      {
        category: "area:test",
        displayName: "Test",
        pausedBy: '<img src=x onerror="alert(1)">',
        completedTasks: 0,
        totalTasks: 1,
        pausedAt: "2026-04-02T14:00:00Z",
      },
    ];

    const env = createMockEnv(
      { "my-project": project },
      {
        "my-project:paused_categories": JSON.stringify(paused),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).not.toContain("<img");
    expect(text).toContain("&lt;img");
  });

  it("escapes HTML in issue titles within claimed category tasks", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:xss",
          displayName: "XSS",
          assignedIssues: [99],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(99, 'Fix <script>alert("xss")</script> bug', ["area:xss"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
  });

  it("escapes HTML in unclaimed category display names", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    // A category with angle brackets in the label name
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(60, "Some issue", ["area:<b>bad</b>"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    // The "area:" prefix is stripped, so it should show escaped "<b>bad</b>"
    expect(text).not.toContain("<b>bad</b>");
    expect(text).toContain("&lt;b&gt;bad&lt;/b&gt;");
  });
});

// =========================================================================
// 9. No GitHub token configured
// =========================================================================

describe("renderTeamBoard — no GitHub token", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("renders without errors when project has no GitHub token", async () => {
    const project = makeProject({ githubToken: undefined });
    const env = createMockEnv({ "my-project": project });

    const { text } = await renderTeamBoard(env, 12345);
    // Should still render the project section
    expect(text).toContain("my-project");
    // Should show "no categories" since we can't fetch from GitHub
    expect(text).toContain("No categories found.");
    // Should NOT have called fetch (no GitHub API calls)
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// =========================================================================
// 10. Refresh button and timestamp
// =========================================================================

describe("renderTeamBoard — footer and keyboard", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("includes a timestamp in the footer", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    // Footer contains the clock emoji and "Updated:"
    expect(text).toContain("Updated:");
  });

  it("includes a Refresh button with teamboard_refresh callback", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { keyboard } = await renderTeamBoard(env, 12345);
    const allButtons = keyboard.inline_keyboard.flat();
    const refreshBtn = allButtons.find(
      (b: any) => b.callback_data === "teamboard_refresh"
    );
    expect(refreshBtn).toBeDefined();
    expect(refreshBtn!.text).toContain("Refresh");
  });
});

// =========================================================================
// 11. Mixed state — claimed + paused + free in one project
// =========================================================================

describe("renderTeamBoard — mixed claimed, paused, and free categories", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows all three sections: claimed, paused, and free", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:frontend",
          displayName: "Frontend",
          assignedIssues: [1, 2],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };
    const paused: PausedCategory[] = [
      {
        category: "area:backend",
        displayName: "Backend",
        pausedBy: "Bob",
        completedTasks: 2,
        totalTasks: 5,
        pausedAt: "2026-04-02T14:00:00Z",
      },
    ];

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
        "my-project:paused_categories": JSON.stringify(paused),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(1, "Button styles", ["area:frontend", "priority:medium"]),
          makeGitHubIssue(2, "Form validation", ["area:frontend", "priority:high"]),
          makeGitHubIssue(3, "API endpoint", ["area:backend", "priority:medium"]),
          makeGitHubIssue(10, "Deploy script", ["area:devops", "priority:low"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);

    // Claimed: Frontend
    expect(text).toContain("Frontend");
    expect(text).toContain("alice_tg");

    // Paused: Backend
    expect(text).toContain("Backend");
    expect(text).toContain("paused by Bob");

    // Free: devops
    expect(text).toContain("Free categories:");
    expect(text).toContain("devops");
    expect(text).toContain("free");
    expect(text).toContain("1 issues");
  });
});

// =========================================================================
// 12. GitHub API error handling
// =========================================================================

describe("renderTeamBoard — GitHub API errors", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("handles issues API returning 500 gracefully (empty issues map)", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    // Issues API fails
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );
    // PRs API fails too
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    // Should not throw
    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("Team Board");
    expect(text).toContain("my-project");
  });

  it("handles PRs API fetch rejection gracefully", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    // Issues API succeeds
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    // PRs API throws network error
    fetchSpy.mockRejectedValueOnce(new Error("Network error"));

    // Should not throw — the catch in the code handles it
    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("Team Board");
  });
});

// =========================================================================
// 13. Branch status detection details
// =========================================================================

describe("renderTeamBoard — branch status detection", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("matches PR branch containing the category slug (case-insensitive)", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:User-Settings",
          displayName: "User Settings",
          assignedIssues: [70],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(70, "Settings page", ["area:User-Settings"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    // PR branch contains "user-settings" (lowercase slug)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubPR(80, "feat: user settings", "feature/user-settings-page", "alice"),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("PR open");
  });

  it("shows 'in progress' when no PR matches the category slug", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:analytics",
          displayName: "Analytics",
          assignedIssues: [80],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubIssue(80, "Add analytics", ["area:analytics"]),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    // PR exists but for a different category
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          makeGitHubPR(90, "feat: unrelated", "feature/billing-update", "bob"),
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("in progress");
    expect(text).not.toContain("PR open");
  });
});

// =========================================================================
// 14. User color assignment in board
// =========================================================================

describe("renderTeamBoard — user color assignment", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("assigns different color emojis to different team members", async () => {
    const project = makeProject();
    const teamMembers: TeamMember[] = [
      { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
      { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
    ];
    const claims: CategoryClaimsState = {
      claims: [
        {
          telegramId: 111,
          telegramName: "alice_tg",
          githubUsername: "alice",
          category: "area:frontend",
          displayName: "Frontend",
          assignedIssues: [],
          claimedAt: "2026-04-01T10:00:00Z",
        },
        {
          telegramId: 222,
          telegramName: "bob_tg",
          githubUsername: "bob",
          category: "area:backend",
          displayName: "Backend",
          assignedIssues: [],
          claimedAt: "2026-04-01T10:00:00Z",
        },
      ],
      lastUpdated: "2026-04-01T10:00:00Z",
    };

    const env = createMockEnv(
      { "my-project": project },
      {
        "team-members": JSON.stringify(teamMembers),
        "my-project:category_claims": JSON.stringify(claims),
      }
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);

    // Verify that two different color emojis are used
    const aliceColor = getUserColor(teamMembers, 111);
    const bobColor = getUserColor(teamMembers, 222);

    expect(aliceColor).not.toBe(bobColor);
    expect(text).toContain(aliceColor);
    expect(text).toContain(bobColor);
  });
});

// =========================================================================
// 15. Header formatting
// =========================================================================

describe("renderTeamBoard — header formatting", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("starts with Team Board title in bold", async () => {
    const project = makeProject();
    const env = createMockEnv({ "my-project": project });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toMatch(/^.*<b>Team Board<\/b>/);
  });

  it("shows project IDs in bold with folder emoji", async () => {
    const project = makeProject();
    const env = createMockEnv({ "test-proj": project });

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { text } = await renderTeamBoard(env, 12345);
    expect(text).toContain("<b>test-proj</b>");
  });
});
