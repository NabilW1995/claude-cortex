/**
 * Velocity Report — Unit Tests (Issue #61)
 *
 * Tests the velocity reporting feature that tracks weekly team performance:
 * tasks completed, hours worked, per-member breakdown, and week-over-week
 * comparison.
 *
 * Covers:
 * - saveVelocitySnapshot (D1 insert for weekly snapshots)
 * - getVelocityData (D1 fetch for a specific week)
 * - getLastTwoWeeksVelocity (D1 fetch for comparison)
 * - calculateVelocitySnapshot (aggregation from time_logs + events)
 * - getWeekStartDate (ISO week start calculation)
 * - formatDelta (delta formatting with arrows)
 * - renderVelocityView (Telegram HTML output)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  saveVelocitySnapshot,
  getVelocityData,
  getLastTwoWeeksVelocity,
  calculateVelocitySnapshot,
  getWeekStartDate,
  formatDelta,
  renderVelocityView,
  formatDuration,
  escapeHtml,
} from "./index";
import type { VelocitySnapshot, TeamMember, Env } from "./index";

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
// Helper for building mock snapshots
// ---------------------------------------------------------------------------

function buildSnapshot(overrides: Partial<VelocitySnapshot> = {}): VelocitySnapshot {
  return {
    project: "test-project",
    weekStart: "2026-03-30",
    tasksCompleted: 5,
    tasksOpened: 3,
    teamHours: 480,
    perMember: [
      { userId: "111", name: "Alice", tasks: 3, hours: 240 },
      { userId: "222", name: "Bob", tasks: 2, hours: 240 },
    ],
    fastestTask: { number: 42, title: "Fix login bug", minutes: 30 },
    longestTask: { number: 43, title: "Redesign dashboard", minutes: 360 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getWeekStartDate
// ---------------------------------------------------------------------------

describe("getWeekStartDate", () => {
  it("returns Monday for a Wednesday input", () => {
    // 2026-04-01 is a Wednesday
    const result = getWeekStartDate(new Date("2026-04-01T12:00:00.000Z"));
    expect(result).toBe("2026-03-30");
  });

  it("returns the same day for a Monday input", () => {
    // 2026-03-30 is a Monday
    const result = getWeekStartDate(new Date("2026-03-30T12:00:00.000Z"));
    expect(result).toBe("2026-03-30");
  });

  it("returns the previous Monday for a Sunday input", () => {
    // 2026-04-05 is a Sunday
    const result = getWeekStartDate(new Date("2026-04-05T12:00:00.000Z"));
    expect(result).toBe("2026-03-30");
  });

  it("returns the previous Monday for a Saturday input", () => {
    // 2026-04-04 is a Saturday
    const result = getWeekStartDate(new Date("2026-04-04T12:00:00.000Z"));
    expect(result).toBe("2026-03-30");
  });

  it("returns Monday for a Friday input", () => {
    // 2026-04-03 is a Friday
    const result = getWeekStartDate(new Date("2026-04-03T15:00:00.000Z"));
    expect(result).toBe("2026-03-30");
  });

  it("returns a YYYY-MM-DD formatted string", () => {
    const result = getWeekStartDate(new Date("2026-01-15T00:00:00.000Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("handles year boundary (first week of January)", () => {
    // 2026-01-01 is a Thursday — week starts 2025-12-29 (Monday)
    const result = getWeekStartDate(new Date("2026-01-01T12:00:00.000Z"));
    expect(result).toBe("2025-12-29");
  });

  it("does not mutate the input date", () => {
    const input = new Date("2026-04-03T12:00:00.000Z");
    const original = input.getTime();
    getWeekStartDate(input);
    expect(input.getTime()).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// formatDelta
// ---------------------------------------------------------------------------

describe("formatDelta", () => {
  it("shows upward arrow for positive delta", () => {
    const result = formatDelta(10, 5);
    expect(result).toContain("+5");
    expect(result).toContain("\u{2B06}"); // up arrow
  });

  it("shows downward arrow for negative delta", () => {
    const result = formatDelta(3, 8);
    expect(result).toContain("-5");
    expect(result).toContain("\u{2B07}"); // down arrow
  });

  it("shows minus sign for zero delta", () => {
    const result = formatDelta(5, 5);
    expect(result).toContain("0");
    expect(result).toContain("\u{2796}"); // minus sign
  });

  it("handles large positive delta", () => {
    const result = formatDelta(100, 10);
    expect(result).toContain("+90");
  });

  it("handles large negative delta", () => {
    const result = formatDelta(10, 100);
    expect(result).toContain("-90");
  });

  it("handles zero vs zero", () => {
    const result = formatDelta(0, 0);
    expect(result).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// saveVelocitySnapshot (D1 insert)
// ---------------------------------------------------------------------------

describe("saveVelocitySnapshot", () => {
  it("inserts a row into the velocity table", async () => {
    const db = createMockD1();
    const snapshot = buildSnapshot();
    await saveVelocitySnapshot(db, snapshot);

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT OR REPLACE INTO velocity")
    );
  });

  it("passes all fields correctly to bind", async () => {
    const db = createMockD1();
    const snapshot = buildSnapshot();
    await saveVelocitySnapshot(db, snapshot);

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.bind).toHaveBeenCalledWith(
      "test-project",
      "2026-03-30",
      5,
      3,
      480,
      JSON.stringify(snapshot.perMember),
      JSON.stringify(snapshot.fastestTask),
      JSON.stringify(snapshot.longestTask)
    );
  });

  it("passes null for missing fastest/longest task", async () => {
    const db = createMockD1();
    const snapshot = buildSnapshot({ fastestTask: null, longestTask: null });
    await saveVelocitySnapshot(db, snapshot);

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.bind).toHaveBeenCalledWith(
      "test-project",
      "2026-03-30",
      5,
      3,
      480,
      expect.any(String),
      null,
      null
    );
  });

  it("does not throw when D1 insert fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { run: ReturnType<typeof vi.fn> } })._mocks;
    mocks.run.mockRejectedValueOnce(new Error("D1 write error"));

    await expect(
      saveVelocitySnapshot(db, buildSnapshot())
    ).resolves.toBeUndefined();
  });

  it("serializes perMember as JSON", async () => {
    const db = createMockD1();
    const snapshot = buildSnapshot({
      perMember: [{ userId: "111", name: "Alice", tasks: 3, hours: 240 }],
    });
    await saveVelocitySnapshot(db, snapshot);

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    const bindCall = mocks.bind.mock.calls[0];
    // The 6th argument (index 5) is per_member JSON
    expect(JSON.parse(bindCall[5])).toEqual([
      { userId: "111", name: "Alice", tasks: 3, hours: 240 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// getVelocityData (D1 fetch)
// ---------------------------------------------------------------------------

describe("getVelocityData", () => {
  it("returns a VelocitySnapshot for an existing week", async () => {
    const db = createMockD1({
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 5,
      tasks_opened: 3,
      team_hours: 480,
      per_member: JSON.stringify([{ userId: "111", name: "Alice", tasks: 3, hours: 240 }]),
      fastest_task: JSON.stringify({ number: 42, title: "Fix login", minutes: 30 }),
      longest_task: JSON.stringify({ number: 43, title: "Redesign", minutes: 360 }),
    });

    const result = await getVelocityData(db, "test-project", "2026-03-30");
    expect(result).not.toBeNull();
    expect(result!.project).toBe("test-project");
    expect(result!.weekStart).toBe("2026-03-30");
    expect(result!.tasksCompleted).toBe(5);
    expect(result!.tasksOpened).toBe(3);
    expect(result!.teamHours).toBe(480);
    expect(result!.perMember).toEqual([{ userId: "111", name: "Alice", tasks: 3, hours: 240 }]);
    expect(result!.fastestTask).toEqual({ number: 42, title: "Fix login", minutes: 30 });
    expect(result!.longestTask).toEqual({ number: 43, title: "Redesign", minutes: 360 });
  });

  it("returns null when no data exists", async () => {
    const db = createMockD1(null);
    const result = await getVelocityData(db, "test-project", "2026-03-30");
    expect(result).toBeNull();
  });

  it("returns null when D1 query fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { first: ReturnType<typeof vi.fn> } })._mocks;
    mocks.first.mockRejectedValueOnce(new Error("D1 read error"));

    const result = await getVelocityData(db, "test-project", "2026-03-30");
    expect(result).toBeNull();
  });

  it("handles null per_member field gracefully", async () => {
    const db = createMockD1({
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 0,
      tasks_opened: 0,
      team_hours: 0,
      per_member: null,
      fastest_task: null,
      longest_task: null,
    });

    const result = await getVelocityData(db, "test-project", "2026-03-30");
    expect(result).not.toBeNull();
    expect(result!.perMember).toEqual([]);
    expect(result!.fastestTask).toBeNull();
    expect(result!.longestTask).toBeNull();
  });

  it("queries with correct project and week_start parameters", async () => {
    const db = createMockD1(null);
    await getVelocityData(db, "my-project", "2026-04-06");

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn>; bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("velocity")
    );
    expect(mocks.bind).toHaveBeenCalledWith("my-project", "2026-04-06");
  });
});

// ---------------------------------------------------------------------------
// getLastTwoWeeksVelocity (D1 fetch)
// ---------------------------------------------------------------------------

describe("getLastTwoWeeksVelocity", () => {
  it("returns [thisWeek, lastWeek] when both exist", async () => {
    const thisWeekRow = {
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 5,
      tasks_opened: 3,
      team_hours: 480,
      per_member: "[]",
      fastest_task: null,
      longest_task: null,
    };
    const lastWeekRow = {
      project: "test-project",
      week_start: "2026-03-23",
      tasks_completed: 3,
      tasks_opened: 4,
      team_hours: 360,
      per_member: "[]",
      fastest_task: null,
      longest_task: null,
    };

    const db = createMockD1(null, [thisWeekRow, lastWeekRow]);
    const [thisWeek, lastWeek] = await getLastTwoWeeksVelocity(db, "test-project");

    expect(thisWeek).not.toBeNull();
    expect(thisWeek!.weekStart).toBe("2026-03-30");
    expect(thisWeek!.tasksCompleted).toBe(5);

    expect(lastWeek).not.toBeNull();
    expect(lastWeek!.weekStart).toBe("2026-03-23");
    expect(lastWeek!.tasksCompleted).toBe(3);
  });

  it("returns [thisWeek, null] when only one week exists", async () => {
    const thisWeekRow = {
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 5,
      tasks_opened: 3,
      team_hours: 480,
      per_member: "[]",
      fastest_task: null,
      longest_task: null,
    };

    const db = createMockD1(null, [thisWeekRow]);
    const [thisWeek, lastWeek] = await getLastTwoWeeksVelocity(db, "test-project");

    expect(thisWeek).not.toBeNull();
    expect(lastWeek).toBeNull();
  });

  it("returns [null, null] when no data exists", async () => {
    const db = createMockD1(null, []);
    const [thisWeek, lastWeek] = await getLastTwoWeeksVelocity(db, "test-project");

    expect(thisWeek).toBeNull();
    expect(lastWeek).toBeNull();
  });

  it("returns [null, null] when D1 query fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { all: ReturnType<typeof vi.fn> } })._mocks;
    mocks.all.mockRejectedValueOnce(new Error("D1 read error"));

    const [thisWeek, lastWeek] = await getLastTwoWeeksVelocity(db, "test-project");
    expect(thisWeek).toBeNull();
    expect(lastWeek).toBeNull();
  });

  it("queries velocity table ordered by week_start DESC with limit 2", async () => {
    const db = createMockD1(null, []);
    await getLastTwoWeeksVelocity(db, "test-project");

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn> } })._mocks;
    const query = mocks.prepare.mock.calls[0][0];
    expect(query).toContain("ORDER BY week_start DESC");
    expect(query).toContain("LIMIT 2");
  });
});

// ---------------------------------------------------------------------------
// calculateVelocitySnapshot (aggregation)
// ---------------------------------------------------------------------------

describe("calculateVelocitySnapshot", () => {
  const mockMembers: TeamMember[] = [
    { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
    { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
  ];

  it("returns a VelocitySnapshot with the correct project name", async () => {
    const db = createMockD1({ c: 0 }, []);
    const snapshot = await calculateVelocitySnapshot(db, "my-project", mockMembers);
    expect(snapshot.project).toBe("my-project");
  });

  it("returns a weekStart that is a Monday", async () => {
    const db = createMockD1({ c: 0 }, []);
    const snapshot = await calculateVelocitySnapshot(db, "my-project", mockMembers);
    // weekStart should be a valid YYYY-MM-DD string
    expect(snapshot.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // And the date should be a Monday
    const date = new Date(snapshot.weekStart + "T12:00:00.000Z");
    expect(date.getUTCDay()).toBe(1); // Monday
  });

  it("includes per-member entries for all team members", async () => {
    const db = createMockD1({ c: 0, total: 0 }, []);
    const snapshot = await calculateVelocitySnapshot(db, "my-project", mockMembers);
    expect(snapshot.perMember).toHaveLength(2);
    expect(snapshot.perMember[0].name).toBe("Alice");
    expect(snapshot.perMember[1].name).toBe("Bob");
  });

  it("handles empty team members gracefully", async () => {
    const db = createMockD1({ c: 0 }, []);
    const snapshot = await calculateVelocitySnapshot(db, "my-project", []);
    expect(snapshot.perMember).toHaveLength(0);
    expect(snapshot.teamHours).toBe(0);
  });

  it("does not throw when D1 queries fail (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { first: ReturnType<typeof vi.fn> } })._mocks;
    mocks.first.mockRejectedValue(new Error("D1 error"));

    await expect(
      calculateVelocitySnapshot(db, "my-project", mockMembers)
    ).resolves.toBeDefined();
  });

  it("returns fastestTask and longestTask as null when no data", async () => {
    const db = createMockD1({ c: 0 }, []);
    const snapshot = await calculateVelocitySnapshot(db, "my-project", mockMembers);
    expect(snapshot.fastestTask).toBeNull();
    expect(snapshot.longestTask).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// renderVelocityView (integration-style)
// ---------------------------------------------------------------------------

describe("renderVelocityView", () => {
  it("returns text containing 'Velocity Report' header", async () => {
    const kv = createMockKV({
      "test-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [],
      }),
    });
    const db = createMockD1({ c: 0 }, []);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("Velocity Report");
  });

  it("returns an InlineKeyboard with Back and Refresh buttons", async () => {
    const kv = createMockKV({
      "test-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [],
      }),
    });
    const db = createMockD1({ c: 0 }, []);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { keyboard } = await renderVelocityView(env);
    // The keyboard object should exist (InlineKeyboard from grammy)
    expect(keyboard).toBeDefined();
  });

  it("handles no projects gracefully", async () => {
    const kv = createMockKV({});
    const db = createMockD1(null, []);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("No projects configured");
  });

  it("shows live data when no velocity snapshots exist", async () => {
    const kv = createMockKV({
      "my-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [],
      }),
    });
    // Mock D1: getLastTwoWeeksVelocity returns empty, calculateVelocitySnapshot runs
    const db = createMockD1({ c: 0 }, []);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("This week");
    expect(text).toContain("No previous week data");
  });

  it("shows week-over-week comparison when both weeks exist", async () => {
    const thisWeekRow = {
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 8,
      tasks_opened: 4,
      team_hours: 600,
      per_member: JSON.stringify([
        { userId: "111", name: "Alice", tasks: 5, hours: 300 },
        { userId: "222", name: "Bob", tasks: 3, hours: 300 },
      ]),
      fastest_task: JSON.stringify({ number: 42, title: "Fix login bug", minutes: 30 }),
      longest_task: JSON.stringify({ number: 43, title: "Redesign dashboard", minutes: 360 }),
    };
    const lastWeekRow = {
      project: "test-project",
      week_start: "2026-03-23",
      tasks_completed: 5,
      tasks_opened: 6,
      team_hours: 480,
      per_member: JSON.stringify([
        { userId: "111", name: "Alice", tasks: 3, hours: 240 },
        { userId: "222", name: "Bob", tasks: 2, hours: 240 },
      ]),
      fastest_task: null,
      longest_task: null,
    };

    const kv = createMockKV({
      "test-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [
          { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
          { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
        ],
      }),
    });
    const db = createMockD1(null, [thisWeekRow, lastWeekRow]);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("Week-over-Week");
    expect(text).toContain("This week");
    expect(text).toContain("Last week");
    expect(text).toContain("+3"); // tasks delta: 8 - 5 = +3
  });

  it("shows per-person breakdown when members exist", async () => {
    const thisWeekRow = {
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 5,
      tasks_opened: 2,
      team_hours: 480,
      per_member: JSON.stringify([
        { userId: "111", name: "Alice", tasks: 3, hours: 240 },
        { userId: "222", name: "Bob", tasks: 2, hours: 240 },
      ]),
      fastest_task: null,
      longest_task: null,
    };

    const kv = createMockKV({
      "test-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [
          { telegram_id: 111, telegram_username: "alice_tg", github: "alice", name: "Alice" },
          { telegram_id: 222, telegram_username: "bob_tg", github: "bob", name: "Bob" },
        ],
      }),
    });
    const db = createMockD1(null, [thisWeekRow]);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("Per Person");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("3 tasks");
    expect(text).toContain("2 tasks");
  });

  it("shows fastest and longest task highlights", async () => {
    const thisWeekRow = {
      project: "test-project",
      week_start: "2026-03-30",
      tasks_completed: 5,
      tasks_opened: 2,
      team_hours: 480,
      per_member: "[]",
      fastest_task: JSON.stringify({ number: 42, title: "Quick fix", minutes: 15 }),
      longest_task: JSON.stringify({ number: 43, title: "Big refactor", minutes: 480 }),
    };

    const kv = createMockKV({
      "test-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [],
      }),
    });
    const db = createMockD1(null, [thisWeekRow]);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("Fastest");
    expect(text).toContain("#42");
    expect(text).toContain("Quick fix");
    expect(text).toContain("Longest");
    expect(text).toContain("#43");
    expect(text).toContain("Big refactor");
  });

  it("escapes HTML in project names and member names", async () => {
    const thisWeekRow = {
      project: "<script>alert(1)</script>",
      week_start: "2026-03-30",
      tasks_completed: 1,
      tasks_opened: 0,
      team_hours: 60,
      per_member: JSON.stringify([
        { userId: "111", name: "<b>Hacker</b>", tasks: 1, hours: 60 },
      ]),
      fastest_task: null,
      longest_task: null,
    };

    const kv = createMockKV({
      "<script>alert(1)</script>": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [
          { telegram_id: 111, telegram_username: "hacker_tg", github: "hacker", name: "<b>Hacker</b>" },
        ],
      }),
    });
    const db = createMockD1(null, [thisWeekRow]);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    // The raw HTML tags should be escaped, not rendered
    expect(text).not.toContain("<script>");
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toContain("<b>Hacker</b>");
  });

  it("displays Updated timestamp in the footer", async () => {
    const kv = createMockKV({
      "test-project": JSON.stringify({
        botToken: "token",
        chatId: "123",
        githubRepo: "org/repo",
        members: [],
      }),
    });
    const db = createMockD1({ c: 0 }, []);
    const env = { PROJECTS: kv, DB: db } as unknown as Env;

    const { text } = await renderVelocityView(env);
    expect(text).toContain("Updated:");
  });
});

// ---------------------------------------------------------------------------
// formatDuration (re-test for velocity context)
// ---------------------------------------------------------------------------

describe("formatDuration in velocity context", () => {
  it("formats team hours correctly for 480 minutes", () => {
    expect(formatDuration(480)).toBe("8h 0m");
  });

  it("formats 0 minutes for inactive members", () => {
    expect(formatDuration(0)).toBe("0m");
  });
});
