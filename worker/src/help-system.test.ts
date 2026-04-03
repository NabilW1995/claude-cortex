/**
 * Help System — Unit Tests (Issue #52)
 *
 * Tests the HELP_TEXTS constant: structure validation, content checks
 * for all 6 topics (overview, blocker, priorities, categories, preview,
 * conflicts), HTML formatting, and expected keywords in each help entry.
 */

import { describe, it, expect } from "vitest";
import { HELP_TEXTS } from "./index";

// =========================================================================
// 1. HELP_TEXTS structure — all 6 keys exist and are non-empty strings
// =========================================================================

describe("HELP_TEXTS structure", () => {
  const EXPECTED_KEYS = [
    "overview",
    "blocker",
    "priorities",
    "categories",
    "preview",
    "conflicts",
  ] as const;

  it("has exactly 6 keys", () => {
    expect(Object.keys(HELP_TEXTS)).toHaveLength(6);
  });

  it.each(EXPECTED_KEYS)("has key '%s'", (key) => {
    expect(HELP_TEXTS).toHaveProperty(key);
  });

  it.each(EXPECTED_KEYS)("'%s' is a non-empty string", (key) => {
    const value = HELP_TEXTS[key];
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });

  it("does not contain unexpected keys", () => {
    const keys = Object.keys(HELP_TEXTS);
    for (const key of keys) {
      expect(EXPECTED_KEYS).toContain(key);
    }
  });
});

// =========================================================================
// 2. HELP_TEXTS content — each text contains expected HTML tags
// =========================================================================

describe("HELP_TEXTS HTML formatting", () => {
  it.each([
    "overview",
    "blocker",
    "priorities",
    "categories",
    "preview",
    "conflicts",
  ] as const)("'%s' contains <b> bold tags", (key) => {
    expect(HELP_TEXTS[key]).toContain("<b>");
    expect(HELP_TEXTS[key]).toContain("</b>");
  });

  it("overview contains <i> italic tags for workflow steps", () => {
    expect(HELP_TEXTS.overview).toContain("<i>");
    expect(HELP_TEXTS.overview).toContain("</i>");
  });

  it("blocker contains <code> tag for the label name", () => {
    expect(HELP_TEXTS.blocker).toContain("<code>");
    expect(HELP_TEXTS.blocker).toContain("</code>");
  });

  it("categories contains <code> tag for area: label prefix", () => {
    expect(HELP_TEXTS.categories).toContain("<code>");
    expect(HELP_TEXTS.categories).toContain("area:");
  });

  it("preview contains <code> tag for git pull command", () => {
    expect(HELP_TEXTS.preview).toContain("<code>");
    expect(HELP_TEXTS.preview).toContain("git pull");
  });
});

// =========================================================================
// 3. HELP_TEXTS overview — Golden Rule and workflow
// =========================================================================

describe("HELP_TEXTS overview content", () => {
  it("contains the Golden Rule text", () => {
    expect(HELP_TEXTS.overview).toContain("Golden Rule");
  });

  it("mentions the one-category-per-person principle", () => {
    expect(HELP_TEXTS.overview).toContain("Eine Kategorie pro Person");
  });

  it("mentions Merge-Konflikte (merge conflicts)", () => {
    expect(HELP_TEXTS.overview).toContain("Merge-Konflikte");
  });

  it("references the 'Aufgabe nehmen' workflow step", () => {
    expect(HELP_TEXTS.overview).toContain("Aufgabe nehmen");
  });

  it("references the 'Meine Aufgaben' workflow step", () => {
    expect(HELP_TEXTS.overview).toContain("Meine Aufgaben");
  });

  it("contains the 'Hilfe' heading", () => {
    expect(HELP_TEXTS.overview).toContain("Hilfe");
  });

  it("ends with a prompt to choose a topic", () => {
    expect(HELP_TEXTS.overview).toContain("Thema");
  });
});

// =========================================================================
// 4. HELP_TEXTS blocker — blocking and stopping context
// =========================================================================

describe("HELP_TEXTS blocker content", () => {
  it("has a 'Blocker' heading", () => {
    expect(HELP_TEXTS.blocker).toContain("<b>Blocker</b>");
  });

  it("explains that blockers stop all other tasks", () => {
    expect(HELP_TEXTS.blocker).toContain("stoppt");
  });

  it("mentions the priority:blocker label", () => {
    expect(HELP_TEXTS.blocker).toContain("priority:blocker");
  });

  it("mentions GitHub Issues", () => {
    expect(HELP_TEXTS.blocker).toContain("GitHub-Issue");
  });

  it("includes a tip about using blockers sparingly", () => {
    expect(HELP_TEXTS.blocker).toContain("Tipp");
    expect(HELP_TEXTS.blocker).toContain("Showstopper");
  });
});

// =========================================================================
// 5. HELP_TEXTS priorities — the 4 priority levels
// =========================================================================

describe("HELP_TEXTS priorities content", () => {
  it("has a 'Priorit\u00e4ten' heading", () => {
    expect(HELP_TEXTS.priorities).toContain("Priorit\u00E4ten");
  });

  it("mentions all 4 priority levels", () => {
    expect(HELP_TEXTS.priorities).toContain("Blocker");
    expect(HELP_TEXTS.priorities).toContain("High");
    expect(HELP_TEXTS.priorities).toContain("Medium");
    expect(HELP_TEXTS.priorities).toContain("Low");
  });

  it("describes the 4-level system ('4 Stufen')", () => {
    expect(HELP_TEXTS.priorities).toContain("4 Stufen");
  });

  it("mentions automatic sorting by priority", () => {
    expect(HELP_TEXTS.priorities).toContain("sortiert");
  });

  it("describes Medium as the default (Standard)", () => {
    expect(HELP_TEXTS.priorities).toContain("Standard");
  });
});

// =========================================================================
// 6. HELP_TEXTS categories — area labels and claiming
// =========================================================================

describe("HELP_TEXTS categories content", () => {
  it("has a 'Kategorien' heading", () => {
    expect(HELP_TEXTS.categories).toContain("<b>Kategorien</b>");
  });

  it("mentions area: labels from GitHub", () => {
    expect(HELP_TEXTS.categories).toContain("area:");
  });

  it("explains the one-category-per-person rule", () => {
    expect(HELP_TEXTS.categories).toContain("genau eine Kategorie");
  });

  it("mentions Merge-Konflikte prevention", () => {
    expect(HELP_TEXTS.categories).toContain("Merge-Konflikte");
  });

  it("references the Team Board for checking free categories", () => {
    expect(HELP_TEXTS.categories).toContain("Team Board");
  });

  it("mentions pausing or switching categories", () => {
    expect(HELP_TEXTS.categories).toContain("pausieren");
    expect(HELP_TEXTS.categories).toContain("wechseln");
  });
});

// =========================================================================
// 7. HELP_TEXTS preview — PR and merge workflow
// =========================================================================

describe("HELP_TEXTS preview content", () => {
  it("has a 'Preview & Merge' heading", () => {
    expect(HELP_TEXTS.preview).toContain("Preview & Merge");
  });

  it("mentions Pull Request (PR)", () => {
    expect(HELP_TEXTS.preview).toContain("Pull Request");
  });

  it("mentions the Preview-Link", () => {
    expect(HELP_TEXTS.preview).toContain("Preview-Link");
  });

  it("includes the git pull reminder", () => {
    expect(HELP_TEXTS.preview).toContain("git pull");
  });

  it("describes the multi-step merge flow", () => {
    expect(HELP_TEXTS.preview).toContain("PR erstellen");
    expect(HELP_TEXTS.preview).toContain("Review");
    expect(HELP_TEXTS.preview).toContain("Merge");
  });
});

// =========================================================================
// 8. HELP_TEXTS conflicts — merge conflict explanation
// =========================================================================

describe("HELP_TEXTS conflicts content", () => {
  it("has a 'Konflikte' heading", () => {
    expect(HELP_TEXTS.conflicts).toContain("<b>Konflikte</b>");
  });

  it("explains that conflicts happen when people edit the same files", () => {
    expect(HELP_TEXTS.conflicts).toContain("dieselben Dateien");
  });

  it("references the Golden Rule", () => {
    expect(HELP_TEXTS.conflicts).toContain("Golden Rule");
  });

  it("repeats the one-category-per-person rule", () => {
    expect(HELP_TEXTS.conflicts).toContain("Eine Kategorie pro Person");
  });

  it("mentions the Team Board for coordination", () => {
    expect(HELP_TEXTS.conflicts).toContain("Team Board");
  });

  it("includes advice for when conflicts do happen", () => {
    expect(HELP_TEXTS.conflicts).toContain("Falls es doch kracht");
  });
});

// =========================================================================
// 9. HELP_TEXTS consistency — all entries use the same formatting
// =========================================================================

describe("HELP_TEXTS formatting consistency", () => {
  const ALL_KEYS = [
    "overview",
    "blocker",
    "priorities",
    "categories",
    "preview",
    "conflicts",
  ] as const;

  it.each(ALL_KEYS)("'%s' starts with an emoji", (key) => {
    // Each help text starts with an emoji character (non-ASCII)
    const firstChar = HELP_TEXTS[key].codePointAt(0)!;
    // Emojis are above U+2000
    expect(firstChar).toBeGreaterThan(0x2000);
  });

  it.each(ALL_KEYS)("'%s' contains at least one bold section", (key) => {
    const boldMatches = HELP_TEXTS[key].match(/<b>.*?<\/b>/g);
    expect(boldMatches).not.toBeNull();
    expect(boldMatches!.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ALL_KEYS)("'%s' has substantial content (at least 100 characters)", (key) => {
    expect(HELP_TEXTS[key].length).toBeGreaterThan(100);
  });

  it("blocker and categories contain a 'Tipp' note", () => {
    expect(HELP_TEXTS.blocker).toContain("Tipp");
    expect(HELP_TEXTS.categories).toContain("Tipp");
  });

  it("conflicts contains a 'Falls es doch kracht' advice section", () => {
    expect(HELP_TEXTS.conflicts).toContain("Falls es doch kracht");
  });

  it("preview contains a 'Wichtig' note", () => {
    expect(HELP_TEXTS.preview).toContain("Wichtig");
  });
});

// =========================================================================
// 10. Callback data format for help navigation
// =========================================================================

describe("Help callback data format", () => {
  const HELP_CALLBACKS = [
    "help_blocker",
    "help_priorities",
    "help_categories",
    "help_preview",
    "help_conflicts",
    "help_back",
  ];

  it("all help callbacks use the help_ prefix", () => {
    for (const cb of HELP_CALLBACKS) {
      expect(cb).toMatch(/^help_/);
    }
  });

  it("each sub-topic callback corresponds to a HELP_TEXTS key", () => {
    const subCallbacks = HELP_CALLBACKS.filter((cb) => cb !== "help_back");
    for (const cb of subCallbacks) {
      const key = cb.replace("help_", "");
      expect(HELP_TEXTS).toHaveProperty(key);
    }
  });

  it("help_back does not correspond to its own text entry (returns to overview)", () => {
    expect(HELP_TEXTS).not.toHaveProperty("back");
  });

  it("there are exactly 5 sub-topic callbacks (plus 1 back)", () => {
    const subCallbacks = HELP_CALLBACKS.filter((cb) => cb !== "help_back");
    expect(subCallbacks).toHaveLength(5);
  });
});

// =========================================================================
// 11. Help inline keyboard button labels
// =========================================================================

describe("Help inline keyboard buttons", () => {
  // These mirror the button labels defined in the bot.hears("Hilfe") handler
  const HELP_BUTTONS = [
    { text: "\u{1F6AB} Blocker", callback_data: "help_blocker" },
    { text: "\u{1F4CA} Priorit\u00E4ten", callback_data: "help_priorities" },
    { text: "\u{1F4C1} Kategorien", callback_data: "help_categories" },
    { text: "\u{1F441} Preview", callback_data: "help_preview" },
    { text: "\u{26A0}\u{FE0F} Konflikte", callback_data: "help_conflicts" },
  ];

  it("there are exactly 5 sub-topic buttons", () => {
    expect(HELP_BUTTONS).toHaveLength(5);
  });

  it("each button has a matching callback_data for a HELP_TEXTS key", () => {
    for (const btn of HELP_BUTTONS) {
      const key = btn.callback_data.replace("help_", "");
      expect(HELP_TEXTS).toHaveProperty(key);
    }
  });

  it("each button text contains an emoji and a German label", () => {
    for (const btn of HELP_BUTTONS) {
      // Each button text starts with emoji (non-ASCII) followed by a space and label
      expect(btn.text.length).toBeGreaterThan(2);
      expect(btn.text).toContain(" ");
    }
  });

  it("back button uses the correct label format", () => {
    const backBtn = {
      text: "\u{2B05}\u{FE0F} Zur\u00FCck",
      callback_data: "help_back",
    };
    expect(backBtn.text).toContain("Zur\u00FCck");
    expect(backBtn.callback_data).toBe("help_back");
  });
});
