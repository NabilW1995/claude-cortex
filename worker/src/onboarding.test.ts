/**
 * Onboarding Wizard — Unit Tests
 *
 * Tests the 3-step onboarding flow: GitHub username verification,
 * notification settings, and workflow tutorial for new Telegram users.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getOnboardingState,
  setOnboardingState,
  clearOnboardingState,
  isOnboarded,
  markOnboarded,
  sendOnboardingTutorial,
  buildSettingsMessage,
  escapeHtml,
} from "./index";
import type { OnboardingStep, UserPreferences } from "./index";

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
// Mock Grammy Context — simulates a Telegram message context
// ---------------------------------------------------------------------------

function createMockContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chat: { type: "private", id: 99 },
    from: { id: 12345, username: "testuser", first_name: "Test" },
    message: { text: "hello" },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// =========================================================================
// 1. KV Helper Functions
// =========================================================================

describe("KV Helper Functions — Onboarding State", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  // -----------------------------------------------------------------------
  // getOnboardingState
  // -----------------------------------------------------------------------

  describe("getOnboardingState", () => {
    it("returns null when no onboarding state exists", async () => {
      const result = await getOnboardingState(kv, 12345);
      expect(result).toBeNull();
      expect(kv.get).toHaveBeenCalledWith("onboarding:12345");
    });

    it("returns 'awaiting_github' when user is in step 1", async () => {
      await kv.put("onboarding:12345", "awaiting_github");
      const result = await getOnboardingState(kv, 12345);
      expect(result).toBe("awaiting_github");
    });

    it("returns 'settings' when user is in step 2", async () => {
      await kv.put("onboarding:12345", "settings");
      const result = await getOnboardingState(kv, 12345);
      expect(result).toBe("settings");
    });

    it("returns 'tutorial' when user is in step 3", async () => {
      await kv.put("onboarding:12345", "tutorial");
      const result = await getOnboardingState(kv, 12345);
      expect(result).toBe("tutorial");
    });

    it("uses the correct KV key format with telegram ID", async () => {
      await getOnboardingState(kv, 99999);
      expect(kv.get).toHaveBeenCalledWith("onboarding:99999");
    });
  });

  // -----------------------------------------------------------------------
  // setOnboardingState
  // -----------------------------------------------------------------------

  describe("setOnboardingState", () => {
    it("stores the onboarding step in KV", async () => {
      await setOnboardingState(kv, 12345, "awaiting_github");
      expect(kv.put).toHaveBeenCalledWith(
        "onboarding:12345",
        "awaiting_github",
        { expirationTtl: 86400 }
      );
    });

    it("sets a 24-hour TTL on the key", async () => {
      await setOnboardingState(kv, 12345, "settings");
      const putCall = vi.mocked(kv.put).mock.calls[0];
      expect(putCall[2]).toEqual({ expirationTtl: 86400 });
    });

    it("overwrites the previous step when advancing", async () => {
      await setOnboardingState(kv, 12345, "awaiting_github");
      await setOnboardingState(kv, 12345, "settings");
      const result = await getOnboardingState(kv, 12345);
      expect(result).toBe("settings");
    });

    it("handles all three valid step values", async () => {
      const steps: OnboardingStep[] = ["awaiting_github", "settings", "tutorial"];
      for (const step of steps) {
        await setOnboardingState(kv, 12345, step);
        const result = await getOnboardingState(kv, 12345);
        expect(result).toBe(step);
      }
    });
  });

  // -----------------------------------------------------------------------
  // clearOnboardingState
  // -----------------------------------------------------------------------

  describe("clearOnboardingState", () => {
    it("removes the onboarding key from KV", async () => {
      await setOnboardingState(kv, 12345, "awaiting_github");
      await clearOnboardingState(kv, 12345);
      expect(kv.delete).toHaveBeenCalledWith("onboarding:12345");
    });

    it("results in null when reading after clearing", async () => {
      await setOnboardingState(kv, 12345, "settings");
      await clearOnboardingState(kv, 12345);
      const result = await getOnboardingState(kv, 12345);
      expect(result).toBeNull();
    });

    it("does not throw when clearing non-existent state", async () => {
      await expect(clearOnboardingState(kv, 99999)).resolves.not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // isOnboarded
  // -----------------------------------------------------------------------

  describe("isOnboarded", () => {
    it("returns false when user has never been onboarded", async () => {
      const result = await isOnboarded(kv, 12345);
      expect(result).toBe(false);
      expect(kv.get).toHaveBeenCalledWith("onboarded:12345");
    });

    it("returns true when user has been marked as onboarded", async () => {
      await kv.put("onboarded:12345", "true");
      const result = await isOnboarded(kv, 12345);
      expect(result).toBe(true);
    });

    it("returns false when KV has unexpected value", async () => {
      await kv.put("onboarded:12345", "false");
      const result = await isOnboarded(kv, 12345);
      expect(result).toBe(false);
    });

    it("returns false when KV has empty string", async () => {
      await kv.put("onboarded:12345", "");
      const result = await isOnboarded(kv, 12345);
      expect(result).toBe(false);
    });

    it("uses a separate key from onboarding state", async () => {
      await setOnboardingState(kv, 12345, "awaiting_github");
      const result = await isOnboarded(kv, 12345);
      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // markOnboarded
  // -----------------------------------------------------------------------

  describe("markOnboarded", () => {
    it("stores 'true' under the onboarded key", async () => {
      await markOnboarded(kv, 12345);
      expect(kv.put).toHaveBeenCalledWith("onboarded:12345", "true");
    });

    it("makes isOnboarded return true afterwards", async () => {
      await markOnboarded(kv, 12345);
      const result = await isOnboarded(kv, 12345);
      expect(result).toBe(true);
    });

    it("stores permanently (no TTL)", async () => {
      await markOnboarded(kv, 12345);
      // The put call should NOT have a third argument with expirationTtl
      const putCall = vi.mocked(kv.put).mock.calls.find(
        (c) => c[0] === "onboarded:12345"
      );
      expect(putCall).toBeDefined();
      expect(putCall![2]).toBeUndefined();
    });
  });
});

// =========================================================================
// 2. sendOnboardingTutorial
// =========================================================================

describe("sendOnboardingTutorial", () => {
  it("sends exactly 3 messages as part of the tutorial", async () => {
    const ctx = createMockContext();
    await sendOnboardingTutorial(ctx as any);
    expect(ctx.reply).toHaveBeenCalledTimes(3);
  });

  it("sends all messages in HTML parse mode", async () => {
    const ctx = createMockContext();
    await sendOnboardingTutorial(ctx as any);
    const replyCalls = vi.mocked(ctx.reply as any).mock.calls;
    for (const call of replyCalls) {
      expect(call[1]).toEqual(expect.objectContaining({ parse_mode: "HTML" }));
    }
  });

  it("first message introduces 'How the Team Bot Works'", async () => {
    const ctx = createMockContext();
    await sendOnboardingTutorial(ctx as any);
    const firstMessage = vi.mocked(ctx.reply as any).mock.calls[0][0] as string;
    expect(firstMessage).toContain("How the Team Bot Works");
  });

  it("second message explains the 3-step workflow", async () => {
    const ctx = createMockContext();
    await sendOnboardingTutorial(ctx as any);
    const secondMessage = vi.mocked(ctx.reply as any).mock.calls[1][0] as string;
    expect(secondMessage).toContain("Claim a Category");
    expect(secondMessage).toContain("Work on Your Branch");
    expect(secondMessage).toContain("Pull After Merge");
  });

  it("third message contains the golden rule and completion", async () => {
    const ctx = createMockContext();
    await sendOnboardingTutorial(ctx as any);
    const thirdMessage = vi.mocked(ctx.reply as any).mock.calls[2][0] as string;
    expect(thirdMessage).toContain("Golden Rule");
    expect(thirdMessage).toContain("all set");
  });
});

// =========================================================================
// 3. buildSettingsMessage
// =========================================================================

describe("buildSettingsMessage", () => {
  const defaultPrefs: UserPreferences = {
    commits: false,
    previews: false,
    tasks: true,
    pr_reviews: false,
    sessions: false,
    dm_chat_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  it("returns both text and keyboard", () => {
    const result = buildSettingsMessage(defaultPrefs);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("keyboard");
    expect(result.keyboard).toHaveProperty("inline_keyboard");
  });

  it("shows 'Notification Settings' as the title", () => {
    const result = buildSettingsMessage(defaultPrefs);
    expect(result.text).toContain("Notification Settings");
  });

  it("shows checkmark for enabled preferences", () => {
    const prefs: UserPreferences = {
      ...defaultPrefs,
      commits: true,
      previews: true,
    };
    const result = buildSettingsMessage(prefs);
    // The checkmark emoji should appear for enabled settings
    expect(result.text).toContain("\u2705");
  });

  it("shows X mark for disabled preferences", () => {
    const result = buildSettingsMessage(defaultPrefs);
    // commits, previews, pr_reviews, sessions are all false — should show X marks
    expect(result.text).toContain("\u274C");
  });

  it("includes toggle buttons in the keyboard", () => {
    const result = buildSettingsMessage(defaultPrefs);
    const allButtons = result.keyboard.inline_keyboard.flat();
    const toggleButtons = allButtons.filter((b) =>
      b.callback_data.startsWith("pref_toggle:")
    );
    expect(toggleButtons.length).toBeGreaterThanOrEqual(4);
  });

  it("includes callback data for commits, previews, pr_reviews, and sessions", () => {
    const result = buildSettingsMessage(defaultPrefs);
    const allCallbackData = result.keyboard.inline_keyboard
      .flat()
      .map((b) => b.callback_data);
    expect(allCallbackData).toContain("pref_toggle:commits");
    expect(allCallbackData).toContain("pref_toggle:previews");
    expect(allCallbackData).toContain("pref_toggle:pr_reviews");
    expect(allCallbackData).toContain("pref_toggle:sessions");
  });

  it("reflects the current state in button text", () => {
    const prefs: UserPreferences = {
      ...defaultPrefs,
      commits: true,
      previews: false,
    };
    const result = buildSettingsMessage(prefs);
    const allButtons = result.keyboard.inline_keyboard.flat();
    const commitsBtn = allButtons.find((b) => b.callback_data === "pref_toggle:commits");
    const previewsBtn = allButtons.find((b) => b.callback_data === "pref_toggle:previews");
    // Commits is enabled — its button text should contain the checkmark
    expect(commitsBtn?.text).toContain("\u2705");
    // Previews is disabled — its button text should contain X mark
    expect(previewsBtn?.text).toContain("\u274C");
  });
});

// =========================================================================
// 4. escapeHtml (used in onboarding messages)
// =========================================================================

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  it("escapes less-than signs", () => {
    expect(escapeHtml("a < b")).toBe("a &lt; b");
  });

  it("escapes greater-than signs", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml("<script>alert('&')</script>")).toBe(
      "&lt;script&gt;alert('&amp;')&lt;/script&gt;"
    );
  });

  it("returns the same string when no escaping is needed", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("handles empty strings", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// =========================================================================
// 5. /start Command Branching Logic
// =========================================================================

describe("/start command branching", () => {
  // These tests validate the expected behavior of the /start handler by
  // simulating the decision logic. Since the handler is registered on the
  // bot and cannot be called directly, we test the underlying logic that
  // determines which path is taken.

  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  describe("unknown user in private chat starts wizard", () => {
    it("user who is not a team member and not onboarded should need onboarding", async () => {
      // Simulate: no team members registered, user not onboarded
      const telegramId = 12345;
      const membersRaw = await kv.get("team-members");
      const members = membersRaw ? JSON.parse(membersRaw) : [];
      const isMember = members.some((m: any) => m.telegram_id === telegramId);
      const onboarded = await isOnboarded(kv, telegramId);

      expect(isMember).toBe(false);
      expect(onboarded).toBe(false);
      // In this case, the handler would start the wizard
    });

    it("sets onboarding state to 'awaiting_github' when starting wizard", async () => {
      const telegramId = 12345;
      await setOnboardingState(kv, telegramId, "awaiting_github");
      const state = await getOnboardingState(kv, telegramId);
      expect(state).toBe("awaiting_github");
    });
  });

  describe("known user gets normal menu", () => {
    it("registered team member should skip onboarding", async () => {
      const telegramId = 12345;
      // Register a team member
      await kv.put(
        "team-members",
        JSON.stringify([
          {
            telegram_id: telegramId,
            telegram_username: "testuser",
            github: "octocat",
            name: "Test User",
          },
        ])
      );

      const membersRaw = await kv.get("team-members");
      const members = membersRaw ? JSON.parse(membersRaw) : [];
      const isMember = members.some((m: any) => m.telegram_id === telegramId);
      expect(isMember).toBe(true);
      // In this case, the handler would show the normal keyboard
    });

    it("previously onboarded user should skip wizard even if not a member", async () => {
      const telegramId = 12345;
      await markOnboarded(kv, telegramId);
      const onboarded = await isOnboarded(kv, telegramId);
      expect(onboarded).toBe(true);
      // In this case, the handler would show the normal keyboard
    });
  });
});

// =========================================================================
// 6. GitHub Username Validation (message:text handler logic)
// =========================================================================

describe("GitHub username validation", () => {
  // The message:text handler validates the username before calling the GitHub API.
  // We test the validation logic in isolation.

  function isValidGithubUsername(input: string): boolean {
    const username = input.trim().replace(/^@/, "");
    if (!username || username.includes(" ") || username.length > 39) {
      return false;
    }
    return true;
  }

  it("accepts a valid username", () => {
    expect(isValidGithubUsername("octocat")).toBe(true);
  });

  it("accepts username with leading @", () => {
    expect(isValidGithubUsername("@octocat")).toBe(true);
  });

  it("accepts username with leading/trailing whitespace", () => {
    expect(isValidGithubUsername("  octocat  ")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(isValidGithubUsername("")).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(isValidGithubUsername("   ")).toBe(false);
  });

  it("rejects username with spaces", () => {
    expect(isValidGithubUsername("octo cat")).toBe(false);
  });

  it("rejects username longer than 39 characters", () => {
    expect(isValidGithubUsername("a".repeat(40))).toBe(false);
  });

  it("accepts username exactly 39 characters", () => {
    expect(isValidGithubUsername("a".repeat(39))).toBe(true);
  });

  it("rejects just an @ sign (becomes empty after stripping)", () => {
    expect(isValidGithubUsername("@")).toBe(false);
  });
});

// =========================================================================
// 7. Onboard Continue Callback Flow
// =========================================================================

describe("onboard_continue callback flow", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("transitions through the complete onboarding lifecycle", async () => {
    const telegramId = 12345;

    // Step 1: User starts onboarding
    await setOnboardingState(kv, telegramId, "awaiting_github");
    expect(await getOnboardingState(kv, telegramId)).toBe("awaiting_github");
    expect(await isOnboarded(kv, telegramId)).toBe(false);

    // Step 2: User provides GitHub username, advances to settings
    await setOnboardingState(kv, telegramId, "settings");
    expect(await getOnboardingState(kv, telegramId)).toBe("settings");

    // Step 3: User clicks "Continue to Tutorial" — onboard_continue callback
    await setOnboardingState(kv, telegramId, "tutorial");
    expect(await getOnboardingState(kv, telegramId)).toBe("tutorial");

    // Tutorial is sent, then onboarding is marked complete
    await markOnboarded(kv, telegramId);
    await clearOnboardingState(kv, telegramId);

    // Final state: onboarded = true, no active onboarding state
    expect(await isOnboarded(kv, telegramId)).toBe(true);
    expect(await getOnboardingState(kv, telegramId)).toBeNull();
  });

  it("sends tutorial and then cleans up state", async () => {
    const telegramId = 12345;
    const ctx = createMockContext({ from: { id: telegramId, username: "test", first_name: "Test" } });

    // Simulate the onboard_continue handler
    await setOnboardingState(kv, telegramId, "tutorial");
    await sendOnboardingTutorial(ctx as any);
    await markOnboarded(kv, telegramId);
    await clearOnboardingState(kv, telegramId);

    // Tutorial was sent (3 messages)
    expect(ctx.reply).toHaveBeenCalledTimes(3);
    // Onboarding is complete
    expect(await isOnboarded(kv, telegramId)).toBe(true);
    expect(await getOnboardingState(kv, telegramId)).toBeNull();
  });

  it("user can use the bot normally after onboarding completes", async () => {
    const telegramId = 12345;

    // Complete onboarding
    await markOnboarded(kv, telegramId);
    await clearOnboardingState(kv, telegramId);

    // Subsequent /start check: not a member but onboarded
    const onboarded = await isOnboarded(kv, telegramId);
    expect(onboarded).toBe(true);
    // The /start handler would skip the wizard and show normal menu
  });
});

// =========================================================================
// 8. Edge Cases and Regression Scenarios
// =========================================================================

describe("Edge cases", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("multiple users can be in onboarding simultaneously", async () => {
    await setOnboardingState(kv, 111, "awaiting_github");
    await setOnboardingState(kv, 222, "settings");
    await setOnboardingState(kv, 333, "tutorial");

    expect(await getOnboardingState(kv, 111)).toBe("awaiting_github");
    expect(await getOnboardingState(kv, 222)).toBe("settings");
    expect(await getOnboardingState(kv, 333)).toBe("tutorial");
  });

  it("clearing one user's state does not affect others", async () => {
    await setOnboardingState(kv, 111, "awaiting_github");
    await setOnboardingState(kv, 222, "settings");

    await clearOnboardingState(kv, 111);

    expect(await getOnboardingState(kv, 111)).toBeNull();
    expect(await getOnboardingState(kv, 222)).toBe("settings");
  });

  it("onboarding and onboarded keys are independent per user", async () => {
    await setOnboardingState(kv, 111, "awaiting_github");
    await markOnboarded(kv, 222);

    expect(await isOnboarded(kv, 111)).toBe(false);
    expect(await getOnboardingState(kv, 222)).toBeNull();
    expect(await isOnboarded(kv, 222)).toBe(true);
    expect(await getOnboardingState(kv, 111)).toBe("awaiting_github");
  });

  it("re-onboarding: marking onboarded is idempotent", async () => {
    await markOnboarded(kv, 12345);
    await markOnboarded(kv, 12345);
    expect(await isOnboarded(kv, 12345)).toBe(true);
  });

  it("buildSettingsMessage handles all-true preferences", () => {
    const prefs: UserPreferences = {
      commits: true,
      previews: true,
      tasks: true,
      pr_reviews: true,
      sessions: true,
      dm_chat_id: 123,
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const result = buildSettingsMessage(prefs);
    expect(result.text).toBeDefined();
    expect(result.keyboard.inline_keyboard.length).toBeGreaterThan(0);
    // All should show checkmarks, no X marks for the toggleable fields
    // (tasks is always on, so it's not toggle-displayed the same way)
  });

  it("buildSettingsMessage handles all-false preferences", () => {
    const prefs: UserPreferences = {
      commits: false,
      previews: false,
      tasks: false,
      pr_reviews: false,
      sessions: false,
      dm_chat_id: null,
      updated_at: "",
    };
    const result = buildSettingsMessage(prefs);
    expect(result.text).toBeDefined();
    expect(result.keyboard.inline_keyboard.length).toBeGreaterThan(0);
  });
});
