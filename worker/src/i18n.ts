/**
 * i18n — Internationalization system for the Cortex Team Bot.
 *
 * English is the default language. German available via /language de.
 * Strings are looked up synchronously via t(lang, key).
 * User language preference is stored in KV: lang:{telegramId}.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = "en" | "de";

export const SUPPORTED_LOCALES: Locale[] = ["en", "de"];
export const DEFAULT_LOCALE: Locale = "en";

// ---------------------------------------------------------------------------
// String tables
// ---------------------------------------------------------------------------

const en: Record<string, string> = {
  // Reply keyboard buttons
  "btn.claim_task": "\u{1F4CB} Claim Task",
  "btn.my_tasks": "\u{2705} My Tasks",
  "btn.team_board": "\u{1F465} Team Board",
  "btn.new_idea": "\u{1F4A1} New Idea",
  "btn.help": "\u{2753} Help",
  "btn.switch_project": "\u{1F504} Switch Project",

  // Category picker
  "picker.heading": "\u{1F4CB} <b>Claim Task</b>",
  "picker.subtitle": "Pick a category to claim all its open issues:",
  "picker.no_categories": "\u{1F4C2} No categories found.\n\nAdd labels with the <code>area:</code> prefix to your GitHub issues to create categories.",
  "picker.completed_section": "\u{2501} <b>Done ({count})</b> \u{2501}",
  "picker.show_completed": "\u{1F4CA} Show completed ({count})",
  "picker.hide_completed": "\u{1F4CA} Hide completed",
  "picker.no_closed_issues": "No closed issues found",
  "picker.free": "free",
  "picker.paused_by": "paused by {name} ({done}/{total} done)",
  "picker.override_blocker": "\u{26A0}\u{FE0F} Work anyway",
  "picker.cancel": "\u{274C} Cancel",

  // Blocker
  "blocker.heading": "\u{1F6A8} <b>Blocker active</b>",
  "blocker.resolve_first": "The following blocker issue(s) should be resolved first:",
  "blocker.soft_warning": "\u{26A0}\u{FE0F} <i>You can still claim a category, but be aware of potential merge conflicts.</i>",

  // Claim status
  "claim.already_have": "\u{26A0}\u{FE0F} You already have <b>{category}</b> ({count} issues).\n\nRelease your current category first before claiming a new one.",
  "claim.release_btn": "\u{1F5D1} Release Category",
  "claim.use_claim_task": "Use \u{1F4CB} <b>Claim Task</b> to claim a category first!",

  // My Tasks
  "tasks.heading": "\u{2705} <b>My Tasks, {name}</b>",
  "tasks.heading_error": "\u{2705} <b>My Tasks</b>",
  "tasks.pause": "\u{23F8} Pause",
  "tasks.all_done": "All open tasks are done! \u{1F389}",
  "tasks.no_tasks": "No tasks assigned to you.",
  "tasks.recently_completed": "\u{2705} <b>Recently completed ({count}):</b>",
  "tasks.assigned": "\u{1F4CB} <b>Assigned to you ({count}):</b>",
  "tasks.blocker_fix_first": "\u{1F6A8} <b>BLOCKER \u{2014} fix these first:</b>",
  "tasks.today_completed": "\u{1F3C6} Today completed: <b>{count}</b>",
  "tasks.today_time": "\u{23F1} Today: <b>{duration}</b>",
  "tasks.show_prompts": "\u{1F4CB} Show All Prompts",
  "tasks.refresh": "\u{1F504} Refresh",
  "tasks.create_preview": "\u{1F680} Create Preview",

  // New Idea wizard
  "idea.heading": "\u{1F4A1} <b>New Idea</b>",
  "idea.title_prompt": "Send me the title for your new issue:",
  "idea.desc_prompt": "\u{1F4DD} Briefly describe the problem or idea:",
  "idea.desc_skip_hint": "(Or press Skip for an issue without a description)",
  "idea.choose_priority": "Choose the priority:",
  "idea.choose_category": "Choose a category:",
  "idea.title_too_long": "\u{274C} Please enter a title (max. 256 characters).",
  "idea.desc_too_long": "\u{274C} The description is too long (max. 2000 characters). Please shorten it:",
  "idea.no_category_tip": "Issues without a category may be overlooked in the category picker.",

  // Help
  "help.heading": "\u{2753} <b>Help</b>",
  "help.choose_topic": "Choose a topic for more details:",
  "help.workflow_1": "1\u{FE0F}\u{20E3} Choose a category (<i>Claim Task</i>)",
  "help.workflow_2": "2\u{FE0F}\u{20E3} Work on tasks (<i>My Tasks</i>)",
  "help.workflow_3": "3\u{FE0F}\u{20E3} Create preview & merge",
  "help.workflow_4": "4\u{FE0F}\u{20E3} After merge: don't forget to pull!",
  "help.golden_rule": "\u{1F3C6} <b>Golden Rule:</b> One category per person = no merge conflicts!",

  "help.btn_blocker": "\u{1F6AB} Blocker",
  "help.btn_priorities": "\u{1F4CA} Priorities",
  "help.btn_categories": "\u{1F4C1} Categories",
  "help.btn_preview": "\u{1F441} Preview & Merge",
  "help.btn_conflicts": "\u{26A0}\u{FE0F} Conflicts",
  "help.btn_back": "\u{2B05}\u{FE0F} Back",

  "help.blocker_heading": "\u{1F6AB} <b>Blocker</b>",
  "help.blocker_desc": "A blocker is a critical issue that <b>stops all other tasks</b>.",
  "help.blocker_effect": "While a blocker is open, nobody can claim new categories.",
  "help.blocker_label": "Blockers are created as GitHub issues with the <code>priority:blocker</code> label.",
  "help.blocker_resolved": "Once the issue is closed, everything continues normally.",
  "help.blocker_tip": "\u{1F4A1} Tip: Use blockers only for real showstoppers \u{2014} not for normal bugs.",

  "help.priorities_heading": "\u{1F4CA} <b>Priorities</b>",
  "help.priorities_desc": "There are 4 levels, from urgent to low:",
  "help.priority_blocker": "\u{1F6A8} <b>Blocker</b> \u{2014} Stops everything, must be resolved immediately",
  "help.priority_high": "\u{1F534} <b>High</b> \u{2014} Important, should be worked on next",
  "help.priority_medium": "\u{1F7E1} <b>Medium</b> \u{2014} Normal task (default)",
  "help.priority_low": "\u{26AA} <b>Low</b> \u{2014} Can wait, nice-to-have",
  "help.priorities_sort": "Tasks are sorted by priority automatically. Higher priority = further up the list.",

  "help.categories_heading": "\u{1F4C1} <b>Categories</b>",
  "help.categories_desc": "Categories are based on the <code>area:</code> labels of your GitHub issues.",
  "help.categories_rule": "Each person claims exactly one category \u{2014} this prevents merge conflicts.",
  "help.categories_how": "Here's how it works:",
  "help.categories_step1": "Claim Task \u{2192} Choose category \u{2192} Issues get assigned to you",
  "help.categories_step2": "When you're done: release the category so others can claim it",
  "help.categories_step3": "You can pause or switch your category at any time",
  "help.categories_tip": "\u{1F4A1} Tip: Check the Team Board for available categories.",

  "help.preview_heading": "\u{1F441} <b>Preview & Merge</b>",
  "help.preview_desc": "When your code is ready, create a Pull Request (PR) on GitHub.",
  "help.preview_link": "The bot shows you a preview link so you can test your changes.",
  "help.preview_process": "<b>Process:</b>",
  "help.preview_step1": "1. Push code \u{2192} Create PR",
  "help.preview_step2": "2. Check preview link",
  "help.preview_step3": "3. In Team Board: Request review",
  "help.preview_step4": "4. After approval: Perform merge",
  "help.preview_step5": "5. Important: Don't forget to <code>git pull</code> locally after merge!",

  "help.conflicts_heading": "\u{26A0}\u{FE0F} <b>Conflicts</b>",
  "help.conflicts_desc": "Merge conflicts happen when two people edit the same files simultaneously.",
  "help.conflicts_rule": "That's why the Golden Rule applies: One category per person.",
  "help.conflicts_group": "Categories group issues that affect similar files.",
  "help.conflicts_benefit": "If everyone has their own category, you work on different files \u{2014} and conflicts are avoided.",
  "help.conflicts_fallback": "If conflicts occur anyway: Coordinate in the team who edits which file.",
  "help.conflicts_tip": "The bot shows you in the Team Board who has which category.",

  // Contextual tips
  "tip.category_taken": "\n\n\u{1F4A1} <i>Tip: Each category belongs to one person \u{2014} that's how we avoid merge conflicts.</i>",
  "tip.blocker_active": "\n\n\u{1F4A1} <i>Tip: While a blocker is open, all category claims are paused.</i>",
  "tip.already_has_category": "\n\n\u{1F4A1} <i>Tip: Release your current category before claiming a new one.</i>",
  "tip.self_approve_large": "\n\n\u{1F4A1} <i>Tip: For large PRs, a peer review is recommended even when self-approval is possible.</i>",
  "tip.all_tasks_done": "\n\n\u{1F389} All tasks done! Claim a new category or create new ideas.",
  "tip.no_tasks_assigned": "\n\n\u{1F4A1} <i>Tip: Use \"Claim Task\" to claim a category.</i>",
  "tip.forgot_to_pull": "\n\n\u{1F4A1} <i>Tip: After every merge \u{2014} don't forget to git pull!</i>",
  "tip.category_empty": "\n\n\u{1F4A1} <i>Tip: This category has no open issues. Create new ideas with \"New Idea\"!</i>",

  // Slash commands
  "cmd.new_usage": "Please provide a title: /new My new task",
  "cmd.new_no_token": "No GitHub token configured. Issues cannot be created.",
  "cmd.new_error": "Error creating issue: {status}",
  "cmd.new_success": "Task created: #{number} {title}",
  "cmd.assign_usage": "Usage: /assign #3 @name",
  "cmd.assign_no_token": "No GitHub token configured.",
  "cmd.assign_parse_issue": "Could not parse the issue number. Example: /assign #3 @name",
  "cmd.assign_parse_name": "Could not parse the name. Example: /assign #3 @name",
  "cmd.assign_error": "Error assigning: {status}",
  "cmd.assign_success": "Task #{number} assigned to {username}",
  "cmd.done_usage": "Usage: /done #3",
  "cmd.done_no_token": "No GitHub token configured.",
  "cmd.done_parse": "Could not parse the issue number. Example: /done #3",
  "cmd.done_error": "Error closing: {status}",
  "cmd.done_success": "Task #{number} done \u{2014} Ready for Review",
  "cmd.active_heading": "Active Sessions:",
  "cmd.active_line": "{user} (since {since})",

  // Language command
  "lang.current": "Current language: <b>{lang}</b>",
  "lang.switched": "\u{2705} Language switched to <b>{lang}</b>.",
  "lang.usage": "Usage: /language en or /language de",
  "lang.unsupported": "Unsupported language. Available: en, de",
};

const de: Record<string, string> = {
  // Reply keyboard buttons
  "btn.claim_task": "\u{1F4CB} Aufgabe nehmen",
  "btn.my_tasks": "\u{2705} Meine Aufgaben",
  "btn.team_board": "\u{1F465} Team Board",
  "btn.new_idea": "\u{1F4A1} Neue Idee",
  "btn.help": "\u{2753} Hilfe",
  "btn.switch_project": "\u{1F504} Projekt wechseln",

  // Category picker
  "picker.heading": "\u{1F4CB} <b>Aufgabe nehmen</b>",
  "picker.subtitle": "W\u00e4hle eine Kategorie um alle offenen Issues zu beanspruchen:",
  "picker.no_categories": "\u{1F4C2} Keine Kategorien gefunden.\n\nF\u00fcge Labels mit dem <code>area:</code>-Pr\u00e4fix zu deinen GitHub-Issues hinzu.",
  "picker.completed_section": "\u{2501} <b>Erledigt ({count})</b> \u{2501}",
  "picker.show_completed": "\u{1F4CA} Erledigte anzeigen ({count})",
  "picker.hide_completed": "\u{1F4CA} Erledigte ausblenden",
  "picker.no_closed_issues": "Keine geschlossenen Issues gefunden",
  "picker.free": "frei",
  "picker.paused_by": "pausiert von {name} ({done}/{total} fertig)",
  "picker.override_blocker": "\u{26A0}\u{FE0F} Trotzdem arbeiten",
  "picker.cancel": "\u{274C} Abbrechen",

  // Blocker
  "blocker.heading": "\u{1F6A8} <b>Blocker aktiv</b>",
  "blocker.resolve_first": "Folgende Blocker-Issues sollten zuerst gel\u00f6st werden:",
  "blocker.soft_warning": "\u{26A0}\u{FE0F} <i>Du kannst trotzdem eine Kategorie beanspruchen, aber achte auf m\u00f6gliche Merge-Konflikte.</i>",

  // Claim status
  "claim.already_have": "\u{26A0}\u{FE0F} Du hast bereits <b>{category}</b> ({count} Issues).\n\nGib deine aktuelle Kategorie frei, bevor du eine neue nimmst.",
  "claim.release_btn": "\u{1F5D1} Kategorie freigeben",
  "claim.use_claim_task": "Nutze \u{1F4CB} <b>Aufgabe nehmen</b> um eine Kategorie zu beanspruchen!",

  // My Tasks
  "tasks.heading": "\u{2705} <b>Meine Aufgaben, {name}</b>",
  "tasks.heading_error": "\u{2705} <b>Meine Aufgaben</b>",
  "tasks.pause": "\u{23F8} Pause",
  "tasks.all_done": "Alle Aufgaben erledigt! \u{1F389}",
  "tasks.no_tasks": "Keine Aufgaben zugewiesen.",
  "tasks.recently_completed": "\u{2705} <b>K\u00fcrzlich erledigt ({count}):</b>",
  "tasks.assigned": "\u{1F4CB} <b>Dir zugewiesen ({count}):</b>",
  "tasks.blocker_fix_first": "\u{1F6A8} <b>BLOCKER \u{2014} zuerst beheben:</b>",
  "tasks.today_completed": "\u{1F3C6} Heute erledigt: <b>{count}</b>",
  "tasks.today_time": "\u{23F1} Heute: <b>{duration}</b>",
  "tasks.show_prompts": "\u{1F4CB} Alle Prompts anzeigen",
  "tasks.refresh": "\u{1F504} Aktualisieren",
  "tasks.create_preview": "\u{1F680} Preview erstellen",

  // New Idea wizard
  "idea.heading": "\u{1F4A1} <b>Neue Idee</b>",
  "idea.title_prompt": "Schick mir den Titel f\u00fcr dein neues Issue:",
  "idea.desc_prompt": "\u{1F4DD} Beschreibe kurz das Problem oder die Idee:",
  "idea.desc_skip_hint": "(Oder dr\u00fccke Skip f\u00fcr ein Issue ohne Beschreibung)",
  "idea.choose_priority": "W\u00e4hle die Priorit\u00e4t:",
  "idea.choose_category": "W\u00e4hle eine Kategorie:",
  "idea.title_too_long": "\u{274C} Bitte gib einen Titel ein (max. 256 Zeichen).",
  "idea.desc_too_long": "\u{274C} Die Beschreibung ist zu lang (max. 2000 Zeichen). Bitte k\u00fcrzen:",
  "idea.no_category_tip": "Issues ohne Kategorie werden im Kategorie-Picker m\u00f6glicherweise \u00fcbersehen.",

  // Help
  "help.heading": "\u{2753} <b>Hilfe</b>",
  "help.choose_topic": "W\u00e4hle ein Thema f\u00fcr mehr Details:",
  "help.workflow_1": "1\u{FE0F}\u{20E3} Kategorie w\u00e4hlen (<i>Aufgabe nehmen</i>)",
  "help.workflow_2": "2\u{FE0F}\u{20E3} Tasks bearbeiten (<i>Meine Aufgaben</i>)",
  "help.workflow_3": "3\u{FE0F}\u{20E3} Preview erstellen & mergen",
  "help.workflow_4": "4\u{FE0F}\u{20E3} Nach Merge: pull nicht vergessen!",
  "help.golden_rule": "\u{1F3C6} <b>Golden Rule:</b> Eine Kategorie pro Person = keine Merge-Konflikte!",

  "help.btn_blocker": "\u{1F6AB} Blocker",
  "help.btn_priorities": "\u{1F4CA} Priorit\u00e4ten",
  "help.btn_categories": "\u{1F4C1} Kategorien",
  "help.btn_preview": "\u{1F441} Preview & Merge",
  "help.btn_conflicts": "\u{26A0}\u{FE0F} Konflikte",
  "help.btn_back": "\u{2B05}\u{FE0F} Zur\u00fcck",

  "help.blocker_heading": "\u{1F6AB} <b>Blocker</b>",
  "help.blocker_desc": "Ein Blocker ist ein kritisches Problem, das <b>alle anderen Aufgaben stoppt</b>.",
  "help.blocker_effect": "Solange ein Blocker offen ist, kann niemand neue Kategorien beanspruchen.",
  "help.blocker_label": "Blocker werden als GitHub-Issue mit dem Label <code>priority:blocker</code> erstellt.",
  "help.blocker_resolved": "Sobald das Issue geschlossen wird, l\u00e4uft alles wieder normal weiter.",
  "help.blocker_tip": "\u{1F4A1} Tipp: Blocker nur f\u00fcr echte Showstopper verwenden \u{2014} nicht f\u00fcr normale Bugs.",

  "help.priorities_heading": "\u{1F4CA} <b>Priorit\u00e4ten</b>",
  "help.priorities_desc": "Es gibt 4 Stufen, von dringend bis niedrig:",
  "help.priority_blocker": "\u{1F6A8} <b>Blocker</b> \u{2014} Stoppt alles, muss sofort gel\u00f6st werden",
  "help.priority_high": "\u{1F534} <b>High</b> \u{2014} Wichtig, sollte als n\u00e4chstes bearbeitet werden",
  "help.priority_medium": "\u{1F7E1} <b>Medium</b> \u{2014} Normaler Task (Standard)",
  "help.priority_low": "\u{26AA} <b>Low</b> \u{2014} Kann warten, nice-to-have",
  "help.priorities_sort": "Tasks werden automatisch nach Priorit\u00e4t sortiert. H\u00f6here Priorit\u00e4t = weiter oben in der Liste.",

  "help.categories_heading": "\u{1F4C1} <b>Kategorien</b>",
  "help.categories_desc": "Kategorien basieren auf den <code>area:</code>-Labels deiner GitHub-Issues.",
  "help.categories_rule": "Jede Person beansprucht genau eine Kategorie \u{2014} das verhindert Merge-Konflikte.",
  "help.categories_how": "So funktioniert's:",
  "help.categories_step1": "Aufgabe nehmen \u{2192} Kategorie w\u00e4hlen \u{2192} Issues werden dir zugewiesen",
  "help.categories_step2": "Wenn du fertig bist: Kategorie freigeben, damit andere sie nehmen k\u00f6nnen",
  "help.categories_step3": "Du kannst deine Kategorie jederzeit pausieren oder wechseln",
  "help.categories_tip": "\u{1F4A1} Tipp: Pr\u00fcfe im Team Board, welche Kategorien frei sind.",

  "help.preview_heading": "\u{1F441} <b>Preview & Merge</b>",
  "help.preview_desc": "Wenn dein Code fertig ist, erstellst du einen Pull Request (PR) auf GitHub.",
  "help.preview_link": "Der Bot zeigt dir einen Preview-Link, damit du deine \u00c4nderungen testen kannst.",
  "help.preview_process": "<b>Ablauf:</b>",
  "help.preview_step1": "1. Code pushen \u{2192} PR erstellen",
  "help.preview_step2": "2. Preview-Link pr\u00fcfen",
  "help.preview_step3": "3. Im Team Board: Review anfordern",
  "help.preview_step4": "4. Nach Approval: Merge durchf\u00fchren",
  "help.preview_step5": "5. Wichtig: Nach dem Merge lokal <code>git pull</code> nicht vergessen!",

  "help.conflicts_heading": "\u{26A0}\u{FE0F} <b>Konflikte</b>",
  "help.conflicts_desc": "Merge-Konflikte entstehen, wenn zwei Personen dieselben Dateien gleichzeitig bearbeiten.",
  "help.conflicts_rule": "Deshalb gilt die Golden Rule: Eine Kategorie pro Person.",
  "help.conflicts_group": "Kategorien gruppieren Issues, die \u00e4hnliche Dateien betreffen.",
  "help.conflicts_benefit": "Wenn jeder seine eigene Kategorie hat, arbeitet ihr an verschiedenen Dateien \u{2014} und Konflikte werden vermieden.",
  "help.conflicts_fallback": "Falls es doch kracht: Sprecht euch im Team ab, wer welche Datei anpasst.",
  "help.conflicts_tip": "Der Bot zeigt euch im Team Board, wer welche Kategorie hat.",

  // Contextual tips
  "tip.category_taken": "\n\n\u{1F4A1} <i>Tipp: Jede Kategorie geh\u00f6rt einer Person \u{2014} so vermeiden wir Merge-Konflikte.</i>",
  "tip.blocker_active": "\n\n\u{1F4A1} <i>Tipp: Solange ein Blocker offen ist, sind alle Kategorie-Claims pausiert.</i>",
  "tip.already_has_category": "\n\n\u{1F4A1} <i>Tipp: Gib deine aktuelle Kategorie frei, bevor du eine neue nimmst.</i>",
  "tip.self_approve_large": "\n\n\u{1F4A1} <i>Tipp: Bei gro\u00dfen PRs ist ein Peer-Review empfohlen, auch wenn Self-Approve m\u00f6glich ist.</i>",
  "tip.all_tasks_done": "\n\n\u{1F389} Alle Aufgaben erledigt! Nimm eine neue Kategorie oder erstelle neue Ideen.",
  "tip.no_tasks_assigned": "\n\n\u{1F4A1} <i>Tipp: Nutze \"Aufgabe nehmen\" um eine Kategorie zu beanspruchen.</i>",
  "tip.forgot_to_pull": "\n\n\u{1F4A1} <i>Tipp: Nach jedem Merge \u{2014} git pull nicht vergessen!</i>",
  "tip.category_empty": "\n\n\u{1F4A1} <i>Tipp: Diese Kategorie hat keine offenen Issues. Erstelle neue Ideen mit \"Neue Idee\"!</i>",

  // Slash commands
  "cmd.new_usage": "Bitte einen Titel angeben: /new Mein neuer Task",
  "cmd.new_no_token": "Kein GitHub-Token konfiguriert. Issues k\u00f6nnen nicht erstellt werden.",
  "cmd.new_error": "Fehler beim Erstellen: {status}",
  "cmd.new_success": "Task erstellt: #{number} {title}",
  "cmd.assign_usage": "Nutzung: /assign #3 @name",
  "cmd.assign_no_token": "Kein GitHub-Token konfiguriert.",
  "cmd.assign_parse_issue": "Konnte die Issue-Nummer nicht lesen. Beispiel: /assign #3 @name",
  "cmd.assign_parse_name": "Konnte den Namen nicht lesen. Beispiel: /assign #3 @name",
  "cmd.assign_error": "Fehler beim Zuweisen: {status}",
  "cmd.assign_success": "Task #{number} zugewiesen an {username}",
  "cmd.done_usage": "Nutzung: /done #3",
  "cmd.done_no_token": "Kein GitHub-Token konfiguriert.",
  "cmd.done_parse": "Konnte die Issue-Nummer nicht lesen. Beispiel: /done #3",
  "cmd.done_error": "Fehler beim Schlie\u00dfen: {status}",
  "cmd.done_success": "Task #{number} erledigt \u{2014} Ready for Review",
  "cmd.active_heading": "Aktive Sessions:",
  "cmd.active_line": "{user} (seit {since})",

  // Language command
  "lang.current": "Aktuelle Sprache: <b>{lang}</b>",
  "lang.switched": "\u{2705} Sprache ge\u00e4ndert zu <b>{lang}</b>.",
  "lang.usage": "Nutzung: /language en oder /language de",
  "lang.unsupported": "Nicht unterst\u00fctzte Sprache. Verf\u00fcgbar: en, de",
};

// ---------------------------------------------------------------------------
// Locale registry
// ---------------------------------------------------------------------------

const locales: Record<Locale, Record<string, string>> = { en, de };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a translated string. Falls back to English, then to the key itself.
 * Supports {param} interpolation.
 */
export function t(
  lang: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const template = locales[lang]?.[key] ?? locales.en[key] ?? key;
  if (!params) return template;
  return Object.entries(params).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    template
  );
}

/**
 * Read the user's language preference from KV. Defaults to English.
 */
export async function getUserLanguage(
  kv: KVNamespace,
  telegramId: number
): Promise<Locale> {
  const lang = await kv.get(`lang:${telegramId}`);
  if (lang === "de") return "de";
  return "en";
}

/**
 * Store the user's language preference in KV.
 */
export async function setUserLanguage(
  kv: KVNamespace,
  telegramId: number,
  lang: Locale
): Promise<void> {
  await kv.put(`lang:${telegramId}`, lang);
}
