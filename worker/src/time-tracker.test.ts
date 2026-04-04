/**
 * Time Tracker — Unit Tests (Issue #60)
 *
 * Tests the time-tracking feature that automatically records how long team
 * members spend working on their claimed categories.
 *
 * Covers:
 * - getTimer / startTimer / stopTimer (KV timer state round-trip)
 * - logTimeEntry (D1 insert for completed sessions)
 * - getDailyHours / getWeeklyHours (D1 aggregation queries)
 * - formatDuration (human-readable duration formatting)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTimer,
  startTimer,
  stopTimer,
  logTimeEntry,
  getDailyHours,
  getWeeklyHours,
  formatDuration,
} from "./index";
import type { TimerState } from "./index";

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

/**
 * Creates a mock D1Database that tracks calls to prepare/bind/run/first.
 * The `firstResult` parameter controls what `.first()` returns — useful
 * for testing getDailyHours and getWeeklyHours.
 */
function createMockD1(
  firstResult: Record<string, unknown> | null = null
): D1Database {
  const runFn = vi.fn().mockResolvedValue({ success: true });
  const firstFn = vi.fn().mockResolvedValue(firstResult);
  const bindFn = vi.fn().mockReturnValue({ run: runFn, first: firstFn });
  const prepareFn = vi.fn().mockReturnValue({ bind: bindFn, run: runFn, first: firstFn });

  return {
    prepare: prepareFn,
    _mocks: { prepare: prepareFn, bind: bindFn, run: runFn, first: firstFn },
  } as unknown as D1Database & {
    _mocks: { prepare: typeof prepareFn; bind: typeof bindFn; run: typeof runFn; first: typeof firstFn };
  };
}

// ---------------------------------------------------------------------------
// getTimer
// ---------------------------------------------------------------------------

describe("getTimer", () => {
  it("returns null when no timer exists", async () => {
    const kv = createMockKV();
    const result = await getTimer(kv, 12345, "project-a");
    expect(result).toBeNull();
  });

  it("returns the stored timer state", async () => {
    const timerState: TimerState = {
      category: "area:frontend",
      startedAt: "2026-04-03T10:00:00.000Z",
    };
    const kv = createMockKV({
      "timer:12345:project-a": JSON.stringify(timerState),
    });

    const result = await getTimer(kv, 12345, "project-a");
    expect(result).toEqual(timerState);
  });

  it("uses correct KV key format timer:{telegramId}:{projectId}", async () => {
    const kv = createMockKV();
    await getTimer(kv, 99999, "my-project");
    expect(kv.get).toHaveBeenCalledWith("timer:99999:my-project");
  });

  it("returns null for corrupted JSON in KV", async () => {
    const kv = createMockKV({
      "timer:12345:project-a": "not valid json {{{",
    });
    const result = await getTimer(kv, 12345, "project-a");
    expect(result).toBeNull();
  });

  it("does not mix up timers between different users", async () => {
    const timer1: TimerState = { category: "area:frontend", startedAt: "2026-04-03T10:00:00.000Z" };
    const timer2: TimerState = { category: "area:backend", startedAt: "2026-04-03T11:00:00.000Z" };
    const kv = createMockKV({
      "timer:111:project-a": JSON.stringify(timer1),
      "timer:222:project-a": JSON.stringify(timer2),
    });

    const result1 = await getTimer(kv, 111, "project-a");
    const result2 = await getTimer(kv, 222, "project-a");
    expect(result1).toEqual(timer1);
    expect(result2).toEqual(timer2);
  });

  it("does not mix up timers between different projects", async () => {
    const timer1: TimerState = { category: "area:frontend", startedAt: "2026-04-03T10:00:00.000Z" };
    const kv = createMockKV({
      "timer:12345:project-a": JSON.stringify(timer1),
    });

    const resultA = await getTimer(kv, 12345, "project-a");
    const resultB = await getTimer(kv, 12345, "project-b");
    expect(resultA).toEqual(timer1);
    expect(resultB).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// startTimer
// ---------------------------------------------------------------------------

describe("startTimer", () => {
  it("stores a timer state in KV", async () => {
    const kv = createMockKV();
    await startTimer(kv, 12345, "project-a", "area:frontend");

    const result = await getTimer(kv, 12345, "project-a");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("area:frontend");
  });

  it("stores a valid ISO timestamp as startedAt", async () => {
    const kv = createMockKV();
    const before = new Date().toISOString();
    await startTimer(kv, 12345, "project-a", "area:frontend");
    const after = new Date().toISOString();

    const result = await getTimer(kv, 12345, "project-a");
    expect(result).not.toBeNull();
    // startedAt should be between before and after
    expect(result!.startedAt >= before).toBe(true);
    expect(result!.startedAt <= after).toBe(true);
  });

  it("writes to the correct KV key", async () => {
    const kv = createMockKV();
    await startTimer(kv, 77777, "cool-project", "area:backend");

    expect(kv.put).toHaveBeenCalledWith(
      "timer:77777:cool-project",
      expect.any(String)
    );
  });

  it("overwrites an existing timer for the same user+project", async () => {
    const kv = createMockKV({
      "timer:12345:project-a": JSON.stringify({
        category: "area:old",
        startedAt: "2026-04-01T00:00:00.000Z",
      }),
    });

    await startTimer(kv, 12345, "project-a", "area:new");
    const result = await getTimer(kv, 12345, "project-a");
    expect(result!.category).toBe("area:new");
  });
});

// ---------------------------------------------------------------------------
// stopTimer
// ---------------------------------------------------------------------------

describe("stopTimer", () => {
  it("returns null when no timer is running", async () => {
    const kv = createMockKV();
    const result = await stopTimer(kv, 12345, "project-a");
    expect(result).toBeNull();
  });

  it("returns the timer state and removes it from KV", async () => {
    const timerState: TimerState = {
      category: "area:frontend",
      startedAt: "2026-04-03T10:00:00.000Z",
    };
    const kv = createMockKV({
      "timer:12345:project-a": JSON.stringify(timerState),
    });

    const result = await stopTimer(kv, 12345, "project-a");
    expect(result).toEqual(timerState);

    // Timer should be gone from KV now
    const afterStop = await getTimer(kv, 12345, "project-a");
    expect(afterStop).toBeNull();
  });

  it("calls KV delete with the correct key", async () => {
    const kv = createMockKV({
      "timer:12345:project-a": JSON.stringify({
        category: "area:frontend",
        startedAt: "2026-04-03T10:00:00.000Z",
      }),
    });

    await stopTimer(kv, 12345, "project-a");
    expect(kv.delete).toHaveBeenCalledWith("timer:12345:project-a");
  });

  it("does not affect other users' timers", async () => {
    const timer1: TimerState = { category: "area:frontend", startedAt: "2026-04-03T10:00:00.000Z" };
    const timer2: TimerState = { category: "area:backend", startedAt: "2026-04-03T11:00:00.000Z" };
    const kv = createMockKV({
      "timer:111:project-a": JSON.stringify(timer1),
      "timer:222:project-a": JSON.stringify(timer2),
    });

    await stopTimer(kv, 111, "project-a");

    // User 111's timer is gone
    const result1 = await getTimer(kv, 111, "project-a");
    expect(result1).toBeNull();

    // User 222's timer is untouched
    const result2 = await getTimer(kv, 222, "project-a");
    expect(result2).toEqual(timer2);
  });

  it("full round-trip: start -> get -> stop -> get returns null", async () => {
    const kv = createMockKV();

    await startTimer(kv, 12345, "project-a", "area:frontend");
    const running = await getTimer(kv, 12345, "project-a");
    expect(running).not.toBeNull();
    expect(running!.category).toBe("area:frontend");

    const stopped = await stopTimer(kv, 12345, "project-a");
    expect(stopped).not.toBeNull();
    expect(stopped!.category).toBe("area:frontend");

    const afterStop = await getTimer(kv, 12345, "project-a");
    expect(afterStop).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// logTimeEntry (D1 insert)
// ---------------------------------------------------------------------------

describe("logTimeEntry", () => {
  it("inserts a row into the time_logs table", async () => {
    const db = createMockD1();
    await logTimeEntry(db, {
      userId: 12345,
      project: "project-a",
      category: "area:frontend",
      startedAt: "2026-04-03T10:00:00.000Z",
      endedAt: "2026-04-03T11:30:00.000Z",
      durationMinutes: 90,
      tasksCompleted: 3,
    });

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO time_logs")
    );
  });

  it("passes all fields to the bind call", async () => {
    const db = createMockD1();
    await logTimeEntry(db, {
      userId: 12345,
      project: "project-a",
      category: "area:frontend",
      startedAt: "2026-04-03T10:00:00.000Z",
      endedAt: "2026-04-03T11:30:00.000Z",
      durationMinutes: 90,
      tasksCompleted: 3,
    });

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.bind).toHaveBeenCalledWith(
      "12345",         // userId converted to string
      "project-a",
      "area:frontend",
      "2026-04-03T10:00:00.000Z",
      "2026-04-03T11:30:00.000Z",
      90,
      3
    );
  });

  it("does not throw when D1 insert fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { run: ReturnType<typeof vi.fn> } })._mocks;
    mocks.run.mockRejectedValueOnce(new Error("D1 write error"));

    // Should not throw
    await expect(
      logTimeEntry(db, {
        userId: 12345,
        project: "project-a",
        category: "area:frontend",
        startedAt: "2026-04-03T10:00:00.000Z",
        endedAt: "2026-04-03T11:30:00.000Z",
        durationMinutes: 90,
        tasksCompleted: 3,
      })
    ).resolves.toBeUndefined();
  });

  it("converts userId to string for storage", async () => {
    const db = createMockD1();
    await logTimeEntry(db, {
      userId: 99999,
      project: "project-b",
      category: "area:backend",
      startedAt: "2026-04-03T08:00:00.000Z",
      endedAt: "2026-04-03T09:00:00.000Z",
      durationMinutes: 60,
      tasksCompleted: 1,
    });

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    // First argument should be string "99999", not number 99999
    expect(mocks.bind).toHaveBeenCalledWith(
      "99999",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("handles zero duration and zero tasks completed", async () => {
    const db = createMockD1();
    await logTimeEntry(db, {
      userId: 12345,
      project: "project-a",
      category: "area:frontend",
      startedAt: "2026-04-03T10:00:00.000Z",
      endedAt: "2026-04-03T10:00:00.000Z",
      durationMinutes: 0,
      tasksCompleted: 0,
    });

    const mocks = (db as unknown as { _mocks: { bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.bind).toHaveBeenCalledWith(
      "12345",
      "project-a",
      "area:frontend",
      "2026-04-03T10:00:00.000Z",
      "2026-04-03T10:00:00.000Z",
      0,
      0
    );
  });
});

// ---------------------------------------------------------------------------
// getDailyHours (D1 aggregation)
// ---------------------------------------------------------------------------

describe("getDailyHours", () => {
  it("returns total minutes for a user on a given date", async () => {
    const db = createMockD1({ total: 120 });
    const result = await getDailyHours(db, 12345, "2026-04-03");
    expect(result).toBe(120);
  });

  it("returns 0 when no entries exist (null result)", async () => {
    const db = createMockD1(null);
    const result = await getDailyHours(db, 12345, "2026-04-03");
    expect(result).toBe(0);
  });

  it("returns 0 when total is 0", async () => {
    const db = createMockD1({ total: 0 });
    const result = await getDailyHours(db, 12345, "2026-04-03");
    expect(result).toBe(0);
  });

  it("queries the time_logs table with correct parameters", async () => {
    const db = createMockD1({ total: 45 });
    await getDailyHours(db, 12345, "2026-04-03");

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn>; bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("time_logs")
    );
    expect(mocks.bind).toHaveBeenCalledWith("12345", "2026-04-03");
  });

  it("returns 0 when D1 query fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { first: ReturnType<typeof vi.fn> } })._mocks;
    mocks.first.mockRejectedValueOnce(new Error("D1 read error"));

    const result = await getDailyHours(db, 12345, "2026-04-03");
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getWeeklyHours (D1 aggregation)
// ---------------------------------------------------------------------------

describe("getWeeklyHours", () => {
  it("returns total minutes for a user from a week start date", async () => {
    const db = createMockD1({ total: 480 });
    const result = await getWeeklyHours(db, 12345, "2026-03-30");
    expect(result).toBe(480);
  });

  it("returns 0 when no entries exist (null result)", async () => {
    const db = createMockD1(null);
    const result = await getWeeklyHours(db, 12345, "2026-03-30");
    expect(result).toBe(0);
  });

  it("returns 0 when total is 0", async () => {
    const db = createMockD1({ total: 0 });
    const result = await getWeeklyHours(db, 12345, "2026-03-30");
    expect(result).toBe(0);
  });

  it("queries with correct week-range parameters", async () => {
    const db = createMockD1({ total: 300 });
    await getWeeklyHours(db, 12345, "2026-03-30");

    const mocks = (db as unknown as { _mocks: { prepare: ReturnType<typeof vi.fn>; bind: ReturnType<typeof vi.fn> } })._mocks;
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.stringContaining("time_logs")
    );
    // Should bind userId, weekStart, weekStart (the +7 days calc is in SQL)
    expect(mocks.bind).toHaveBeenCalledWith("12345", "2026-03-30", "2026-03-30");
  });

  it("returns 0 when D1 query fails (best-effort)", async () => {
    const db = createMockD1();
    const mocks = (db as unknown as { _mocks: { first: ReturnType<typeof vi.fn> } })._mocks;
    mocks.first.mockRejectedValueOnce(new Error("D1 read error"));

    const result = await getWeeklyHours(db, 12345, "2026-03-30");
    expect(result).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("formats 0 minutes as '0m'", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats 1 minute as '1m'", () => {
    expect(formatDuration(1)).toBe("1m");
  });

  it("formats 30 minutes as '30m'", () => {
    expect(formatDuration(30)).toBe("30m");
  });

  it("formats 45 minutes as '45m'", () => {
    expect(formatDuration(45)).toBe("45m");
  });

  it("formats 59 minutes as '59m' (just under 1 hour)", () => {
    expect(formatDuration(59)).toBe("59m");
  });

  it("formats 60 minutes as '1h 0m'", () => {
    expect(formatDuration(60)).toBe("1h 0m");
  });

  it("formats 90 minutes as '1h 30m'", () => {
    expect(formatDuration(90)).toBe("1h 30m");
  });

  it("formats 120 minutes as '2h 0m'", () => {
    expect(formatDuration(120)).toBe("2h 0m");
  });

  it("formats 150 minutes as '2h 30m'", () => {
    expect(formatDuration(150)).toBe("2h 30m");
  });

  it("formats 480 minutes as '8h 0m' (full work day)", () => {
    expect(formatDuration(480)).toBe("8h 0m");
  });

  it("formats 61 minutes as '1h 1m'", () => {
    expect(formatDuration(61)).toBe("1h 1m");
  });

  it("formats large values like 1440 minutes as '24h 0m'", () => {
    expect(formatDuration(1440)).toBe("24h 0m");
  });
});
