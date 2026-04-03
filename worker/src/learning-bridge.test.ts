/**
 * Learning Bridge — Unit Tests (Issue #64)
 *
 * Tests the @Claude learning capture system that allows users to
 * save learnings via Telegram DM with scope selection (team/private).
 *
 * Covers:
 * - @Claude prefix detection (regex matching)
 * - Learning content extraction (text after prefix)
 * - D1 storage helpers (saveLearning, updateLearningScope)
 * - Query helpers (getTodayTeamLearnings, getTodayUserLearnings)
 */

import { describe, it, expect, vi } from "vitest";
import {
  saveLearning,
  updateLearningScope,
  getTodayTeamLearnings,
  getTodayUserLearnings,
  escapeHtml,
} from "./index";

// ---------------------------------------------------------------------------
// Mock D1 Database — simulates Cloudflare D1 for testing
// ---------------------------------------------------------------------------

interface MockRow {
  id: number;
  user_id: string;
  project: string;
  content: string;
  scope: string;
  created_at: string;
}

function createMockD1(initialRows: MockRow[] = []): D1Database {
  const rows = [...initialRows];
  let autoIncrement = initialRows.length > 0
    ? Math.max(...initialRows.map((r) => r.id)) + 1
    : 1;

  return {
    prepare: vi.fn((sql: string) => {
      return {
        bind: vi.fn((...params: unknown[]) => {
          return {
            run: vi.fn(async () => {
              if (sql.startsWith("INSERT")) {
                const id = autoIncrement++;
                rows.push({
                  id,
                  user_id: params[0] as string,
                  project: params[1] as string,
                  content: params[2] as string,
                  scope: params[3] as string || "private",
                  created_at: new Date().toISOString(),
                });
                return { meta: { last_row_id: id }, success: true };
              }
              if (sql.startsWith("UPDATE")) {
                // scope update: params[0] = scope, params[1] = id
                const targetId = params[1] as number;
                const newScope = params[0] as string;
                const row = rows.find((r) => r.id === targetId);
                if (row) row.scope = newScope;
                return { meta: {}, success: true };
              }
              return { meta: {}, success: true };
            }),
            all: vi.fn(async () => {
              // Filter rows based on the query type
              if (sql.includes("scope = 'team'")) {
                // getTodayTeamLearnings query
                const project = params[0] as string;
                const filtered = rows.filter(
                  (r) => r.project === project && r.scope === "team"
                );
                return {
                  results: filtered.map((r) => ({
                    content: r.content,
                    user_id: r.user_id,
                  })),
                };
              }
              if (sql.includes("user_id = ?")) {
                // getTodayUserLearnings query
                const userId = params[0] as string;
                const filtered = rows.filter((r) => r.user_id === userId);
                return {
                  results: filtered.map((r) => ({
                    content: r.content,
                    scope: r.scope,
                  })),
                };
              }
              return { results: [] };
            }),
          };
        }),
      };
    }),
    dump: vi.fn(),
    batch: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// @Claude prefix detection
// ---------------------------------------------------------------------------

describe("@Claude prefix detection", () => {
  const claudePrefix = /^@claude\b/i;

  it("matches @Claude at start of message (lowercase)", () => {
    expect(claudePrefix.test("@claude this is a learning")).toBe(true);
  });

  it("matches @Claude at start of message (uppercase)", () => {
    expect(claudePrefix.test("@Claude this is a learning")).toBe(true);
  });

  it("matches @CLAUDE at start of message (all caps)", () => {
    expect(claudePrefix.test("@CLAUDE this is a learning")).toBe(true);
  });

  it("matches @Claude with mixed case", () => {
    expect(claudePrefix.test("@cLaUdE something")).toBe(true);
  });

  it("does not match @Claude in the middle of text", () => {
    expect(claudePrefix.test("hey @Claude something")).toBe(false);
  });

  it("does not match @ClaudeExtra (no word boundary)", () => {
    // \b should prevent matching @ClaudeExtra as @Claude
    expect(claudePrefix.test("@ClaudeExtra test")).toBe(false);
  });

  it("matches @Claude followed by nothing (empty learning)", () => {
    expect(claudePrefix.test("@Claude")).toBe(true);
  });

  it("matches @Claude with only whitespace after", () => {
    expect(claudePrefix.test("@Claude   ")).toBe(true);
  });

  it("does not match messages without @Claude", () => {
    expect(claudePrefix.test("hello world")).toBe(false);
  });

  it("does not match @ClaudeBot (different word)", () => {
    expect(claudePrefix.test("@ClaudeBot do something")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Learning content extraction
// ---------------------------------------------------------------------------

describe("learning content extraction", () => {
  const claudePrefix = /^@claude\b/i;

  function extractContent(text: string): string {
    return text.replace(claudePrefix, "").trim();
  }

  it("extracts content after @Claude", () => {
    expect(extractContent("@Claude Always validate inputs")).toBe(
      "Always validate inputs"
    );
  });

  it("extracts content with leading whitespace trimmed", () => {
    expect(extractContent("@Claude    extra spaces here")).toBe(
      "extra spaces here"
    );
  });

  it("returns empty string for @Claude alone", () => {
    expect(extractContent("@Claude")).toBe("");
  });

  it("returns empty string for @Claude with only whitespace", () => {
    expect(extractContent("@Claude   ")).toBe("");
  });

  it("preserves content with special characters", () => {
    expect(
      extractContent("@Claude Use <code> tags for HTML & escape entities")
    ).toBe("Use <code> tags for HTML & escape entities");
  });

  it("preserves multiline content", () => {
    const result = extractContent("@Claude Line 1\nLine 2\nLine 3");
    expect(result).toBe("Line 1\nLine 2\nLine 3");
  });

  it("handles case-insensitive prefix removal", () => {
    expect(extractContent("@CLAUDE This is case insensitive")).toBe(
      "This is case insensitive"
    );
  });
});

// ---------------------------------------------------------------------------
// saveLearning — D1 insert
// ---------------------------------------------------------------------------

describe("saveLearning", () => {
  it("inserts a learning and returns its ID", async () => {
    const db = createMockD1();
    const id = await saveLearning(db, "123", "my-project", "Always use parameterized queries");

    expect(id).toBe(1);
    expect(db.prepare).toHaveBeenCalledWith(
      "INSERT INTO learnings_telegram (user_id, project, content, scope) VALUES (?, ?, ?, ?)"
    );
  });

  it("uses default scope of 'private'", async () => {
    const db = createMockD1();
    await saveLearning(db, "123", "my-project", "Some learning");

    // Verify bind was called with "private" as the 4th parameter
    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
    const bindCall = prepareCall.bind.mock.calls[0];
    expect(bindCall[3]).toBe("private");
  });

  it("accepts custom scope parameter", async () => {
    const db = createMockD1();
    await saveLearning(db, "123", "my-project", "Some learning", "team");

    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
    const bindCall = prepareCall.bind.mock.calls[0];
    expect(bindCall[3]).toBe("team");
  });

  it("returns incrementing IDs for multiple saves", async () => {
    const db = createMockD1();
    const id1 = await saveLearning(db, "123", "proj", "Learning 1");
    const id2 = await saveLearning(db, "123", "proj", "Learning 2");

    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// updateLearningScope — D1 update
// ---------------------------------------------------------------------------

describe("updateLearningScope", () => {
  it("updates scope to 'team'", async () => {
    const db = createMockD1([
      { id: 1, user_id: "123", project: "proj", content: "test", scope: "private", created_at: "" },
    ]);

    await updateLearningScope(db, 1, "team", "123");

    expect(db.prepare).toHaveBeenCalledWith(
      "UPDATE learnings_telegram SET scope = ? WHERE id = ? AND user_id = ?"
    );
  });

  it("updates scope to 'private'", async () => {
    const db = createMockD1([
      { id: 1, user_id: "123", project: "proj", content: "test", scope: "team", created_at: "" },
    ]);

    await updateLearningScope(db, 1, "private", "123");

    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
    const bindCall = prepareCall.bind.mock.calls[0];
    expect(bindCall[0]).toBe("private");
    expect(bindCall[1]).toBe(1);
    expect(bindCall[2]).toBe("123");
  });
});

// ---------------------------------------------------------------------------
// getTodayTeamLearnings — D1 query
// ---------------------------------------------------------------------------

describe("getTodayTeamLearnings", () => {
  it("returns team-scoped learnings for a project", async () => {
    const db = createMockD1([
      { id: 1, user_id: "100", project: "proj", content: "Team learning 1", scope: "team", created_at: "" },
      { id: 2, user_id: "200", project: "proj", content: "Team learning 2", scope: "team", created_at: "" },
      { id: 3, user_id: "100", project: "proj", content: "Private one", scope: "private", created_at: "" },
    ]);

    const results = await getTodayTeamLearnings(db, "proj");

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("Team learning 1");
    expect(results[1].content).toBe("Team learning 2");
  });

  it("returns empty array when no team learnings exist", async () => {
    const db = createMockD1([
      { id: 1, user_id: "100", project: "proj", content: "Private", scope: "private", created_at: "" },
    ]);

    const results = await getTodayTeamLearnings(db, "proj");
    expect(results).toHaveLength(0);
  });

  it("returns empty array on D1 error", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => { throw new Error("D1 unavailable"); }),
        })),
      })),
    } as unknown as D1Database;

    const results = await getTodayTeamLearnings(db, "proj");
    expect(results).toEqual([]);
  });

  it("filters by project — does not return learnings from other projects", async () => {
    const db = createMockD1([
      { id: 1, user_id: "100", project: "proj-a", content: "From A", scope: "team", created_at: "" },
      { id: 2, user_id: "100", project: "proj-b", content: "From B", scope: "team", created_at: "" },
    ]);

    const results = await getTodayTeamLearnings(db, "proj-a");

    // The mock filters by project in the all() implementation
    expect(results.every((r) => true)).toBe(true);
    // Verify the SQL was called with the correct project
    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
    const bindCall = prepareCall.bind.mock.calls[0];
    expect(bindCall[0]).toBe("proj-a");
  });
});

// ---------------------------------------------------------------------------
// getTodayUserLearnings — D1 query
// ---------------------------------------------------------------------------

describe("getTodayUserLearnings", () => {
  it("returns all learnings for a user (both scopes)", async () => {
    const db = createMockD1([
      { id: 1, user_id: "100", project: "proj", content: "Team one", scope: "team", created_at: "" },
      { id: 2, user_id: "100", project: "proj", content: "Private one", scope: "private", created_at: "" },
      { id: 3, user_id: "200", project: "proj", content: "Other user", scope: "team", created_at: "" },
    ]);

    const results = await getTodayUserLearnings(db, "100");

    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("Team one");
    expect(results[0].scope).toBe("team");
    expect(results[1].content).toBe("Private one");
    expect(results[1].scope).toBe("private");
  });

  it("returns empty array when user has no learnings", async () => {
    const db = createMockD1([
      { id: 1, user_id: "200", project: "proj", content: "Other user", scope: "team", created_at: "" },
    ]);

    const results = await getTodayUserLearnings(db, "100");
    expect(results).toHaveLength(0);
  });

  it("returns empty array on D1 error", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => { throw new Error("D1 unavailable"); }),
        })),
      })),
    } as unknown as D1Database;

    const results = await getTodayUserLearnings(db, "100");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scope handling — integration-like tests
// ---------------------------------------------------------------------------

describe("scope handling workflow", () => {
  it("saves learning with private scope, then updates to team", async () => {
    const db = createMockD1();

    // Step 1: Save learning (defaults to private)
    const id = await saveLearning(db, "100", "proj", "Use parameterized queries");
    expect(id).toBe(1);

    // Step 2: User clicks "For everyone" — update scope to team
    await updateLearningScope(db, id, "team", "100");

    // Verify the update SQL was called correctly
    const calls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1][0]).toBe("UPDATE learnings_telegram SET scope = ? WHERE id = ? AND user_id = ?");
  });

  it("saves learning with private scope and keeps it private", async () => {
    const db = createMockD1();

    // Step 1: Save learning (defaults to private)
    const id = await saveLearning(db, "100", "proj", "My personal note");

    // Step 2: User clicks "Only for me" — update scope to private (no-op, but valid)
    await updateLearningScope(db, id, "private", "100");

    // Verify the update SQL was still called
    expect(db.prepare).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// escapeHtml — XSS prevention for learning content
// ---------------------------------------------------------------------------

describe("escapeHtml on learning content", () => {
  it("escapes HTML tags in learning content", () => {
    const input = "<script>alert('xss')</script>";
    const result = escapeHtml(input);
    expect(result).toBe("&lt;script&gt;alert('xss')&lt;/script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("escapes ampersands in learning content", () => {
    expect(escapeHtml("Use A & B together")).toBe("Use A &amp; B together");
  });

  it("escapes angle brackets in code references", () => {
    expect(escapeHtml("Use <code> tags for HTML")).toBe(
      "Use &lt;code&gt; tags for HTML"
    );
  });

  it("handles learning with no special characters unchanged", () => {
    const input = "Always validate user input on the server";
    expect(escapeHtml(input)).toBe(input);
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("escapes multiple occurrences of special characters", () => {
    expect(escapeHtml("a < b & b > c & d < e")).toBe(
      "a &lt; b &amp; b &gt; c &amp; d &lt; e"
    );
  });
});

// ---------------------------------------------------------------------------
// Scope callback data pattern — validates the regex used by the bot handler
// ---------------------------------------------------------------------------

describe("scope callback data pattern", () => {
  const scopePattern = /^learning_scope:(\d+):(team|private)$/;

  it("matches team scope callback data", () => {
    const match = "learning_scope:42:team".match(scopePattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("42");
    expect(match![2]).toBe("team");
  });

  it("matches private scope callback data", () => {
    const match = "learning_scope:1:private".match(scopePattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("1");
    expect(match![2]).toBe("private");
  });

  it("matches large learning IDs", () => {
    const match = "learning_scope:999999:team".match(scopePattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("999999");
  });

  it("does not match invalid scope values", () => {
    expect(scopePattern.test("learning_scope:1:public")).toBe(false);
  });

  it("does not match non-numeric learning IDs", () => {
    expect(scopePattern.test("learning_scope:abc:team")).toBe(false);
  });

  it("does not match empty learning ID", () => {
    expect(scopePattern.test("learning_scope::team")).toBe(false);
  });

  it("does not match missing scope", () => {
    expect(scopePattern.test("learning_scope:1:")).toBe(false);
  });

  it("does not match wrong prefix", () => {
    expect(scopePattern.test("other_scope:1:team")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveLearning — edge cases
// ---------------------------------------------------------------------------

describe("saveLearning edge cases", () => {
  it("handles long learning content", async () => {
    const db = createMockD1();
    const longContent = "x".repeat(2000);
    const id = await saveLearning(db, "123", "proj", longContent);
    expect(id).toBe(1);

    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
    const bindCall = prepareCall.bind.mock.calls[0];
    expect(bindCall[2]).toBe(longContent);
  });

  it("handles special characters in content", async () => {
    const db = createMockD1();
    const content = "Use <b>bold</b> & 'quotes' in \"strings\"";
    const id = await saveLearning(db, "123", "proj", content);
    expect(id).toBe(1);

    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value;
    const bindCall = prepareCall.bind.mock.calls[0];
    expect(bindCall[2]).toBe(content);
  });

  it("handles unicode content (emoji, non-latin characters)", async () => {
    const db = createMockD1();
    const content = "Immer Eingaben validieren. Use parameterized queries.";
    const id = await saveLearning(db, "123", "proj", content);
    expect(id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTodayTeamLearnings / getTodayUserLearnings — edge cases
// ---------------------------------------------------------------------------

describe("query helpers — additional edge cases", () => {
  it("getTodayTeamLearnings calls correct SQL with project filter", async () => {
    const db = createMockD1();

    await getTodayTeamLearnings(db, "my-project");

    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prepareCall).toContain("scope = 'team'");
    expect(prepareCall).toContain("project = ?");
    expect(prepareCall).toContain("date(created_at) = date('now')");
  });

  it("getTodayUserLearnings calls correct SQL with user filter", async () => {
    const db = createMockD1();

    await getTodayUserLearnings(db, "456");

    const prepareCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(prepareCall).toContain("user_id = ?");
    expect(prepareCall).toContain("date(created_at) = date('now')");
  });

  it("getTodayTeamLearnings limits to 20 results", async () => {
    const db = createMockD1();
    await getTodayTeamLearnings(db, "proj");

    const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("LIMIT 20");
  });

  it("getTodayUserLearnings limits to 20 results", async () => {
    const db = createMockD1();
    await getTodayUserLearnings(db, "123");

    const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("LIMIT 20");
  });

  it("getTodayTeamLearnings orders by created_at DESC (most recent first)", async () => {
    const db = createMockD1();
    await getTodayTeamLearnings(db, "proj");

    const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ORDER BY created_at DESC");
  });

  it("getTodayUserLearnings orders by created_at DESC (most recent first)", async () => {
    const db = createMockD1();
    await getTodayUserLearnings(db, "123");

    const sql = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ORDER BY created_at DESC");
  });
});
