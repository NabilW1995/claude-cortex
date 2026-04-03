/**
 * Conflict Detector — Unit Tests (Issue #58)
 *
 * Tests the file-level conflict detection system that warns team members
 * via Telegram DM when two people edit the same file in the same project.
 *
 * Covers:
 * - saveChangedFiles / getChangedFiles (KV storage round-trip)
 * - hasConflictWarning / setConflictWarning (dedup key logic)
 * - detectFileConflicts (main orchestration with DM sending)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  saveChangedFiles,
  getChangedFiles,
  hasConflictWarning,
  setConflictWarning,
  detectFileConflicts,
  getTeamMembers,
  getUserPreferences,
  saveUserPreferences,
  isUserDND,
  escapeHtml,
} from "./index";
import type { Env, ProjectConfig, TeamMember, UserPreferences } from "./index";

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

function makeProjectConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    botToken: "test-bot-token",
    chatId: "-100123",
    githubRepo: "test/repo",
    members: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper to build a mock Env with pre-seeded KV data
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
// Standard team members used across tests
// ---------------------------------------------------------------------------

const MEMBER_ALICE: TeamMember = {
  telegram_id: 111,
  telegram_username: "alice_dev",
  github: "alice",
  name: "Alice",
};

const MEMBER_BOB: TeamMember = {
  telegram_id: 222,
  telegram_username: "bob_dev",
  github: "bob",
  name: "Bob",
};

const MEMBER_CHARLIE: TeamMember = {
  telegram_id: 333,
  telegram_username: "charlie_dev",
  github: "charlie",
  name: "Charlie",
};

// ---------------------------------------------------------------------------
// Fetch spy — intercepts Telegram API calls
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

// =========================================================================
// 1. saveChangedFiles / getChangedFiles — KV round-trip
// =========================================================================

describe("saveChangedFiles / getChangedFiles", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("stores and retrieves a list of changed files", async () => {
    const files = ["src/index.ts", "src/utils.ts", "package.json"];
    await saveChangedFiles(kv, "my-project", 111, files);
    const result = await getChangedFiles(kv, "my-project", 111);
    expect(result).toEqual(files);
  });

  it("uses the correct KV key format: files:{projectId}:{telegramId}", async () => {
    await saveChangedFiles(kv, "my-project", 111, ["file.ts"]);
    expect(kv.put).toHaveBeenCalledWith(
      "files:my-project:111",
      JSON.stringify(["file.ts"]),
      { expirationTtl: 7200 }
    );
  });

  it("sets a 2-hour TTL on the stored data", async () => {
    await saveChangedFiles(kv, "proj", 999, ["a.ts"]);
    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { expirationTtl: 7200 }
    );
  });

  it("returns an empty array when no data exists for the user", async () => {
    const result = await getChangedFiles(kv, "my-project", 999);
    expect(result).toEqual([]);
  });

  it("returns an empty array when the project has no stored files", async () => {
    const result = await getChangedFiles(kv, "nonexistent-project", 111);
    expect(result).toEqual([]);
  });

  it("stores files separately per user in the same project", async () => {
    await saveChangedFiles(kv, "proj", 111, ["src/auth.ts"]);
    await saveChangedFiles(kv, "proj", 222, ["src/dashboard.ts"]);

    const aliceFiles = await getChangedFiles(kv, "proj", 111);
    const bobFiles = await getChangedFiles(kv, "proj", 222);

    expect(aliceFiles).toEqual(["src/auth.ts"]);
    expect(bobFiles).toEqual(["src/dashboard.ts"]);
  });

  it("stores files separately per project for the same user", async () => {
    await saveChangedFiles(kv, "project-a", 111, ["src/a.ts"]);
    await saveChangedFiles(kv, "project-b", 111, ["src/b.ts"]);

    const filesA = await getChangedFiles(kv, "project-a", 111);
    const filesB = await getChangedFiles(kv, "project-b", 111);

    expect(filesA).toEqual(["src/a.ts"]);
    expect(filesB).toEqual(["src/b.ts"]);
  });

  it("overwrites previous files when saved again", async () => {
    await saveChangedFiles(kv, "proj", 111, ["old-file.ts"]);
    await saveChangedFiles(kv, "proj", 111, ["new-file.ts"]);

    const result = await getChangedFiles(kv, "proj", 111);
    expect(result).toEqual(["new-file.ts"]);
  });

  it("handles an empty file list", async () => {
    await saveChangedFiles(kv, "proj", 111, []);
    const result = await getChangedFiles(kv, "proj", 111);
    expect(result).toEqual([]);
  });
});

// =========================================================================
// 2. hasConflictWarning / setConflictWarning — dedup logic
// =========================================================================

describe("hasConflictWarning / setConflictWarning", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns false when no warning has been set", async () => {
    const result = await hasConflictWarning(kv, "proj", 111, 222, "src/index.ts");
    expect(result).toBe(false);
  });

  it("returns true after a warning has been set", async () => {
    await setConflictWarning(kv, "proj", 111, 222, "src/index.ts");
    const result = await hasConflictWarning(kv, "proj", 111, 222, "src/index.ts");
    expect(result).toBe(true);
  });

  it("uses sorted user pair so A,B === B,A (dedup symmetry)", async () => {
    // Set warning with user order (222, 111)
    await setConflictWarning(kv, "proj", 222, 111, "src/file.ts");
    // Check with reversed order (111, 222) — should still find it
    const result = await hasConflictWarning(kv, "proj", 111, 222, "src/file.ts");
    expect(result).toBe(true);
  });

  it("uses the correct KV key format with sorted user pair", async () => {
    await setConflictWarning(kv, "proj", 222, 111, "src/file.ts");
    // Sorted pair: [111, 222] -> "111_222"
    expect(kv.put).toHaveBeenCalledWith(
      "conflict_warn:proj:111_222:src/file.ts",
      "1",
      { expirationTtl: 3600 }
    );
  });

  it("sets a 1-hour TTL on the dedup key", async () => {
    await setConflictWarning(kv, "proj", 111, 222, "file.ts");
    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      "1",
      { expirationTtl: 3600 }
    );
  });

  it("tracks warnings per file independently", async () => {
    await setConflictWarning(kv, "proj", 111, 222, "src/a.ts");

    expect(await hasConflictWarning(kv, "proj", 111, 222, "src/a.ts")).toBe(true);
    expect(await hasConflictWarning(kv, "proj", 111, 222, "src/b.ts")).toBe(false);
  });

  it("tracks warnings per project independently", async () => {
    await setConflictWarning(kv, "project-a", 111, 222, "file.ts");

    expect(await hasConflictWarning(kv, "project-a", 111, 222, "file.ts")).toBe(true);
    expect(await hasConflictWarning(kv, "project-b", 111, 222, "file.ts")).toBe(false);
  });

  it("tracks warnings per user pair independently", async () => {
    await setConflictWarning(kv, "proj", 111, 222, "file.ts");

    expect(await hasConflictWarning(kv, "proj", 111, 222, "file.ts")).toBe(true);
    expect(await hasConflictWarning(kv, "proj", 111, 333, "file.ts")).toBe(false);
  });
});

// =========================================================================
// 3. detectFileConflicts — main orchestration
// =========================================================================

describe("detectFileConflicts", () => {
  /**
   * Helper to set up a fully-wired test environment with team members,
   * user preferences (DM chat IDs), and pre-stored file lists.
   */
  function setupConflictEnv(options: {
    members?: TeamMember[];
    memberFiles?: Record<number, string[]>;
    memberPrefs?: Record<number, Partial<UserPreferences>>;
    dndUsers?: number[];
    existingWarnings?: Array<{ userA: number; userB: number; file: string }>;
  }) {
    const members = options.members || [MEMBER_ALICE, MEMBER_BOB];

    // Build KV data: team-members + file lists + preferences + DND + warnings
    const kvData: Record<string, string> = {
      "team-members": JSON.stringify(members),
    };

    // Store file lists for each member
    if (options.memberFiles) {
      for (const [telegramId, files] of Object.entries(options.memberFiles)) {
        kvData[`files:my-project:${telegramId}`] = JSON.stringify(files);
      }
    }

    // Store user preferences (with dm_chat_id)
    for (const member of members) {
      const prefs: UserPreferences = {
        commits: false,
        previews: false,
        tasks: true,
        pr_reviews: false,
        sessions: false,
        dm_chat_id: member.telegram_id * 10, // e.g., 1110 for Alice (111)
        updated_at: new Date().toISOString(),
      };
      // Apply overrides
      if (options.memberPrefs?.[member.telegram_id]) {
        Object.assign(prefs, options.memberPrefs[member.telegram_id]);
      }
      kvData[`prefs:${member.telegram_id}`] = JSON.stringify(prefs);
    }

    // Set DND for specified users
    if (options.dndUsers) {
      for (const id of options.dndUsers) {
        kvData[`dnd:${id}`] = "1";
      }
    }

    // Set existing conflict warnings
    if (options.existingWarnings) {
      for (const w of options.existingWarnings) {
        const sorted = [w.userA, w.userB].sort((a, b) => a - b).join("_");
        kvData[`conflict_warn:my-project:${sorted}:${w.file}`] = "1";
      }
    }

    const env = createMockEnv({ "my-project": makeProjectConfig() }, kvData);
    return env;
  }

  it("sends DMs to both users when they edit the same file", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts", "src/utils.ts"], // Bob's files
      },
    });

    // Alice reports editing src/index.ts — overlaps with Bob
    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // Should have called fetch twice (one DM to Alice, one to Bob)
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify both calls are to sendMessage
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toContain("api.telegram.org/bottest-bot-token/sendMessage");
    }

    // Verify message content includes the conflict file
    const bodies = fetchSpy.mock.calls.map((call: [string, RequestInit?]) =>
      JSON.parse(call[1]?.body as string)
    );

    // One message to Alice (chat_id: 1110), one to Bob (chat_id: 2220)
    const chatIds = bodies.map((b: { chat_id: number }) => b.chat_id).sort();
    expect(chatIds).toEqual([1110, 2220]);

    // Both messages should mention the conflicting file
    for (const body of bodies) {
      expect(body.text).toContain("src/index.ts");
      expect(body.text).toContain("File Conflict Warning");
    }
  });

  it("sends no DMs when users edit different files", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/dashboard.ts"], // Bob edits dashboard
      },
    });

    // Alice edits auth — no overlap with Bob
    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/auth.ts"],
      "test-bot-token"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends no DMs when the conflict was already warned (throttled)", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
      existingWarnings: [
        { userA: 111, userB: 222, file: "src/index.ts" },
      ],
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // No DMs — warning already exists
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips DM for a user in DND mode", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
      dndUsers: [222], // Bob is in DND
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // Only 1 DM — to Alice (Bob is in DND)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.chat_id).toBe(1110); // Alice's DM chat
  });

  it("skips DM for both users when both are in DND", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
      dndUsers: [111, 222], // Both in DND
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips users with no dm_chat_id set", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
      memberPrefs: {
        222: { dm_chat_id: null }, // Bob has no DM chat
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // Only 1 DM — to Alice (Bob has no dm_chat_id)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.chat_id).toBe(1110);
  });

  it("does nothing when currentFiles is empty", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      [], // no files
      "test-bot-token"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the other user has no stored files", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      // No memberFiles — Bob has nothing stored
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips the current user when checking for conflicts", async () => {
    // Alice should NOT get compared against herself
    const env = setupConflictEnv({
      members: [MEMBER_ALICE],
      memberFiles: {
        111: ["src/index.ts"], // Alice's own stored files
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // No self-conflict DMs
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles multiple conflicting files in one detection", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts", "src/utils.ts", "src/types.ts"],
      },
    });

    // Alice edits 2 of the same files
    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts", "src/utils.ts", "src/unrelated.ts"],
      "test-bot-token"
    );

    // 2 DMs — one to Alice, one to Bob
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Both messages should mention BOTH conflicting files
    const bodies = fetchSpy.mock.calls.map((call: [string, RequestInit?]) =>
      JSON.parse(call[1]?.body as string)
    );
    for (const body of bodies) {
      expect(body.text).toContain("src/index.ts");
      expect(body.text).toContain("src/utils.ts");
      // Should NOT mention the non-overlapping file
      expect(body.text).not.toContain("src/unrelated.ts");
    }
  });

  it("warns only about new conflicts when some already have warnings", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/a.ts", "src/b.ts"],
      },
      existingWarnings: [
        { userA: 111, userB: 222, file: "src/a.ts" }, // Already warned
      ],
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/a.ts", "src/b.ts"],
      "test-bot-token"
    );

    // DMs sent, but only about src/b.ts (src/a.ts already warned)
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const bodies = fetchSpy.mock.calls.map((call: [string, RequestInit?]) =>
      JSON.parse(call[1]?.body as string)
    );
    for (const body of bodies) {
      expect(body.text).toContain("src/b.ts");
      expect(body.text).not.toContain("src/a.ts");
    }
  });

  it("detects conflicts across multiple team members", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB, MEMBER_CHARLIE],
      memberFiles: {
        222: ["src/shared.ts"],  // Bob edits shared.ts
        333: ["src/shared.ts"],  // Charlie also edits shared.ts
      },
    });

    // Alice also edits shared.ts — conflicts with both Bob and Charlie
    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/shared.ts"],
      "test-bot-token"
    );

    // 4 DMs total: (Alice about Bob) + (Bob about Alice) + (Alice about Charlie) + (Charlie about Alice)
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("users in different projects produce no false positives", async () => {
    // Bob has files stored for project-b, Alice checks project-a
    const kvData: Record<string, string> = {
      "team-members": JSON.stringify([MEMBER_ALICE, MEMBER_BOB]),
      "files:project-b:222": JSON.stringify(["src/index.ts"]), // Bob in project-b
      [`prefs:111`]: JSON.stringify({
        commits: false, previews: false, tasks: true,
        pr_reviews: false, sessions: false, dm_chat_id: 1110,
        updated_at: new Date().toISOString(),
      }),
      [`prefs:222`]: JSON.stringify({
        commits: false, previews: false, tasks: true,
        pr_reviews: false, sessions: false, dm_chat_id: 2220,
        updated_at: new Date().toISOString(),
      }),
    };
    const env = createMockEnv({ "project-a": makeProjectConfig() }, kvData);

    // Alice checks project-a — Bob's files are in project-b
    await detectFileConflicts(
      env,
      "project-a", // Different project than Bob's files
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles a team with no other members gracefully", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE], // Only Alice, no one else
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("clears dm_chat_id when sendDM returns 'blocked'", async () => {
    // Mock fetch to return 403 (blocked) for all requests
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 403 })
    );

    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // After blocked response, dm_chat_id should be set to null
    const alicePrefs = await getUserPreferences(env.PROJECTS, 111);
    expect(alicePrefs.dm_chat_id).toBeNull();
  });

  it("DM message includes correct project name (escaped)", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.text).toContain("my-project");
  });

  it("DM message mentions the other user's name", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // Message to Alice should mention Bob
    const aliceMsg = fetchSpy.mock.calls.find((call: [string, RequestInit?]) => {
      const body = JSON.parse(call[1]?.body as string);
      return body.chat_id === 1110;
    });
    expect(aliceMsg).toBeDefined();
    const aliceBody = JSON.parse(aliceMsg![1]?.body as string);
    expect(aliceBody.text).toContain("Bob");

    // Message to Bob should mention Alice
    const bobMsg = fetchSpy.mock.calls.find((call: [string, RequestInit?]) => {
      const body = JSON.parse(call[1]?.body as string);
      return body.chat_id === 2220;
    });
    expect(bobMsg).toBeDefined();
    const bobBody = JSON.parse(bobMsg![1]?.body as string);
    expect(bobBody.text).toContain("Alice");
  });

  it("sets throttle keys after sending conflict warnings", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    // Verify the conflict warning was set in KV (throttle for next time)
    const warned = await hasConflictWarning(env.PROJECTS, "my-project", 111, 222, "src/index.ts");
    expect(warned).toBe(true);
  });

  it("uses HTML parse mode in DM messages", async () => {
    const env = setupConflictEnv({
      members: [MEMBER_ALICE, MEMBER_BOB],
      memberFiles: {
        222: ["src/index.ts"],
      },
    });

    await detectFileConflicts(
      env,
      "my-project",
      "Alice",
      111,
      ["src/index.ts"],
      "test-bot-token"
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.parse_mode).toBe("HTML");
  });
});

// =========================================================================
// 4. isUserDND — DND status check (used by conflict detector)
// =========================================================================

describe("isUserDND", () => {
  it("returns false when no DND entry exists", async () => {
    const kv = createMockKV();
    const result = await isUserDND(kv, 111);
    expect(result).toBe(false);
  });

  it("returns true when a DND entry exists", async () => {
    const kv = createMockKV({ "dnd:111": "1" });
    const result = await isUserDND(kv, 111);
    expect(result).toBe(true);
  });

  it("checks the correct KV key format dnd:{telegramId}", async () => {
    const kv = createMockKV();
    await isUserDND(kv, 12345);
    expect(kv.get).toHaveBeenCalledWith("dnd:12345");
  });
});

// =========================================================================
// 5. Edge cases & robustness
// =========================================================================

describe("Conflict detector edge cases", () => {
  it("handles file paths with special characters", async () => {
    const kv = createMockKV();
    const specialFile = "src/components/Header (copy).tsx";
    await saveChangedFiles(kv, "proj", 111, [specialFile]);
    const result = await getChangedFiles(kv, "proj", 111);
    expect(result).toEqual([specialFile]);
  });

  it("handles deeply nested file paths", async () => {
    const kv = createMockKV();
    const deepFile = "src/features/auth/components/LoginForm/LoginForm.test.tsx";
    await saveChangedFiles(kv, "proj", 111, [deepFile]);
    const result = await getChangedFiles(kv, "proj", 111);
    expect(result).toEqual([deepFile]);
  });

  it("dedup key works with large telegram IDs", async () => {
    const kv = createMockKV();
    const bigIdA = 9999999999;
    const bigIdB = 1000000001;

    await setConflictWarning(kv, "proj", bigIdA, bigIdB, "file.ts");
    const result = await hasConflictWarning(kv, "proj", bigIdA, bigIdB, "file.ts");
    expect(result).toBe(true);

    // Verify sorted order: 1000000001 < 9999999999
    expect(kv.put).toHaveBeenCalledWith(
      "conflict_warn:proj:1000000001_9999999999:file.ts",
      "1",
      { expirationTtl: 3600 }
    );
  });

  it("handles many files in a single save without data loss", async () => {
    const kv = createMockKV();
    const manyFiles = Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`);

    await saveChangedFiles(kv, "proj", 111, manyFiles);
    const result = await getChangedFiles(kv, "proj", 111);

    expect(result).toHaveLength(50);
    expect(result).toEqual(manyFiles);
  });
});
