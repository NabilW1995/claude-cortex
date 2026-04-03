/**
 * Contextual Tips Engine — Unit Tests (Issue #65)
 *
 * Tests the CONTEXTUAL_TIPS constant, getTipShown, setTipShown, and getTip
 * helpers that power inline tip deduplication via Cloudflare KV.
 */

import { describe, it, expect, vi } from "vitest";
import { CONTEXTUAL_TIPS, getTipShown, setTipShown, getTip } from "./index";

// ---------------------------------------------------------------------------
// Mock KV — in-memory Map that behaves like KVNamespace
// ---------------------------------------------------------------------------

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(
      async (key: string, value: string, _opts?: any) => {
        store.set(key, value);
      }
    ),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      keys: [],
      list_complete: true,
      cacheStatus: null,
    })),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: store.get(key) ?? null,
      metadata: null,
      cacheStatus: null,
    })),
  } as unknown as KVNamespace;
}

// =========================================================================
// 1. CONTEXTUAL_TIPS registry — structure validation
// =========================================================================

describe("CONTEXTUAL_TIPS registry", () => {
  const EXPECTED_KEYS = [
    "category_taken",
    "blocker_active",
    "already_has_category",
    "self_approve_large_pr",
    "all_tasks_done",
    "no_tasks_assigned",
    "forgot_to_pull",
    "category_empty",
  ] as const;

  it("has at least 8 keys", () => {
    expect(Object.keys(CONTEXTUAL_TIPS).length).toBeGreaterThanOrEqual(8);
  });

  it.each(EXPECTED_KEYS)("has key '%s'", (key) => {
    expect(CONTEXTUAL_TIPS).toHaveProperty(key);
  });

  it.each(EXPECTED_KEYS)("'%s' is a non-empty string", (key) => {
    const value = CONTEXTUAL_TIPS[key];
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_KEYS)(
    "'%s' contains <i> tags (italicized)",
    (key) => {
      expect(CONTEXTUAL_TIPS[key]).toContain("<i>");
      expect(CONTEXTUAL_TIPS[key]).toContain("</i>");
    }
  );

  it.each(EXPECTED_KEYS)(
    "'%s' starts with a lightbulb or party emoji",
    (key) => {
      const text = CONTEXTUAL_TIPS[key];
      // All tips start with an emoji (non-ASCII character above U+2000)
      const firstCodePoint = text.codePointAt(0)!;
      expect(firstCodePoint).toBeGreaterThan(0x2000);
    }
  );
});

// =========================================================================
// 2. getTipShown — checks KV for dedup entries
// =========================================================================

describe("getTipShown", () => {
  it("returns false when KV has no entry for the tip", async () => {
    const kv = createMockKV();
    const result = await getTipShown(kv, 12345, "category_taken");
    expect(result).toBe(false);
  });

  it("returns true when KV has an entry for the tip", async () => {
    const kv = createMockKV();
    // Pre-populate the store with the dedup key
    await kv.put("tip_shown:12345:category_taken", "1");

    const result = await getTipShown(kv, 12345, "category_taken");
    expect(result).toBe(true);
  });

  it("reads the correct KV key format: tip_shown:{telegramId}:{tipKey}", async () => {
    const kv = createMockKV();
    await getTipShown(kv, 99999, "blocker_active");
    expect(kv.get).toHaveBeenCalledWith("tip_shown:99999:blocker_active");
  });

  it("returns false for one user even if another user has seen the tip", async () => {
    const kv = createMockKV();
    await kv.put("tip_shown:111:forgot_to_pull", "1");

    const resultUserA = await getTipShown(kv, 111, "forgot_to_pull");
    const resultUserB = await getTipShown(kv, 222, "forgot_to_pull");

    expect(resultUserA).toBe(true);
    expect(resultUserB).toBe(false);
  });
});

// =========================================================================
// 3. setTipShown — marks a tip as shown in KV with TTL
// =========================================================================

describe("setTipShown", () => {
  it("calls kv.put with the correct key format", async () => {
    const kv = createMockKV();
    await setTipShown(kv, 12345, "category_taken");
    expect(kv.put).toHaveBeenCalledWith(
      "tip_shown:12345:category_taken",
      "1",
      { expirationTtl: 3600 }
    );
  });

  it("sets TTL of 3600 seconds (1 hour)", async () => {
    const kv = createMockKV();
    await setTipShown(kv, 42, "all_tasks_done");
    const call = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toEqual({ expirationTtl: 3600 });
  });

  it("stores the value '1' as marker", async () => {
    const kv = createMockKV();
    await setTipShown(kv, 42, "no_tasks_assigned");
    const call = (kv.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toBe("1");
  });

  it("makes getTipShown return true afterwards", async () => {
    const kv = createMockKV();
    expect(await getTipShown(kv, 77, "category_empty")).toBe(false);
    await setTipShown(kv, 77, "category_empty");
    expect(await getTipShown(kv, 77, "category_empty")).toBe(true);
  });
});

// =========================================================================
// 4. getTip — returns tip text or empty string (dedup logic)
// =========================================================================

describe("getTip", () => {
  it("returns tip text with \\n\\n prefix when not previously shown", async () => {
    const kv = createMockKV();
    const result = await getTip(kv, 12345, "category_taken");
    expect(result).toBe("\n\n" + CONTEXTUAL_TIPS["category_taken"]);
  });

  it("returns empty string when the tip was already shown", async () => {
    const kv = createMockKV();
    // Mark the tip as shown
    await kv.put("tip_shown:12345:category_taken", "1");

    const result = await getTip(kv, 12345, "category_taken");
    expect(result).toBe("");
  });

  it("marks the tip as shown after returning it (calls setTipShown)", async () => {
    const kv = createMockKV();
    await getTip(kv, 12345, "blocker_active");

    // After getTip, the tip should be marked as shown
    const isShown = await getTipShown(kv, 12345, "blocker_active");
    expect(isShown).toBe(true);
  });

  it("does not call put when the tip is already shown", async () => {
    const kv = createMockKV();
    // Pre-mark as shown
    await kv.put("tip_shown:12345:forgot_to_pull", "1");

    // Clear mock call history from the put above
    (kv.put as ReturnType<typeof vi.fn>).mockClear();

    await getTip(kv, 12345, "forgot_to_pull");

    // kv.put should not have been called again
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("returns non-empty string containing <i> tags on first call", async () => {
    const kv = createMockKV();
    const result = await getTip(kv, 42, "self_approve_large_pr");
    expect(result).toContain("<i>");
    expect(result).toContain("</i>");
  });
});

// =========================================================================
// 5. Dedup logic — sequential calls demonstrate once-per-window behavior
// =========================================================================

describe("Dedup logic (sequential calls)", () => {
  it("first call returns tip text, second call returns empty string", async () => {
    const kv = createMockKV();
    const first = await getTip(kv, 100, "category_taken");
    const second = await getTip(kv, 100, "category_taken");

    expect(first).toBe("\n\n" + CONTEXTUAL_TIPS["category_taken"]);
    expect(second).toBe("");
  });

  it("different tip keys are deduped independently", async () => {
    const kv = createMockKV();

    // Show tip A — should return text
    const tipA = await getTip(kv, 100, "category_taken");
    expect(tipA).not.toBe("");

    // Show tip B — different key, should still return text
    const tipB = await getTip(kv, 100, "blocker_active");
    expect(tipB).not.toBe("");
    expect(tipB).toBe("\n\n" + CONTEXTUAL_TIPS["blocker_active"]);

    // Show tip A again — should be deduped now
    const tipA2 = await getTip(kv, 100, "category_taken");
    expect(tipA2).toBe("");
  });

  it("different users are deduped independently", async () => {
    const kv = createMockKV();

    // User A sees tip
    const userA = await getTip(kv, 111, "forgot_to_pull");
    expect(userA).not.toBe("");

    // User B should still see the same tip (different user)
    const userB = await getTip(kv, 222, "forgot_to_pull");
    expect(userB).not.toBe("");

    // User A should not see it again
    const userA2 = await getTip(kv, 111, "forgot_to_pull");
    expect(userA2).toBe("");
  });

  it("all 8 tip keys can be shown to the same user", async () => {
    const kv = createMockKV();
    const keys = Object.keys(CONTEXTUAL_TIPS);

    for (const key of keys) {
      const result = await getTip(kv, 500, key);
      expect(result).not.toBe("");
      expect(result).toContain(CONTEXTUAL_TIPS[key]);
    }

    // All should now be deduped
    for (const key of keys) {
      const result = await getTip(kv, 500, key);
      expect(result).toBe("");
    }
  });
});
