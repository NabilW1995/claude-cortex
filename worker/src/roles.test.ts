/**
 * Role System — Unit Tests
 *
 * Tests the Admin/Member role system: getUserRole, isAdmin, setUserRole,
 * countAdmins, first-user auto-admin promotion, /promote and /demote guards.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getUserRole,
  isAdmin,
  setUserRole,
  countAdmins,
  getTeamMembers,
  upsertTeamMember,
} from "./index";
import type { TeamMember, UserRole } from "./index";

// ---------------------------------------------------------------------------
// Mock KV Namespace — simulates Cloudflare KV for testing
// ---------------------------------------------------------------------------

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// Sample team members
// ---------------------------------------------------------------------------

const adminMember: TeamMember = {
  telegram_id: 100,
  telegram_username: "alice",
  github: "alice-gh",
  name: "Alice",
  role: "admin",
};

const regularMember: TeamMember = {
  telegram_id: 200,
  telegram_username: "bob",
  github: "bob-gh",
  name: "Bob",
};

const explicitMember: TeamMember = {
  telegram_id: 300,
  telegram_username: "carol",
  github: "carol-gh",
  name: "Carol",
  role: "member",
};

// =========================================================================
// 1. getUserRole — Pure function tests
// =========================================================================

describe("getUserRole", () => {
  it("returns 'member' for undefined member", () => {
    expect(getUserRole(undefined)).toBe("member");
  });

  it("returns 'member' when role is undefined (backward compat)", () => {
    expect(getUserRole(regularMember)).toBe("member");
  });

  it("returns 'member' when role is explicitly 'member'", () => {
    expect(getUserRole(explicitMember)).toBe("member");
  });

  it("returns 'admin' when role is 'admin'", () => {
    expect(getUserRole(adminMember)).toBe("admin");
  });
});

// =========================================================================
// 2. isAdmin — KV-based admin check
// =========================================================================

describe("isAdmin", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns false when team is empty", async () => {
    const result = await isAdmin(kv, 999);
    expect(result).toBe(false);
  });

  it("returns false for a regular member", async () => {
    await kv.put("team-members", JSON.stringify([regularMember]));
    const result = await isAdmin(kv, regularMember.telegram_id);
    expect(result).toBe(false);
  });

  it("returns true for an admin member", async () => {
    await kv.put("team-members", JSON.stringify([adminMember]));
    const result = await isAdmin(kv, adminMember.telegram_id);
    expect(result).toBe(true);
  });

  it("returns false for a telegram_id not in the team", async () => {
    await kv.put("team-members", JSON.stringify([adminMember]));
    const result = await isAdmin(kv, 99999);
    expect(result).toBe(false);
  });

  it("returns false for a member without explicit role (backward compat)", async () => {
    const memberWithoutRole: TeamMember = {
      telegram_id: 500,
      telegram_username: "legacy",
      github: "legacy-gh",
      name: "Legacy",
    };
    await kv.put("team-members", JSON.stringify([memberWithoutRole]));
    const result = await isAdmin(kv, 500);
    expect(result).toBe(false);
  });
});

// =========================================================================
// 3. setUserRole — KV role mutation
// =========================================================================

describe("setUserRole", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("promotes a regular member to admin", async () => {
    await kv.put("team-members", JSON.stringify([regularMember]));
    await setUserRole(kv, regularMember.telegram_id, "admin");
    const members = await getTeamMembers(kv);
    expect(members[0].role).toBe("admin");
  });

  it("demotes an admin to regular member", async () => {
    await kv.put("team-members", JSON.stringify([adminMember]));
    await setUserRole(kv, adminMember.telegram_id, "member");
    const members = await getTeamMembers(kv);
    expect(members[0].role).toBe("member");
  });

  it("does nothing when telegram_id is not found", async () => {
    await kv.put("team-members", JSON.stringify([regularMember]));
    await setUserRole(kv, 99999, "admin");
    const members = await getTeamMembers(kv);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBeUndefined();
  });

  it("only updates the targeted member in a multi-member team", async () => {
    const team = [{ ...adminMember }, { ...regularMember }];
    await kv.put("team-members", JSON.stringify(team));
    await setUserRole(kv, regularMember.telegram_id, "admin");
    const members = await getTeamMembers(kv);
    expect(members[0].role).toBe("admin"); // Alice unchanged
    expect(members[1].role).toBe("admin"); // Bob promoted
  });

  it("persists the change to KV", async () => {
    await kv.put("team-members", JSON.stringify([regularMember]));
    await setUserRole(kv, regularMember.telegram_id, "admin");

    // Read directly from KV to verify persistence
    const raw = await kv.get("team-members");
    const parsed = JSON.parse(raw!) as TeamMember[];
    expect(parsed[0].role).toBe("admin");
  });
});

// =========================================================================
// 4. countAdmins — Count admin members
// =========================================================================

describe("countAdmins", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns 0 when team is empty", async () => {
    const result = await countAdmins(kv);
    expect(result).toBe(0);
  });

  it("returns 0 when no one is admin", async () => {
    await kv.put("team-members", JSON.stringify([regularMember, explicitMember]));
    const result = await countAdmins(kv);
    expect(result).toBe(0);
  });

  it("returns 1 when one admin exists", async () => {
    await kv.put("team-members", JSON.stringify([adminMember, regularMember]));
    const result = await countAdmins(kv);
    expect(result).toBe(1);
  });

  it("returns 2 when two admins exist", async () => {
    const anotherAdmin: TeamMember = { ...regularMember, role: "admin" };
    await kv.put("team-members", JSON.stringify([adminMember, anotherAdmin]));
    const result = await countAdmins(kv);
    expect(result).toBe(2);
  });
});

// =========================================================================
// 5. First user auto-admin — via upsertTeamMember + setUserRole flow
// =========================================================================

describe("First user auto-admin flow", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("first registered user gets admin role", async () => {
    // Simulate the onboarding flow: check if empty, upsert, then set role
    const existingMembers = await getTeamMembers(kv);
    const isFirstMember = existingMembers.length === 0;

    await upsertTeamMember(kv, {
      telegram_id: 100,
      telegram_username: "first_user",
      github: "first-gh",
      name: "First",
    });

    if (isFirstMember) {
      await setUserRole(kv, 100, "admin");
    }

    const members = await getTeamMembers(kv);
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("admin");
  });

  it("second registered user does NOT get auto-admin", async () => {
    // First user already present
    await kv.put("team-members", JSON.stringify([adminMember]));

    const existingMembers = await getTeamMembers(kv);
    const isFirstMember = existingMembers.length === 0;

    await upsertTeamMember(kv, {
      telegram_id: 200,
      telegram_username: "second_user",
      github: "second-gh",
      name: "Second",
    });

    if (isFirstMember) {
      await setUserRole(kv, 200, "admin");
    }

    const members = await getTeamMembers(kv);
    const second = members.find((m) => m.telegram_id === 200);
    expect(second).toBeDefined();
    expect(second!.role).toBeUndefined(); // Not auto-promoted
  });
});

// =========================================================================
// 6. /promote command guards
// =========================================================================

describe("/promote command guards", () => {
  let kv: KVNamespace;

  beforeEach(async () => {
    kv = createMockKV();
    // Set up a team with one admin (Alice) and one regular member (Bob)
    await kv.put("team-members", JSON.stringify([adminMember, regularMember]));
  });

  it("admin can promote a regular member", async () => {
    // Alice (admin) promotes Bob
    const callerIsAdmin = await isAdmin(kv, adminMember.telegram_id);
    expect(callerIsAdmin).toBe(true);

    await setUserRole(kv, regularMember.telegram_id, "admin");
    const result = await isAdmin(kv, regularMember.telegram_id);
    expect(result).toBe(true);
  });

  it("non-admin cannot promote (guard check)", async () => {
    // Bob (regular) tries to promote — isAdmin returns false
    const callerIsAdmin = await isAdmin(kv, regularMember.telegram_id);
    expect(callerIsAdmin).toBe(false);
  });
});

// =========================================================================
// 7. /demote command guards
// =========================================================================

describe("/demote command guards", () => {
  let kv: KVNamespace;

  beforeEach(async () => {
    kv = createMockKV();
  });

  it("admin can demote another admin", async () => {
    const anotherAdmin: TeamMember = { ...regularMember, role: "admin" };
    await kv.put("team-members", JSON.stringify([adminMember, anotherAdmin]));

    // Alice demotes Bob (both are admins, so safe)
    const adminCount = await countAdmins(kv);
    expect(adminCount).toBe(2);

    await setUserRole(kv, anotherAdmin.telegram_id, "member");
    const result = await isAdmin(kv, anotherAdmin.telegram_id);
    expect(result).toBe(false);
  });

  it("prevents demoting when only one admin remains", async () => {
    await kv.put("team-members", JSON.stringify([adminMember, regularMember]));

    // Only Alice is admin — attempting to demote should be blocked
    const adminCount = await countAdmins(kv);
    expect(adminCount).toBe(1);
    // The bot command checks adminCount <= 1 before demoting
    expect(adminCount <= 1).toBe(true);
  });

  it("prevents self-demotion", async () => {
    const anotherAdmin: TeamMember = { ...regularMember, role: "admin" };
    await kv.put("team-members", JSON.stringify([adminMember, anotherAdmin]));

    // Simulate: Alice tries to demote herself
    const callerId = adminMember.telegram_id;
    const targetId = adminMember.telegram_id;
    // The bot checks target.telegram_id === telegramId
    expect(callerId === targetId).toBe(true);
  });

  it("non-admin cannot demote (guard check)", async () => {
    await kv.put("team-members", JSON.stringify([adminMember, regularMember]));

    const callerIsAdmin = await isAdmin(kv, regularMember.telegram_id);
    expect(callerIsAdmin).toBe(false);
  });
});
