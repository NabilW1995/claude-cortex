/**
 * Cortex Team Bot — Cloudflare Worker
 *
 * Central hub connecting Telegram, GitHub, and Claude sessions.
 * Handles bot commands via webhook (using grammy), GitHub events,
 * and session tracking.
 *
 * grammy handles incoming Telegram webhooks with typed middleware.
 * Outgoing messages from external triggers (hooks, GitHub, cron)
 * still use the direct sendTelegram helper.
 */

import { Bot, webhookCallback, Keyboard, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  PROJECTS: KVNamespace;
  DB: D1Database;
  GITHUB_WEBHOOK_SECRET?: string;
  TEAM_BOT_SECRET?: string;
  GITHUB_API_TOKEN?: string;
}

interface ProjectConfig {
  botToken: string;
  chatId: string;
  threadId?: number;
  loginThreadId?: number | null;
  loginChatId?: string | null;
  githubRepo: string;
  githubToken?: string;
  members: Array<{ name: string; github: string; telegram: string }>;
}

interface TeamMember {
  telegram_id: number;
  telegram_username: string;
  github: string;
  name: string;
}

interface ActiveSession {
  user: string;
  since: string;
}

interface DashboardState {
  messageId: number | null; // Telegram message_id for editing
  activeSessions: Array<{ user: string; since: string; tasks: number[] }>;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// User Preferences & Category Assignment types
// ---------------------------------------------------------------------------

interface UserPreferences {
  commits: boolean;
  previews: boolean;
  tasks: boolean;
  pr_reviews: boolean;
  sessions: boolean;
  dm_chat_id: number | null;
  updated_at: string;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  commits: false,
  previews: false,
  tasks: true,
  pr_reviews: false,
  sessions: false,
  dm_chat_id: null,
  updated_at: new Date().toISOString(),
};

interface CategoryClaim {
  telegramId: number;
  telegramName: string;
  githubUsername: string;
  category: string;
  displayName: string;
  assignedIssues: number[];
  claimedAt: string;
}

interface CategoryClaimsState {
  claims: CategoryClaim[];
  lastUpdated: string;
}

/**
 * Tracks a category that was paused (not released) — the branch stays on
 * GitHub so the next developer can continue from where the previous one
 * stopped.  Stored as a list in KV under `{projectId}:paused_categories`.
 */
interface PausedCategory {
  category: string;
  displayName: string;
  pausedBy: string;
  completedTasks: number;
  totalTasks: number;
  pausedAt: string;
}

/**
 * Tracks an active category timer for time-tracking purposes.
 * Stored in KV under `timer:{telegramId}:{projectId}` so it survives
 * bot restarts.  (Issue #60)
 */
interface TimerState {
  category: string;
  startedAt: string;
}

/**
 * A conversation thread between two team members via the bot.
 * Stored in KV with a 24h TTL so threads auto-expire.
 */
interface MessageThread {
  senderTelegramId: number;
  senderName: string;
  recipientTelegramId: number;
  recipientName: string;
  originalMessage: string;
  issueNumber?: number;
  createdAt: string;
}

/**
 * A snapshot of weekly velocity data for a project.
 * Stored in D1 velocity table every Friday via cron. (Issue #61)
 */
interface VelocitySnapshot {
  project: string;
  weekStart: string;
  tasksCompleted: number;
  tasksOpened: number;
  teamHours: number;
  perMember: Array<{ userId: string; name: string; tasks: number; hours: number }>;
  fastestTask: { number: number; title: string; minutes: number } | null;
  longestTask: { number: number; title: string; minutes: number } | null;
}

interface GitHubIssuesPayload {
  action: string;
  issue: {
    number: number;
    title: string;
    assignee?: { login: string } | null;
    html_url: string;
    labels?: Array<{ name: string }>;
  };
  label?: { name: string };
  sender: { login: string };
}

interface GitHubPRPayload {
  action: string;
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    user: { login: string };
    draft: boolean;
    additions: number;
    deletions: number;
    changed_files: number;
    commits: number;
    merged: boolean;
    base: { ref: string };
    head: { ref: string };
  };
  sender: { login: string };
}

interface GitHubReviewPayload {
  action: string;
  review: {
    state: string; // "approved", "changes_requested", "commented"
    html_url: string;
    user: { login: string };
  };
  pull_request: {
    number: number;
    title: string;
    user: { login: string };
  };
  sender: { login: string };
}

interface GitHubPushPayload {
  ref: string;
  commits: Array<{ message: string }>;
  pusher: { name: string };
}

interface GitHubWorkflowPayload {
  action: string;
  workflow_run: {
    name: string;
    conclusion: string; // "success", "failure", etc.
    html_url: string;
    head_branch: string;
  };
  sender: { login: string };
}

interface SessionUpdate {
  type: "start" | "end" | "heartbeat";
  user: string;
  branch?: string;
  lastFiles?: string[];
  lastCommit?: string;
  project?: string;
}

interface RegisterPayload {
  projectId: string;
  botToken: string;
  chatId: string;
  threadId?: number;
  loginThreadId?: number | null;
  loginChatId?: string | null;
  githubRepo: string;
  githubToken?: string;
  members: Array<{ name: string; github: string; telegram: string }>;
}

// ---------------------------------------------------------------------------
// Priority system — 4-level labels used on GitHub issues
// ---------------------------------------------------------------------------

/** Maps GitHub priority label names to numeric sort weight (lower = higher priority). */
const PRIORITY_LEVELS: Record<string, number> = {
  "priority:blocker": 0,
  "priority:high": 1,
  "priority:medium": 2,
  "priority:low": 3,
};

const PRIORITY_EMOJIS: Record<string, string> = {
  "priority:blocker": "\u{1F6A8}",
  "priority:high": "\u{1F534}",
  "priority:medium": "\u{1F7E1}",
  "priority:low": "\u{26AA}",
};

const PRIORITY_DEFAULT = "priority:medium";

// ---------------------------------------------------------------------------
// Help system — central text registry for the help view (foundation for #65)
// ---------------------------------------------------------------------------

/**
 * Central registry of all help texts displayed in the bot's help view.
 * Each key maps to a focused explanation shown via inline keyboard navigation.
 * All texts use HTML parse_mode and are written in German (matching the bot UI).
 */
const HELP_TEXTS = {
  overview:
    "\u{2753} <b>Hilfe</b>\n\n" +
    "<b>Workflow:</b>\n" +
    "1\u{FE0F}\u{20E3} Kategorie w\u{00E4}hlen (<i>Aufgabe nehmen</i>)\n" +
    "2\u{FE0F}\u{20E3} Tasks bearbeiten (<i>Meine Aufgaben</i>)\n" +
    "3\u{FE0F}\u{20E3} Preview erstellen &amp; mergen\n" +
    "4\u{FE0F}\u{20E3} Nach Merge: pull nicht vergessen!\n\n" +
    "\u{1F3C6} <b>Golden Rule:</b> Eine Kategorie pro Person = keine Merge-Konflikte!\n\n" +
    "W\u{00E4}hle ein Thema f\u{00FC}r mehr Details:",

  blocker:
    "\u{1F6AB} <b>Blocker</b>\n\n" +
    "Ein Blocker ist ein kritisches Problem, das <b>alle anderen Aufgaben stoppt</b>. " +
    "Solange ein Blocker offen ist, kann niemand neue Kategorien beanspruchen.\n\n" +
    "Blocker werden als GitHub-Issue mit dem Label <code>priority:blocker</code> erstellt. " +
    "Sobald das Issue geschlossen wird, l\u{00E4}uft alles wieder normal weiter.\n\n" +
    "\u{1F4A1} <b>Tipp:</b> Blocker nur f\u{00FC}r echte Showstopper verwenden \u{2014} " +
    "nicht f\u{00FC}r normale Bugs.",

  priorities:
    "\u{1F4CA} <b>Priorit\u{00E4}ten</b>\n\n" +
    "Es gibt 4 Stufen, von dringend bis niedrig:\n\n" +
    "\u{1F6A8} <b>Blocker</b> \u{2014} Stoppt alles, muss sofort gel\u{00F6}st werden\n" +
    "\u{1F534} <b>High</b> \u{2014} Wichtig, sollte als n\u{00E4}chstes bearbeitet werden\n" +
    "\u{1F7E1} <b>Medium</b> \u{2014} Normaler Task (Standard)\n" +
    "\u{26AA} <b>Low</b> \u{2014} Kann warten, nice-to-have\n\n" +
    "Tasks werden automatisch nach Priorit\u{00E4}t sortiert. " +
    "H\u{00F6}here Priorit\u{00E4}t = weiter oben in der Liste.",

  categories:
    "\u{1F4C1} <b>Kategorien</b>\n\n" +
    "Kategorien basieren auf den <code>area:</code>-Labels deiner GitHub-Issues. " +
    "Jede Person beansprucht <b>genau eine Kategorie</b> \u{2014} das verhindert Merge-Konflikte.\n\n" +
    "<b>So funktioniert\u{2019}s:</b>\n" +
    "\u{2022} <i>Aufgabe nehmen</i> \u{2192} Kategorie w\u{00E4}hlen \u{2192} Issues werden dir zugewiesen\n" +
    "\u{2022} Wenn du fertig bist: Kategorie freigeben, damit andere sie nehmen k\u{00F6}nnen\n" +
    "\u{2022} Du kannst deine Kategorie jederzeit pausieren oder wechseln\n\n" +
    "\u{1F4A1} <b>Tipp:</b> Pr\u{00FC}fe im Team Board, welche Kategorien frei sind.",

  preview:
    "\u{1F441} <b>Preview &amp; Merge</b>\n\n" +
    "Wenn dein Code fertig ist, erstellst du einen Pull Request (PR) auf GitHub. " +
    "Der Bot zeigt dir einen Preview-Link, damit du deine \u{00C4}nderungen testen kannst.\n\n" +
    "<b>Ablauf:</b>\n" +
    "1. Code pushen \u{2192} PR erstellen\n" +
    "2. Preview-Link pr\u{00FC}fen\n" +
    "3. Im Team Board: Review anfordern\n" +
    "4. Nach Approval: Merge durchf\u{00FC}hren\n" +
    "5. <b>Wichtig:</b> Nach dem Merge lokal <code>git pull</code> nicht vergessen!",

  conflicts:
    "\u{26A0}\u{FE0F} <b>Konflikte</b>\n\n" +
    "Merge-Konflikte entstehen, wenn zwei Personen <b>dieselben Dateien</b> gleichzeitig bearbeiten. " +
    "Deshalb gilt die Golden Rule: <b>Eine Kategorie pro Person.</b>\n\n" +
    "Kategorien gruppieren Issues, die \u{00E4}hnliche Dateien betreffen. " +
    "Wenn jeder seine eigene Kategorie hat, arbeitet ihr an verschiedenen Dateien \u{2014} " +
    "und Konflikte werden vermieden.\n\n" +
    "\u{1F4A1} <b>Falls es doch kracht:</b> Sprecht euch im Team ab, wer welche Datei anpasst. " +
    "Der Bot zeigt euch im Team Board, wer welche Kategorie hat.",
};

// ---------------------------------------------------------------------------
// GitHub webhook signature verification (HMAC-SHA256)
// ---------------------------------------------------------------------------

/**
 * Verify that a GitHub webhook payload was signed with the expected secret.
 * Uses the Web Crypto API (available in Cloudflare Workers) to compute
 * HMAC-SHA256 and compares it against the X-Hub-Signature-256 header.
 *
 * Returns false if the signature is missing or does not match.
 */
async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected =
    "sha256=" +
    [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  // Constant-length comparison: both strings are hex-encoded SHA-256 hashes
  // so they always have the same length when format is correct.
  if (expected.length !== signature.length) return false;

  // Compare every character to avoid timing attacks
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GitHub token helper — prefers Worker Secret over KV-stored token
// ---------------------------------------------------------------------------

function getGitHubToken(env: Env, project: ProjectConfig): string | undefined {
  return env.GITHUB_API_TOKEN || project.githubToken;
}

// ---------------------------------------------------------------------------
// Auth helper — protects sensitive endpoints
// ---------------------------------------------------------------------------

function verifyBotSecret(request: Request, env: Env): boolean {
  if (!env.TEAM_BOT_SECRET) return true; // No secret configured = dev mode
  const auth = request.headers.get("Authorization");
  return auth === `Bearer ${env.TEAM_BOT_SECRET}`;
}

/**
 * Validate that a URL string uses a safe scheme (http or https).
 * Returns null if the URL is invalid or uses a dangerous scheme
 * (e.g. javascript:, data:, vbscript:).
 */
function sanitizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quiet Hours + DND helpers
// ---------------------------------------------------------------------------

function isQuietHours(): boolean {
  const berlinHour = parseInt(
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Berlin" }),
    10
  );
  return berlinHour >= 22 || berlinHour < 7;
}

function isUrgentEvent(eventType: string, labels?: string[]): boolean {
  if (eventType.includes("failure") || eventType.includes("failed")) return true;
  if (labels?.some((l) => ["urgent", "blocked", "critical"].includes(l.toLowerCase()))) return true;
  if (eventType.includes("escalation")) return true;
  return false;
}

async function isUserDND(kv: KVNamespace, telegramId: number): Promise<boolean> {
  const dnd = await kv.get(`dnd:${telegramId}`);
  return dnd !== null; // KV TTL auto-deletes when DND expires
}

/**
 * Escape user-controlled strings for safe insertion into Telegram HTML messages.
 * Telegram's HTML mode only requires &, <, > to be escaped.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Telegram helpers (for OUTGOING messages from hooks/GitHub/cron)
// ---------------------------------------------------------------------------

/**
 * Send a plain-text message to the project's Telegram chat/topic.
 * Used by external triggers (session hooks, GitHub webhooks) that
 * operate outside the grammy middleware pipeline.
 */
async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  threadId?: number
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };

  if (threadId) {
    body.message_thread_id = threadId;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Send a Telegram message with optional reply-to-message threading.
 * Returns the sent message's ID so it can be stored for future replies.
 *
 * - threadId: the topic/forum thread (message_thread_id) for supergroups
 * - replyToMessageId: if set, the new message becomes a reply to this one
 * - allow_sending_without_reply: ensures the message is still sent even
 *   if the original message was deleted
 */
async function sendTelegramThreaded(
  botToken: string,
  chatId: string,
  text: string,
  threadId?: number,
  replyToMessageId?: number | null,
  inlineKeyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>
): Promise<number | null> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (threadId) body.message_thread_id = threadId;
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId;
  body.allow_sending_without_reply = true;
  if (inlineKeyboard) body.reply_markup = { inline_keyboard: inlineKeyboard };

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    }
  );
  const result = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };
  return result.ok ? result.result?.message_id ?? null : null;
}

// ---------------------------------------------------------------------------
// DM helper — send private messages to individual team members
// ---------------------------------------------------------------------------

/**
 * Send a private message (DM) to a Telegram user by their chat_id.
 * Returns a status string so callers can distinguish permanent failures
 * (user blocked the bot → 403) from transient errors.
 *
 * - 'sent'    — message delivered successfully
 * - 'blocked' — user blocked the bot (HTTP 403); caller should clear dm_chat_id
 * - 'error'   — transient failure (network, rate-limit, etc.); safe to retry later
 */
async function sendDM(
  botToken: string,
  chatId: number,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> }
): Promise<"sent" | "blocked" | "error"> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      }
    );
    const result = (await res.json()) as { ok: boolean };
    if (result.ok) return "sent";
    // 403 = bot was blocked by user or chat was deleted
    if (res.status === 403) return "blocked";
    return "error";
  } catch {
    return "error";
  }
}

// ---------------------------------------------------------------------------
// DM Notification Engine — send DMs to subscribers of a notification type
// ---------------------------------------------------------------------------

/**
 * Iterate team members, check their preferences and DND status, and send
 * DMs to everyone subscribed to a given notification type.
 *
 * IMPORTANT: The textFn callback is responsible for escaping user-controlled
 * strings with escapeHtml() — this function sends the text as-is with
 * parse_mode: "HTML".
 *
 * @param env - Worker environment (KV, DB)
 * @param botToken - Telegram bot token
 * @param prefField - Which preference field to check (e.g. "commits", "pr_reviews")
 * @param textFn - Function that returns the message text for a given member
 * @param exclude - Optional telegram_id to skip (e.g. the actor who triggered the event)
 */
async function notifySubscribers(
  env: Env,
  botToken: string,
  prefField: keyof UserPreferences,
  textFn: (member: TeamMember) => string,
  exclude?: number
): Promise<void> {
  const members = await getTeamMembers(env.PROJECTS);

  for (const member of members) {
    // Skip the actor who triggered the event
    if (exclude && member.telegram_id === exclude) continue;

    // Check DND status
    const dnd = await isUserDND(env.PROJECTS, member.telegram_id);
    if (dnd) continue;

    // Load preferences
    const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);

    // Check if this notification type is enabled
    if (!prefs[prefField]) continue;

    // Need a dm_chat_id to send DMs
    if (!prefs.dm_chat_id) continue;

    const text = textFn(member);
    const status = await sendDM(botToken, prefs.dm_chat_id, text);

    if (status === "blocked") {
      // User blocked the bot — clear dm_chat_id so we stop trying
      prefs.dm_chat_id = null;
      await saveUserPreferences(env.PROJECTS, member.telegram_id, prefs);
    }
  }
}

// ---------------------------------------------------------------------------
// User color assignment (for dashboard)
// ---------------------------------------------------------------------------

const USER_COLORS = [
  "\u{1F7E1}", // yellow circle
  "\u{1F535}", // blue circle
  "\u{1F7E3}", // purple circle
  "\u{1F7E0}", // orange circle
  "\u{1F7E4}", // brown circle
  "\u{1F534}", // red circle
  "\u{1F7E2}", // green circle
];

/**
 * Get a consistent color emoji for a team member by telegram_id.
 * Each member gets a unique color based on their position in the list.
 */
function getUserColor(members: TeamMember[], telegramId: number): string {
  const idx = members.findIndex((m) => m.telegram_id === telegramId);
  return USER_COLORS[idx % USER_COLORS.length] || "\u{2B1C}";
}

/**
 * Get a consistent color emoji for a team member by name or github handle.
 */
function getUserColorByName(members: TeamMember[], name: string): string {
  const idx = members.findIndex(
    (m) => m.name === name || m.github === name
  );
  if (idx < 0) return "\u{2B1C}";
  return USER_COLORS[idx % USER_COLORS.length];
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

/**
 * Make an authenticated request to the GitHub API.
 * Requires a githubToken for write operations.
 */
async function githubRequest(
  method: string,
  path: string,
  githubToken: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CortexTeamBot/1.0",
  };

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const options: RequestInit = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  return fetch(`${GITHUB_API}${path}`, options);
}

// ---------------------------------------------------------------------------
// GitHub helpers for category-based assignment
// ---------------------------------------------------------------------------

/**
 * Fetch all open issues and group them by `area:*` labels.
 * Returns a Map where keys are the full label name (e.g. "area:dashboard")
 * and values are arrays of issues with that label.
 */
async function fetchOpenIssuesByCategory(
  project: ProjectConfig,
  prefix: string = "area:"
): Promise<Map<string, Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }> }>>> {
  if (!project.githubToken) return new Map();

  const res = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues?state=open&per_page=100`,
    project.githubToken
  );

  if (!res.ok) return new Map();

  const issues = (await res.json()) as Array<{
    number: number;
    title: string;
    html_url: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;

  // Filter out PRs (GitHub API returns PRs as issues)
  const realIssues = issues.filter((i) => !i.pull_request);

  const grouped = new Map<string, Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }> }>>();

  for (const issue of realIssues) {
    for (const label of issue.labels) {
      if (label.name.startsWith(prefix)) {
        const existing = grouped.get(label.name) || [];
        existing.push({ number: issue.number, title: issue.title, html_url: issue.html_url, labels: issue.labels });
        grouped.set(label.name, existing);
      }
    }
  }

  return grouped;
}

/**
 * Batch-assign multiple issues to a GitHub user.
 * Returns which issue numbers succeeded and which failed.
 */
async function assignIssuesToUser(
  project: ProjectConfig,
  issueNumbers: number[],
  githubUsername: string
): Promise<{ success: number[]; failed: number[] }> {
  const success: number[] = [];
  const failed: number[] = [];

  if (!project.githubToken) return { success, failed: issueNumbers };

  for (const num of issueNumbers) {
    try {
      const res = await githubRequest(
        "POST",
        `/repos/${project.githubRepo}/issues/${num}/assignees`,
        project.githubToken,
        { assignees: [githubUsername] }
      );
      if (res.ok) {
        success.push(num);
      } else {
        failed.push(num);
      }
    } catch {
      failed.push(num);
    }
  }

  return { success, failed };
}

/**
 * Batch-unassign multiple issues from a GitHub user.
 * Returns which issue numbers succeeded and which failed.
 */
async function unassignIssuesFromUser(
  project: ProjectConfig,
  issueNumbers: number[],
  githubUsername: string
): Promise<{ success: number[]; failed: number[] }> {
  const success: number[] = [];
  const failed: number[] = [];

  if (!project.githubToken) return { success, failed: issueNumbers };

  for (const num of issueNumbers) {
    try {
      const res = await githubRequest(
        "DELETE",
        `/repos/${project.githubRepo}/issues/${num}/assignees`,
        project.githubToken,
        { assignees: [githubUsername] }
      );
      if (res.ok) {
        success.push(num);
      } else {
        failed.push(num);
      }
    } catch {
      failed.push(num);
    }
  }

  return { success, failed };
}

/**
 * Fetch all `area:*` labels from the GitHub repo (not from issues).
 * Returns an array of label names like ["area:dashboard", "area:api"].
 */
async function fetchAreaLabels(
  project: ProjectConfig,
  prefix: string = "area:"
): Promise<string[]> {
  if (!project.githubToken) return [];

  const res = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/labels?per_page=100`,
    project.githubToken
  );

  if (!res.ok) return [];

  const labels = (await res.json()) as Array<{ name: string }>;
  return labels
    .map((l) => l.name)
    .filter((name) => name.startsWith(prefix))
    .sort();
}

// ---------------------------------------------------------------------------
// Priority helpers — extract, sort, and check blocker status
// ---------------------------------------------------------------------------

/**
 * Extract the priority label from an issue's labels array.
 * Returns the label name (e.g. "priority:high") or the default "priority:medium".
 */
function getIssuePriority(labels: Array<{ name: string }>): string {
  const priorityLabel = labels.find((l) => l.name.startsWith("priority:"));
  return priorityLabel?.name || PRIORITY_DEFAULT;
}

/**
 * Get the numeric sort weight for a priority label (lower = higher priority).
 */
function getPrioritySortWeight(priority: string): number {
  return PRIORITY_LEVELS[priority] ?? PRIORITY_LEVELS[PRIORITY_DEFAULT];
}

/**
 * Sort issues by priority (blocker first, then high, medium, low).
 * Issues without a priority label are treated as medium.
 */
function sortByPriority<T extends { labels: Array<{ name: string }> }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const pa = getPrioritySortWeight(getIssuePriority(a.labels));
    const pb = getPrioritySortWeight(getIssuePriority(b.labels));
    return pa - pb;
  });
}

/**
 * Check whether any open issue in a project has the priority:blocker label.
 * Returns the blocker issue(s) if found, empty array otherwise.
 */
async function isBlockerActive(
  project: ProjectConfig
): Promise<Array<{ number: number; title: string }>> {
  if (!project.githubToken) return [];

  const res = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues?state=open&labels=priority:blocker&per_page=100`,
    project.githubToken
  );

  if (!res.ok) return [];

  const issues = (await res.json()) as Array<{
    number: number;
    title: string;
    pull_request?: unknown;
  }>;

  // Filter out PRs (GitHub API returns PRs as issues)
  return issues
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title }));
}

/**
 * Format a priority label as a human-readable emoji + text.
 */
function formatPriority(priority: string): string {
  const emoji = PRIORITY_EMOJIS[priority] || PRIORITY_EMOJIS[PRIORITY_DEFAULT];
  const level = priority.replace("priority:", "").toUpperCase();
  return `${emoji} ${level}`;
}

// ---------------------------------------------------------------------------
// Prompt generator — builds a Claude Code prompt from a GitHub issue
// ---------------------------------------------------------------------------

/**
 * Extract the description (text before "## Acceptance criteria") and
 * the acceptance criteria section from a GitHub issue body.
 */
function parseIssueBody(body: string): {
  description: string;
  acceptanceCriteria: string;
} {
  if (!body) return { description: "", acceptanceCriteria: "" };

  const acHeading = /^##\s+Acceptance\s+[Cc]riteria/m;
  const acMatch = acHeading.exec(body);

  let description: string;
  let acceptanceCriteria: string;

  if (acMatch) {
    // Everything before the AC heading is the description
    description = body.slice(0, acMatch.index).trim();

    // AC section runs until the next ## heading or end of body
    const afterAc = body.slice(acMatch.index + acMatch[0].length);
    const nextHeading = /^##\s+/m.exec(afterAc);
    acceptanceCriteria = nextHeading
      ? afterAc.slice(0, nextHeading.index).trim()
      : afterAc.trim();
  } else {
    // No AC section — use first ~300 chars as description
    description = body.length > 300 ? body.slice(0, 300) + "..." : body;
    acceptanceCriteria = "";
  }

  return { description, acceptanceCriteria };
}

/**
 * Try to find relevant source files via GitHub Code Search.
 * Uses 2-3 keywords from the issue title as the search query.
 * Returns file paths or null if the search fails.
 */
async function findRelevantFiles(
  repo: string,
  issueTitle: string,
  githubToken: string
): Promise<string[] | null> {
  // Extract meaningful keywords: drop short words and common stop words
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "this", "that", "into", "when",
    "add", "fix", "new", "use", "get", "set", "update", "create", "make",
    "bug", "feature", "issue", "task", "implement", "should", "must",
  ]);

  const keywords = issueTitle
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()))
    .slice(0, 3);

  if (keywords.length === 0) return null;

  const query = encodeURIComponent(`${keywords.join(" ")} repo:${repo}`);

  try {
    const res = await githubRequest(
      "GET",
      `/search/code?q=${query}&per_page=5`,
      githubToken
    );

    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Array<{ path: string }>;
    };

    if (!data.items || data.items.length === 0) return null;

    // Deduplicate file paths
    const paths = [...new Set(data.items.map((item) => item.path))];
    return paths;
  } catch {
    // Code search can fail (rate limit, indexing not ready) — graceful fallback
    return null;
  }
}

/**
 * Generate a Claude Code prompt for a GitHub issue.
 * The prompt is plain text designed to be pasted into VS Code's Claude Code.
 * It includes the issue context, acceptance criteria, and relevant files.
 */
async function generateClaudePrompt(
  project: ProjectConfig,
  issueNumber: number,
  category: string | null
): Promise<string> {
  if (!project.githubToken) {
    return `Implement issue #${issueNumber}\n\nNo GitHub token configured — please check the issue manually.`;
  }

  // Fetch full issue details
  const issueRes = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues/${issueNumber}`,
    project.githubToken
  );

  if (!issueRes.ok) {
    return `Implement issue #${issueNumber}\n\nCould not fetch issue details (HTTP ${issueRes.status}).`;
  }

  const issue = (await issueRes.json()) as {
    title: string;
    body: string | null;
    labels: Array<{ name: string }>;
    html_url: string;
  };

  const { description, acceptanceCriteria } = parseIssueBody(issue.body || "");

  // Branch name: use category if available, otherwise issue number
  const branchName = category
    ? `feature/${category.toLowerCase().replace(/\s+/g, "-")}`
    : `feature/issue-${issueNumber}`;

  // Try to find relevant files via code search
  const relevantFiles = await findRelevantFiles(
    project.githubRepo,
    issue.title,
    project.githubToken
  );

  const filesSection = relevantFiles
    ? relevantFiles.map((f) => `- ${f}`).join("\n")
    : "No specific files identified — explore the codebase";

  // Build the prompt as plain text (will be placed inside a <pre> block)
  const lines: string[] = [
    `Implement: #${issueNumber} ${issue.title}`,
    `Branch: ${branchName}`,
    `Link: ${issue.html_url}`,
    "",
  ];

  if (description) {
    lines.push("Description:");
    lines.push(description);
    lines.push("");
  }

  if (acceptanceCriteria) {
    lines.push("Acceptance Criteria:");
    lines.push(acceptanceCriteria);
    lines.push("");
  }

  lines.push("Relevant Files:");
  lines.push(filesSection);
  lines.push("");
  lines.push("Instructions:");
  lines.push(`1. Check out branch: git checkout -b ${branchName}`);
  lines.push("2. Read the relevant files above before making changes");
  lines.push("3. Implement all acceptance criteria");
  lines.push("4. Write tests for new functionality");
  lines.push("5. Run tests before committing");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// KV helpers for message threading (PR/Issue reply chains)
// ---------------------------------------------------------------------------

/**
 * Look up the Telegram message_id for the first message posted about a
 * specific PR or Issue. Returns null if no thread exists yet.
 */
async function getThreadMessageId(
  kv: KVNamespace,
  projectId: string,
  type: "issue" | "pr",
  number: number
): Promise<number | null> {
  const key = `msg:${projectId}:${type}:${number}`;
  const raw = await kv.get(key);
  return raw ? parseInt(raw, 10) : null;
}

/**
 * Store the Telegram message_id for the first message about a PR or Issue.
 * Subsequent events can reply to this message to create a thread.
 * Expires after 30 days — old threads don't need tracking.
 */
async function saveThreadMessageId(
  kv: KVNamespace,
  projectId: string,
  type: "issue" | "pr",
  number: number,
  messageId: number
): Promise<void> {
  const key = `msg:${projectId}:${type}:${number}`;
  await kv.put(key, String(messageId), { expirationTtl: 2592000 });
}

// ---------------------------------------------------------------------------
// KV helpers for webhook batching (bulk operations like labeling 20 issues)
// ---------------------------------------------------------------------------

/**
 * Shape of a batch buffer entry stored in KV.
 * Accumulates multiple events of the same type from the same actor
 * so they can be sent as a single Telegram message.
 */
interface BatchBuffer {
  items: string[];
  firstSeen: number;
}

/**
 * Check whether an event should be sent immediately or batched.
 *
 * When the same actor performs the same action type repeatedly (e.g. labeling
 * 20 issues at once), this function accumulates events in a KV buffer and
 * returns them as a single summary message once the buffer is old enough
 * (>10 seconds) or large enough (>=10 items).
 *
 * Flow:
 * 1. First event  -> send normally, but also start a batch buffer in KV
 * 2. Second event -> append to buffer, suppress sending (shouldSend = false)
 * 3. Nth event    -> if buffer age > 10s OR items >= 10, flush as batch summary
 *
 * The KV entry auto-expires after 60 seconds (TTL, KV minimum) as a safety
 * net so stale buffers don't linger if no more events arrive.
 */
async function checkAndBatch(
  kv: KVNamespace,
  projectId: string,
  eventType: string,
  actor: string,
  detail: string
): Promise<{ shouldSend: boolean; batchMessage: string | null }> {
  const key = `batch:${projectId}:${eventType}:${actor}`;
  const existing = await kv.get(key);

  if (existing) {
    // There is already a buffer — append this event to it
    let batch: BatchBuffer;
    try {
      batch = JSON.parse(existing) as BatchBuffer;
    } catch {
      // Corrupted buffer — start fresh
      batch = { items: [], firstSeen: Date.now() };
    }

    batch.items.push(detail);

    // Flush condition: buffer is older than 10 seconds OR has 10+ items
    const ageMs = Date.now() - batch.firstSeen;
    if (ageMs > 10_000 || batch.items.length >= 10) {
      // Flush: delete the buffer and return a summary message
      await kv.delete(key);

      // Show up to 5 items in the summary, then "...and N more"
      const preview = batch.items.slice(0, 5).join("\n");
      const overflow =
        batch.items.length > 5
          ? `\n...and ${batch.items.length - 5} more`
          : "";

      return {
        shouldSend: true,
        batchMessage:
          `@${actor} ${eventType.replace(".", " ")} ${batch.items.length} items:\n` +
          preview +
          overflow,
      };
    }

    // Keep accumulating — don't send yet
    // KV requires minimum TTL of 60 seconds
    await kv.put(key, JSON.stringify(batch), { expirationTtl: 60 });
    return { shouldSend: false, batchMessage: null };
  }

  // First event of this type from this actor — send normally,
  // but also start a batch buffer in case more events follow quickly.
  // KV requires minimum TTL of 60 seconds
  await kv.put(
    key,
    JSON.stringify({ items: [detail], firstSeen: Date.now() } as BatchBuffer),
    { expirationTtl: 60 }
  );
  return { shouldSend: true, batchMessage: null };
}

// ---------------------------------------------------------------------------
// KV helpers for session tracking
// ---------------------------------------------------------------------------

async function getActiveSessions(
  kv: KVNamespace,
  projectId: string
): Promise<ActiveSession[]> {
  const raw = await kv.get(`${projectId}:sessions`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ActiveSession[];
  } catch {
    return [];
  }
}

async function setActiveSessions(
  kv: KVNamespace,
  projectId: string,
  sessions: ActiveSession[]
): Promise<void> {
  // Sessions auto-expire after 2 hours (7200 seconds) — no explicit "end" needed
  await kv.put(`${projectId}:sessions`, JSON.stringify(sessions), { expirationTtl: 7200 });
}

// ---------------------------------------------------------------------------
// KV helpers for heartbeat activity data
// ---------------------------------------------------------------------------

/**
 * Store activity data (branch, files, last commit) for a user.
 * Used by the heartbeat system to show what each team member is working on.
 * Auto-expires after 2 hours — if no heartbeat arrives, the data disappears.
 */
async function saveActivityData(
  kv: KVNamespace,
  projectId: string,
  user: string,
  data: { branch: string; lastFiles: string[]; lastCommit: string }
): Promise<void> {
  const key = `activity:${projectId}:${user}`;
  await kv.put(key, JSON.stringify(data), { expirationTtl: 7200 }); // 2h TTL
}

/**
 * Retrieve stored activity data for a user.
 * Returns null if no heartbeat data exists (expired or never sent).
 */
async function getActivityData(
  kv: KVNamespace,
  projectId: string,
  user: string
): Promise<{ branch: string; lastFiles: string[]; lastCommit: string } | null> {
  const raw = await kv.get(`activity:${projectId}:${user}`);
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------------------
// KV helpers for file-level conflict detection
// ---------------------------------------------------------------------------

/**
 * Store the list of recently changed files for a user in a specific project.
 * Used by the conflict detector to compare against other users' file lists.
 * Auto-expires after 2 hours (matches heartbeat TTL).
 */
async function saveChangedFiles(
  kv: KVNamespace,
  projectId: string,
  telegramId: number,
  files: string[]
): Promise<void> {
  const key = `files:${projectId}:${telegramId}`;
  await kv.put(key, JSON.stringify(files), { expirationTtl: 7200 });
}

/**
 * Retrieve the stored changed files for a user in a project.
 * Returns an empty array if no data exists (expired or never set).
 */
async function getChangedFiles(
  kv: KVNamespace,
  projectId: string,
  telegramId: number
): Promise<string[]> {
  const raw = await kv.get(`files:${projectId}:${telegramId}`);
  return raw ? JSON.parse(raw) : [];
}

/**
 * Check if a conflict warning was already sent for a specific file between two users.
 * The key is sorted by user ID so A→B and B→A share the same dedup entry.
 */
async function hasConflictWarning(
  kv: KVNamespace,
  projectId: string,
  userA: number,
  userB: number,
  file: string
): Promise<boolean> {
  const sortedPair = [userA, userB].sort((a, b) => a - b).join("_");
  const key = `conflict_warn:${projectId}:${sortedPair}:${file}`;
  return (await kv.get(key)) !== null;
}

/**
 * Mark a conflict warning as sent for a specific file between two users.
 * Expires after 1 hour — ensures warnings are throttled but not permanent.
 */
async function setConflictWarning(
  kv: KVNamespace,
  projectId: string,
  userA: number,
  userB: number,
  file: string
): Promise<void> {
  const sortedPair = [userA, userB].sort((a, b) => a - b).join("_");
  const key = `conflict_warn:${projectId}:${sortedPair}:${file}`;
  await kv.put(key, "1", { expirationTtl: 3600 });
}

/**
 * Detect file-level conflicts between the current user and all other active
 * team members in the same project. If overlapping files are found and no
 * warning has been sent recently, DMs both users with the conflict details.
 *
 * Respects DND mode — users in DND won't receive conflict warnings.
 */
async function detectFileConflicts(
  env: Env,
  projectId: string,
  currentUser: string,
  currentTelegramId: number,
  currentFiles: string[],
  botToken: string
): Promise<void> {
  if (currentFiles.length === 0) return;

  const members = await getTeamMembers(env.PROJECTS);

  for (const member of members) {
    // Skip the current user
    if (member.telegram_id === currentTelegramId) continue;

    // Retrieve the other user's changed files for this project
    const otherFiles = await getChangedFiles(env.PROJECTS, projectId, member.telegram_id);
    if (otherFiles.length === 0) continue;

    // Find overlapping files
    const otherFileSet = new Set(otherFiles);
    const conflicts = currentFiles.filter((f) => otherFileSet.has(f));
    if (conflicts.length === 0) continue;

    // Filter out files that already had a warning sent recently
    const newConflicts: string[] = [];
    for (const file of conflicts) {
      const alreadyWarned = await hasConflictWarning(
        env.PROJECTS,
        projectId,
        currentTelegramId,
        member.telegram_id,
        file
      );
      if (!alreadyWarned) {
        newConflicts.push(file);
      }
    }
    if (newConflicts.length === 0) continue;

    // Set throttle keys for all new conflicts
    for (const file of newConflicts) {
      await setConflictWarning(
        env.PROJECTS,
        projectId,
        currentTelegramId,
        member.telegram_id,
        file
      );
    }

    // Build the conflict file list for the message
    const fileList = newConflicts
      .map((f) => `\u2022 <code>${escapeHtml(f)}</code>`)
      .join("\n");

    const escapedProject = escapeHtml(projectId);

    // Send DM to the current user (about the other user)
    const currentPrefs = await getUserPreferences(env.PROJECTS, currentTelegramId);
    if (currentPrefs.dm_chat_id && !(await isUserDND(env.PROJECTS, currentTelegramId))) {
      const otherName = escapeHtml(member.name || member.telegram_username);
      const msgForCurrent =
        `\u26A0\uFE0F <b>File Conflict Warning</b>\n\n` +
        `You and <b>${otherName}</b> are both editing:\n${fileList}\n\n` +
        `Project: <b>${escapedProject}</b>\n\n` +
        `<i>Coordinate to avoid merge conflicts!</i>`;
      const status = await sendDM(botToken, currentPrefs.dm_chat_id, msgForCurrent);
      if (status === "blocked") {
        currentPrefs.dm_chat_id = null;
        await saveUserPreferences(env.PROJECTS, currentTelegramId, currentPrefs);
      }
    }

    // Send DM to the other user (about the current user)
    const otherPrefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
    if (otherPrefs.dm_chat_id && !(await isUserDND(env.PROJECTS, member.telegram_id))) {
      const currentName = escapeHtml(currentUser);
      const msgForOther =
        `\u26A0\uFE0F <b>File Conflict Warning</b>\n\n` +
        `You and <b>${currentName}</b> are both editing:\n${fileList}\n\n` +
        `Project: <b>${escapedProject}</b>\n\n` +
        `<i>Coordinate to avoid merge conflicts!</i>`;
      const status = await sendDM(botToken, otherPrefs.dm_chat_id, msgForOther);
      if (status === "blocked") {
        otherPrefs.dm_chat_id = null;
        await saveUserPreferences(env.PROJECTS, member.telegram_id, otherPrefs);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// KV helpers for central team-members registry
// ---------------------------------------------------------------------------

/**
 * Read the central team-members list from KV.
 * Stored under the key "team-members" as a JSON array.
 */
async function getTeamMembers(kv: KVNamespace): Promise<TeamMember[]> {
  const raw = await kv.get("team-members");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TeamMember[];
  } catch {
    return [];
  }
}

/**
 * Add or update a team member in the central registry.
 * Deduplicates by telegram_id — updates the entry if it already exists.
 */
async function upsertTeamMember(
  kv: KVNamespace,
  member: TeamMember
): Promise<void> {
  const members = await getTeamMembers(kv);

  const existingIndex = members.findIndex(
    (m) => m.telegram_id === member.telegram_id
  );

  if (existingIndex >= 0) {
    // Update existing entry
    members[existingIndex] = member;
  } else {
    // Add new entry
    members.push(member);
  }

  await kv.put("team-members", JSON.stringify(members));
}

// ---------------------------------------------------------------------------
// KV helpers for onboarding wizard
// ---------------------------------------------------------------------------

type OnboardingStep = "awaiting_github" | "settings" | "tutorial";

/**
 * Read the current onboarding step for a user (null = not in onboarding).
 * Keys expire after 24h so abandoned wizards auto-clean.
 */
async function getOnboardingState(
  kv: KVNamespace,
  telegramId: number
): Promise<OnboardingStep | null> {
  const raw = await kv.get(`onboarding:${telegramId}`);
  return raw as OnboardingStep | null;
}

/**
 * Persist the user's current onboarding step with a 24h TTL.
 */
async function setOnboardingState(
  kv: KVNamespace,
  telegramId: number,
  step: OnboardingStep
): Promise<void> {
  await kv.put(`onboarding:${telegramId}`, step, { expirationTtl: 86400 });
}

/**
 * Remove the onboarding step key (wizard finished or abandoned).
 */
async function clearOnboardingState(
  kv: KVNamespace,
  telegramId: number
): Promise<void> {
  await kv.delete(`onboarding:${telegramId}`);
}

// ---------------------------------------------------------------------------
// KV helpers for team messaging threads (Issue #59)
// ---------------------------------------------------------------------------

/**
 * Read a message thread from KV by its key.
 * Returns null if the thread has expired or doesn't exist.
 */
async function getMessageThread(
  kv: KVNamespace,
  threadKey: string
): Promise<MessageThread | null> {
  const raw = await kv.get(threadKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MessageThread;
  } catch {
    return null;
  }
}

/**
 * Store a message thread in KV with a 24h TTL.
 * Threads auto-expire so stale conversations don't accumulate.
 */
async function setMessageThread(
  kv: KVNamespace,
  threadKey: string,
  data: MessageThread
): Promise<void> {
  await kv.put(threadKey, JSON.stringify(data), { expirationTtl: 86400 });
}

// ---------------------------------------------------------------------------
// Team messaging helpers — @Name parsing (Issue #59)
// ---------------------------------------------------------------------------

/**
 * Extract @Name mentions from a message.
 * Only explicit @-tags are matched — no auto-suggestions.
 */
function parseAtMentions(text: string): string[] {
  const mentions: string[] = [];
  const regex = /(?:^|\s)@([\p{L}\p{N}_]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

/**
 * Extract #N issue references from a message.
 * Returns an array of issue numbers.
 */
function parseIssueReferences(text: string): number[] {
  const refs: number[] = [];
  const regex = /(?:^|\s)#(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num) && num > 0) refs.push(num);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// "Neue Idee" wizard state — guided issue creation flow
// ---------------------------------------------------------------------------

interface NewIdeaState {
  step: "awaiting_title" | "awaiting_category" | "awaiting_priority";
  title?: string;
  category?: string; // full label name like "area:dashboard"
}

/**
 * Read the current "new idea" wizard state for a user (null = not in wizard).
 * Keys expire after 1h so abandoned wizards auto-clean.
 */
async function getNewIdeaState(
  kv: KVNamespace,
  telegramId: number
): Promise<NewIdeaState | null> {
  const raw = await kv.get(`newidea:${telegramId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NewIdeaState;
  } catch {
    return null;
  }
}

/**
 * Persist the user's current "new idea" wizard state with a 1h TTL.
 */
async function setNewIdeaState(
  kv: KVNamespace,
  telegramId: number,
  state: NewIdeaState
): Promise<void> {
  await kv.put(`newidea:${telegramId}`, JSON.stringify(state), {
    expirationTtl: 3600,
  });
}

/**
 * Remove the "new idea" wizard state (wizard finished or abandoned).
 */
async function clearNewIdeaState(
  kv: KVNamespace,
  telegramId: number
): Promise<void> {
  await kv.delete(`newidea:${telegramId}`);
}

/**
 * Check whether a user has completed onboarding before.
 */
async function isOnboarded(
  kv: KVNamespace,
  telegramId: number
): Promise<boolean> {
  return (await kv.get(`onboarded:${telegramId}`)) === "true";
}

/**
 * Mark a user as having completed onboarding (permanent).
 */
async function markOnboarded(
  kv: KVNamespace,
  telegramId: number
): Promise<void> {
  await kv.put(`onboarded:${telegramId}`, "true");
}

// ---------------------------------------------------------------------------
// KV helpers for dashboard state
// ---------------------------------------------------------------------------

/**
 * Retrieve the dashboard state for a project.
 * Stores the Telegram message_id so we can edit the same message.
 */
async function getDashboardState(
  kv: KVNamespace,
  projectId: string
): Promise<DashboardState> {
  const raw = await kv.get(projectId + ":dashboard");
  if (raw) {
    try {
      return JSON.parse(raw) as DashboardState;
    } catch {
      // Corrupted data — return fresh state
    }
  }
  return { messageId: null, activeSessions: [], lastUpdated: "" };
}

/**
 * Persist the dashboard state (message_id, active sessions, etc.).
 */
async function saveDashboardState(
  kv: KVNamespace,
  projectId: string,
  state: DashboardState
): Promise<void> {
  await kv.put(projectId + ":dashboard", JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// KV helpers for user preferences (DM notification settings)
// ---------------------------------------------------------------------------

/**
 * Read user preferences from KV. Returns defaults if nothing is stored.
 */
async function getUserPreferences(
  kv: KVNamespace,
  telegramId: number
): Promise<UserPreferences> {
  const raw = await kv.get(`prefs:${telegramId}`);
  if (!raw) return { ...DEFAULT_PREFERENCES };
  try {
    return JSON.parse(raw) as UserPreferences;
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Save user preferences to KV.
 */
async function saveUserPreferences(
  kv: KVNamespace,
  telegramId: number,
  prefs: UserPreferences
): Promise<void> {
  prefs.updated_at = new Date().toISOString();
  await kv.put(`prefs:${telegramId}`, JSON.stringify(prefs));
}

// ---------------------------------------------------------------------------
// KV helpers for category claims
// ---------------------------------------------------------------------------

/**
 * Read category claims for a project from KV.
 */
async function getCategoryClaims(
  kv: KVNamespace,
  projectId: string
): Promise<CategoryClaimsState> {
  const raw = await kv.get(`${projectId}:category_claims`);
  if (!raw) return { claims: [], lastUpdated: "" };
  try {
    return JSON.parse(raw) as CategoryClaimsState;
  } catch {
    return { claims: [], lastUpdated: "" };
  }
}

/**
 * Save category claims for a project to KV.
 */
async function saveCategoryClaims(
  kv: KVNamespace,
  projectId: string,
  state: CategoryClaimsState
): Promise<void> {
  state.lastUpdated = new Date().toISOString();
  await kv.put(`${projectId}:category_claims`, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// KV helpers for paused categories
// ---------------------------------------------------------------------------

/**
 * Read paused categories for a project from KV.
 */
async function getPausedCategories(
  kv: KVNamespace,
  projectId: string
): Promise<PausedCategory[]> {
  const raw = await kv.get(`${projectId}:paused_categories`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PausedCategory[];
  } catch {
    return [];
  }
}

/**
 * Save paused categories for a project to KV.
 */
async function savePausedCategories(
  kv: KVNamespace,
  projectId: string,
  paused: PausedCategory[]
): Promise<void> {
  await kv.put(`${projectId}:paused_categories`, JSON.stringify(paused));
}

/**
 * Add a paused category entry to the KV list.
 * If the category was already paused, it replaces the old entry.
 */
async function addPausedCategory(
  kv: KVNamespace,
  projectId: string,
  entry: PausedCategory
): Promise<void> {
  const paused = await getPausedCategories(kv, projectId);
  const filtered = paused.filter((p) => p.category !== entry.category);
  filtered.push(entry);
  await savePausedCategories(kv, projectId, filtered);
}

/**
 * Remove a paused category entry (e.g. when someone claims it again).
 */
async function removePausedCategory(
  kv: KVNamespace,
  projectId: string,
  category: string
): Promise<void> {
  const paused = await getPausedCategories(kv, projectId);
  const filtered = paused.filter((p) => p.category !== category);
  await savePausedCategories(kv, projectId, filtered);
}

// ---------------------------------------------------------------------------
// KV helpers for active project per user
// ---------------------------------------------------------------------------

/**
 * Read the user's currently active project ID from KV.
 */
async function getActiveProject(
  kv: KVNamespace,
  telegramId: number
): Promise<string | null> {
  return await kv.get(`active_project:${telegramId}`);
}

/**
 * Store the user's active project ID in KV.
 */
async function setActiveProject(
  kv: KVNamespace,
  telegramId: number,
  projectId: string
): Promise<void> {
  await kv.put(`active_project:${telegramId}`, projectId);
}

/**
 * Resolve the user's active project with a fallback to the first available.
 * Returns null if no projects are registered at all.
 */
async function resolveActiveProject(
  env: Env,
  telegramId: number
): Promise<{ projectId: string; projectConfig: ProjectConfig } | null> {
  const savedId = await getActiveProject(env.PROJECTS, telegramId);
  if (savedId) {
    const config = await getProject(env.PROJECTS, savedId, env);
    if (config) return { projectId: savedId, projectConfig: config };
  }
  // Default to first available project
  const projects = await getProjectList(env);
  if (projects.length === 0) return null;
  await setActiveProject(env.PROJECTS, telegramId, projects[0].id);
  return { projectId: projects[0].id, projectConfig: projects[0].config };
}

// ---------------------------------------------------------------------------
// KV helpers for active task tracking (per user per project)
// ---------------------------------------------------------------------------

/**
 * Read the user's currently active task (issue number) for a project.
 */
async function getActiveTask(
  kv: KVNamespace,
  telegramId: number,
  projectId: string
): Promise<number | null> {
  const raw = await kv.get(`active_task:${telegramId}:${projectId}`);
  if (!raw) return null;
  const num = parseInt(raw, 10);
  return isNaN(num) ? null : num;
}

/**
 * Mark an issue as the user's currently active task.
 */
async function setActiveTask(
  kv: KVNamespace,
  telegramId: number,
  projectId: string,
  issueNumber: number
): Promise<void> {
  await kv.put(`active_task:${telegramId}:${projectId}`, String(issueNumber));
}

/**
 * Clear the user's active task marker.
 */
async function clearActiveTask(
  kv: KVNamespace,
  telegramId: number,
  projectId: string
): Promise<void> {
  await kv.delete(`active_task:${telegramId}:${projectId}`);
}

/**
 * Read the user's "tasks done today" counter from KV.
 * Returns 0 when the key has expired (daily reset via TTL).
 */
async function getTodayDoneCount(
  kv: KVNamespace,
  telegramId: number
): Promise<number> {
  const raw = await kv.get(`today_done:${telegramId}`);
  if (!raw) return 0;
  const num = parseInt(raw, 10);
  return isNaN(num) ? 0 : num;
}

/**
 * Increment the user's "tasks done today" counter.
 * Uses a 24-hour TTL so the counter resets automatically each day.
 */
async function incrementTodayDoneCount(
  kv: KVNamespace,
  telegramId: number
): Promise<number> {
  const current = await getTodayDoneCount(kv, telegramId);
  const next = current + 1;
  await kv.put(`today_done:${telegramId}`, String(next), {
    expirationTtl: 86400,
  });
  return next;
}

// ---------------------------------------------------------------------------
// KV helpers for category timer (Issue #60)
// ---------------------------------------------------------------------------

/**
 * Read the active category timer for a user in a project.
 */
async function getTimer(
  kv: KVNamespace,
  telegramId: number,
  projectId: string
): Promise<TimerState | null> {
  const raw = await kv.get(`timer:${telegramId}:${projectId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TimerState;
  } catch {
    return null;
  }
}

/**
 * Start a category timer — stores the category name and current timestamp.
 * Safe: one-category-per-user guard in handleCategoryConfirm prevents double-start.
 * If a timer already exists (e.g. KV/claim state drift), it is overwritten.
 */
async function startTimer(
  kv: KVNamespace,
  telegramId: number,
  projectId: string,
  category: string
): Promise<void> {
  const state: TimerState = { category, startedAt: new Date().toISOString() };
  await kv.put(`timer:${telegramId}:${projectId}`, JSON.stringify(state));
}

/**
 * Stop a category timer — removes the KV entry and returns the state
 * so the caller can calculate the duration.
 */
async function stopTimer(
  kv: KVNamespace,
  telegramId: number,
  projectId: string
): Promise<TimerState | null> {
  const state = await getTimer(kv, telegramId, projectId);
  if (!state) return null;
  await kv.delete(`timer:${telegramId}:${projectId}`);
  return state;
}

// ---------------------------------------------------------------------------
// D1 helpers — event logging and session history
// ---------------------------------------------------------------------------

async function logEvent(
  db: D1Database,
  repo: string,
  eventType: string,
  actor: string,
  target?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db.prepare(
      "INSERT INTO events (repo, event_type, actor, target, metadata) VALUES (?, ?, ?, ?, ?)"
    ).bind(repo, eventType, actor, target || null, metadata ? JSON.stringify(metadata) : null).run();
  } catch {
    // Best-effort logging — don't break main flow
  }
}

async function logSessionStart(
  db: D1Database,
  userId: string,
  project: string
): Promise<void> {
  try {
    await db.prepare(
      "INSERT INTO sessions (user_id, project) VALUES (?, ?)"
    ).bind(userId, project).run();
  } catch {}
}

async function logSessionEnd(
  db: D1Database,
  userId: string,
  project: string
): Promise<void> {
  try {
    await db.prepare(
      `UPDATE sessions SET ended_at = CURRENT_TIMESTAMP,
       duration_minutes = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 1440 AS INTEGER)
       WHERE user_id = ? AND project = ? AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`
    ).bind(userId, project).run();
  } catch {}
}

async function getTodayStats(
  db: D1Database,
  repo?: string
): Promise<{ issues_opened: number; issues_closed: number; prs_merged: number; prs_open: number; total_events: number }> {
  try {
    const repoFilter = repo ? "AND repo = ?" : "";
    const binds = repo ? [repo] : [];

    const opened = await db.prepare(
      `SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.opened' AND date(created_at) = date('now') ${repoFilter}`
    ).bind(...binds).first<{ c: number }>();

    const closed = await db.prepare(
      `SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.closed' AND date(created_at) = date('now') ${repoFilter}`
    ).bind(...binds).first<{ c: number }>();

    const merged = await db.prepare(
      `SELECT COUNT(*) as c FROM events WHERE event_type = 'pr.merged' AND date(created_at) = date('now') ${repoFilter}`
    ).bind(...binds).first<{ c: number }>();

    const prsOpen = await db.prepare(
      `SELECT COUNT(*) as c FROM events WHERE event_type = 'pr.opened' AND date(created_at) = date('now') ${repoFilter}`
    ).bind(...binds).first<{ c: number }>();

    const total = await db.prepare(
      `SELECT COUNT(*) as c FROM events WHERE date(created_at) = date('now') ${repoFilter}`
    ).bind(...binds).first<{ c: number }>();

    return {
      issues_opened: opened?.c || 0,
      issues_closed: closed?.c || 0,
      prs_merged: merged?.c || 0,
      prs_open: prsOpen?.c || 0,
      total_events: total?.c || 0,
    };
  } catch {
    return { issues_opened: 0, issues_closed: 0, prs_merged: 0, prs_open: 0, total_events: 0 };
  }
}

async function getWorkHoursToday(
  db: D1Database,
  project?: string
): Promise<Array<{ user_id: string; total_minutes: number }>> {
  try {
    const filter = project ? "AND project = ?" : "";
    const binds = project ? [project] : [];
    const result = await db.prepare(
      `SELECT user_id, SUM(duration_minutes) as total_minutes
       FROM sessions
       WHERE date(started_at) = date('now') ${filter}
       GROUP BY user_id ORDER BY total_minutes DESC`
    ).bind(...binds).all<{ user_id: string; total_minutes: number }>();
    return result.results || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// D1 helpers — time tracking (Issue #60)
// ---------------------------------------------------------------------------

/**
 * Log a completed category timer session to the time_logs table.
 * Best-effort — errors are swallowed so they don't break the main flow.
 */
async function logTimeEntry(
  db: D1Database,
  entry: {
    userId: number;
    project: string;
    category: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number;
    tasksCompleted: number;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO time_logs (user_id, project, category, started_at, ended_at, duration_minutes, tasks_completed) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        String(entry.userId),
        entry.project,
        entry.category,
        entry.startedAt,
        entry.endedAt,
        entry.durationMinutes,
        entry.tasksCompleted
      )
      .run();
  } catch {
    // Best-effort — don't break main flow
  }
}

/**
 * Total tracked minutes for a user on a specific date (YYYY-MM-DD).
 */
async function getDailyHours(
  db: D1Database,
  userId: number,
  date: string
): Promise<number> {
  try {
    const row = await db
      .prepare(
        "SELECT COALESCE(SUM(duration_minutes), 0) as total FROM time_logs WHERE user_id = ? AND date(started_at) = ?"
      )
      .bind(String(userId), date)
      .first<{ total: number }>();
    return row?.total || 0;
  } catch {
    return 0;
  }
}

/**
 * Total tracked minutes for a user from weekStart onwards (7 days).
 */
async function getWeeklyHours(
  db: D1Database,
  userId: number,
  weekStart: string
): Promise<number> {
  try {
    const row = await db
      .prepare(
        "SELECT COALESCE(SUM(duration_minutes), 0) as total FROM time_logs WHERE user_id = ? AND date(started_at) >= ? AND date(started_at) < date(?, '+7 days')"
      )
      .bind(String(userId), weekStart, weekStart)
      .first<{ total: number }>();
    return row?.total || 0;
  } catch {
    return 0;
  }
}

/**
 * Format a duration in minutes as a human-readable string.
 * 0 → "0m", 45 → "45m", 90 → "1h 30m", 120 → "2h 0m"
 */
function formatDuration(minutes: number): string {
  const clamped = Math.max(0, Math.round(minutes));
  if (clamped < 60) return `${clamped}m`;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// D1 helpers — velocity snapshots (Issue #61)
// ---------------------------------------------------------------------------

/**
 * Persist a weekly velocity snapshot to D1.
 * Best-effort — errors are swallowed so they don't break the cron job.
 */
async function saveVelocitySnapshot(
  db: D1Database,
  snapshot: VelocitySnapshot
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT OR REPLACE INTO velocity (project, week_start, tasks_completed, tasks_opened, team_hours, per_member, fastest_task, longest_task) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        snapshot.project,
        snapshot.weekStart,
        snapshot.tasksCompleted,
        snapshot.tasksOpened,
        snapshot.teamHours,
        JSON.stringify(snapshot.perMember),
        snapshot.fastestTask ? JSON.stringify(snapshot.fastestTask) : null,
        snapshot.longestTask ? JSON.stringify(snapshot.longestTask) : null
      )
      .run();
  } catch {
    // Best-effort — don't break the cron job
  }
}

/**
 * Fetch a velocity snapshot for a specific project and week.
 */
async function getVelocityData(
  db: D1Database,
  project: string,
  weekStart: string
): Promise<VelocitySnapshot | null> {
  try {
    const row = await db
      .prepare(
        "SELECT project, week_start, tasks_completed, tasks_opened, team_hours, per_member, fastest_task, longest_task FROM velocity WHERE project = ? AND week_start = ? LIMIT 1"
      )
      .bind(project, weekStart)
      .first<{
        project: string;
        week_start: string;
        tasks_completed: number;
        tasks_opened: number;
        team_hours: number;
        per_member: string | null;
        fastest_task: string | null;
        longest_task: string | null;
      }>();
    if (!row) return null;
    return {
      project: row.project,
      weekStart: row.week_start,
      tasksCompleted: row.tasks_completed,
      tasksOpened: row.tasks_opened,
      teamHours: row.team_hours,
      perMember: row.per_member ? JSON.parse(row.per_member) : [],
      fastestTask: row.fastest_task ? JSON.parse(row.fastest_task) : null,
      longestTask: row.longest_task ? JSON.parse(row.longest_task) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch velocity snapshots for the last two weeks (this week + last week).
 * Returns [thisWeek, lastWeek] — either may be null if no data exists.
 */
async function getLastTwoWeeksVelocity(
  db: D1Database,
  project: string
): Promise<[VelocitySnapshot | null, VelocitySnapshot | null]> {
  try {
    const rows = await db
      .prepare(
        "SELECT project, week_start, tasks_completed, tasks_opened, team_hours, per_member, fastest_task, longest_task FROM velocity WHERE project = ? ORDER BY week_start DESC LIMIT 2"
      )
      .bind(project)
      .all<{
        project: string;
        week_start: string;
        tasks_completed: number;
        tasks_opened: number;
        team_hours: number;
        per_member: string | null;
        fastest_task: string | null;
        longest_task: string | null;
      }>();

    const results = (rows.results || []).map((row) => ({
      project: row.project,
      weekStart: row.week_start,
      tasksCompleted: row.tasks_completed,
      tasksOpened: row.tasks_opened,
      teamHours: row.team_hours,
      perMember: row.per_member ? JSON.parse(row.per_member) : [],
      fastestTask: row.fastest_task ? JSON.parse(row.fastest_task) : null,
      longestTask: row.longest_task ? JSON.parse(row.longest_task) : null,
    }));

    return [results[0] || null, results[1] || null];
  } catch {
    return [null, null];
  }
}

/**
 * Calculate the Monday (start) of the ISO week containing the given date.
 */
function getWeekStartDate(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay();
  // Shift so Monday = 0: (day + 6) % 7
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate current-week data from time_logs + events to build a
 * VelocitySnapshot.  Does NOT persist — the caller decides when to save.
 */
async function calculateVelocitySnapshot(
  db: D1Database,
  project: string,
  members: TeamMember[]
): Promise<VelocitySnapshot> {
  const now = new Date();
  const weekStart = getWeekStartDate(now);

  // Tasks completed (issues closed) this week
  let tasksCompleted = 0;
  let tasksOpened = 0;
  try {
    const closed = await db
      .prepare(
        "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.closed' AND date(created_at) >= ? AND date(created_at) < date(?, '+7 days')"
      )
      .bind(weekStart, weekStart)
      .first<{ c: number }>();
    tasksCompleted = closed?.c || 0;

    const opened = await db
      .prepare(
        "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.opened' AND date(created_at) >= ? AND date(created_at) < date(?, '+7 days')"
      )
      .bind(weekStart, weekStart)
      .first<{ c: number }>();
    tasksOpened = opened?.c || 0;
  } catch {
    // Best-effort
  }

  // Per-member breakdown from time_logs
  const perMember: VelocitySnapshot["perMember"] = [];
  let totalTeamMinutes = 0;
  for (const member of members) {
    const hours = await getWeeklyHours(db, member.telegram_id, weekStart);
    // Count tasks completed by this member (issues they closed)
    let memberTasks = 0;
    try {
      const row = await db
        .prepare(
          "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.closed' AND actor = ? AND date(created_at) >= ? AND date(created_at) < date(?, '+7 days')"
        )
        .bind(member.github, weekStart, weekStart)
        .first<{ c: number }>();
      memberTasks = row?.c || 0;
    } catch {
      // Best-effort
    }

    totalTeamMinutes += hours;
    perMember.push({
      userId: String(member.telegram_id),
      name: member.name,
      tasks: memberTasks,
      hours,
    });
  }

  // Fastest and longest tasks — find issues.closed events with time_logs data
  let fastestTask: VelocitySnapshot["fastestTask"] = null;
  let longestTask: VelocitySnapshot["longestTask"] = null;
  try {
    const closedEvents = await db
      .prepare(
        "SELECT target, metadata FROM events WHERE event_type = 'issues.closed' AND date(created_at) >= ? AND date(created_at) < date(?, '+7 days') AND target IS NOT NULL"
      )
      .bind(weekStart, weekStart)
      .all<{ target: string; metadata: string | null }>();

    if (closedEvents.results && closedEvents.results.length > 0) {
      // Try to find time data for closed issues from time_logs
      const taskTimings: Array<{ number: number; title: string; minutes: number }> = [];

      for (const event of closedEvents.results) {
        const issueNumber = parseInt(event.target, 10);
        if (isNaN(issueNumber)) continue;

        // Extract title from metadata if available
        let title = `#${issueNumber}`;
        if (event.metadata) {
          try {
            const meta = JSON.parse(event.metadata);
            if (meta.title) title = meta.title;
          } catch {
            // Ignore parse errors
          }
        }

        // Look for time log entries related to this issue's category
        const timeRow = await db
          .prepare(
            "SELECT SUM(duration_minutes) as total FROM time_logs WHERE date(started_at) >= ? AND date(started_at) < date(?, '+7 days') AND tasks_completed > 0"
          )
          .bind(weekStart, weekStart)
          .first<{ total: number | null }>();

        if (timeRow?.total && timeRow.total > 0) {
          taskTimings.push({ number: issueNumber, title, minutes: timeRow.total });
        }
      }

      if (taskTimings.length > 0) {
        taskTimings.sort((a, b) => a.minutes - b.minutes);
        fastestTask = taskTimings[0];
        longestTask = taskTimings[taskTimings.length - 1];
        // Only show fastest/longest if they're different tasks
        if (fastestTask.number === longestTask.number) {
          longestTask = null;
        }
      }
    }
  } catch {
    // Best-effort
  }

  return {
    project,
    weekStart,
    tasksCompleted,
    tasksOpened,
    teamHours: totalTeamMinutes,
    perMember,
    fastestTask,
    longestTask,
  };
}

// ---------------------------------------------------------------------------
// Project config from KV
// ---------------------------------------------------------------------------

async function getProject(
  kv: KVNamespace,
  projectId: string,
  env?: Env
): Promise<ProjectConfig | null> {
  const raw = await kv.get(projectId);
  if (!raw) return null;
  try {
    const config = JSON.parse(raw) as ProjectConfig;
    // Prefer Worker Secret over KV-stored token (more secure)
    if (env?.GITHUB_API_TOKEN) {
      config.githubToken = env.GITHUB_API_TOKEN;
    }
    return config;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live Dashboard — rendering and send/edit logic
// ---------------------------------------------------------------------------

/**
 * Build the full dashboard text as HTML for Telegram.
 * Shows: online users, open GitHub issues grouped by label,
 * who is working on what (color-coded), and a timestamp.
 */
async function renderDashboard(
  env: Env,
  projectId: string,
  project: ProjectConfig
): Promise<string> {
  const members = await getTeamMembers(env.PROJECTS);
  const sessions = await getActiveSessions(env.PROJECTS, projectId);
  const dashState = await getDashboardState(env.PROJECTS, projectId);

  const lines: string[] = [];

  // Header
  lines.push(`\u{1F4CA} <b>${projectId}</b> \u{2014} Live Dashboard`);
  lines.push("\u{2500}".repeat(30));

  // Online users
  lines.push("");
  if (sessions.length > 0) {
    lines.push("\u{1F465} <b>Online:</b>");
    for (const s of sessions) {
      const color = getUserColorByName(members, s.user);
      const taskList =
        dashState.activeSessions.find((ds) => ds.user === s.user)?.tasks ||
        [];
      const taskText =
        taskList.length > 0
          ? " \u{2014} working on " +
            taskList.map((t) => "#" + t).join(", ")
          : "";
      lines.push(`${color} ${s.user}${taskText}`);
    }
  } else {
    lines.push("\u{1F465} <b>Online:</b> nobody right now");
  }

  // Category claims section
  const catClaims = await getCategoryClaims(env.PROJECTS, projectId);
  if (catClaims.claims.length > 0) {
    lines.push("");
    lines.push("\u{1F4C2} <b>Category Claims:</b>");
    for (const claim of catClaims.claims) {
      const color = getUserColor(members, claim.telegramId);
      lines.push(
        `${color} ${escapeHtml(claim.displayName)} \u{2192} ${escapeHtml(claim.telegramName)} (${claim.assignedIssues.length} issues)`
      );
    }
  }

  // Fetch GitHub issues
  let issues: Array<{
    number: number;
    title: string;
    labels?: Array<{ name: string }>;
    assignees?: Array<{ login: string }>;
  }> = [];

  if (project.githubToken) {
    const headers: Record<string, string> = {
      "User-Agent": "CortexBot",
      Authorization: "token " + project.githubToken,
    };
    const res = await fetch(
      "https://api.github.com/repos/" +
        project.githubRepo +
        "/issues?state=open&per_page=100",
      { headers }
    );
    if (res.ok) {
      issues = (await res.json()) as typeof issues;
    }
  }

  if (issues.length > 0) {
    // Group by label
    const grouped: Record<string, typeof issues> = {};
    const unlabeled: typeof issues = [];

    for (const issue of issues) {
      const labels = (issue.labels || []).map((l) => l.name);
      if (labels.length === 0) {
        unlabeled.push(issue);
      } else {
        for (const label of labels) {
          if (!grouped[label]) grouped[label] = [];
          grouped[label].push(issue);
        }
      }
    }

    lines.push("");
    lines.push(`\u{1F4CB} <b>Open Tasks</b> (${issues.length}):`);

    // Build a set of claimed task numbers
    const claimedTasks = new Map<number, string>(); // issue# -> user
    for (const ds of dashState.activeSessions) {
      for (const t of ds.tasks) {
        claimedTasks.set(t, ds.user);
      }
    }
    // Also check GitHub assignees
    for (const issue of issues) {
      if (
        issue.assignees &&
        issue.assignees.length > 0 &&
        !claimedTasks.has(issue.number)
      ) {
        claimedTasks.set(issue.number, issue.assignees[0].login);
      }
    }

    const labelKeys = Object.keys(grouped).sort();
    for (const label of labelKeys) {
      const labelIssues = grouped[label];
      lines.push("");
      lines.push(`<b>${label}</b> (${labelIssues.length}):`);
      for (const issue of labelIssues) {
        const claimer = claimedTasks.get(issue.number);
        if (claimer) {
          const color = getUserColorByName(members, claimer);
          lines.push(
            `${color} #${issue.number} ${issue.title} \u{2190} ${claimer}`
          );
        } else {
          lines.push(`\u{2B1C} #${issue.number} ${issue.title}`);
        }
      }
    }

    if (unlabeled.length > 0) {
      lines.push("");
      lines.push(`<b>other</b> (${unlabeled.length}):`);
      for (const issue of unlabeled) {
        const claimer = claimedTasks.get(issue.number);
        if (claimer) {
          const color = getUserColorByName(members, claimer);
          lines.push(
            `${color} #${issue.number} ${issue.title} \u{2190} ${claimer}`
          );
        } else {
          lines.push(`\u{2B1C} #${issue.number} ${issue.title}`);
        }
      }
    }
  }

  // Footer
  lines.push("");
  lines.push(
    `\u{1F552} Updated: ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`
  );

  return lines.join("\n");
}

/**
 * Send a new dashboard message or edit the existing one.
 * Stores the message_id in KV so subsequent calls edit the same message.
 * Includes inline buttons for Refresh, Claim Tasks, and Done.
 *
 * Uses raw fetch (not grammy) because this is also called from external
 * triggers (POST /dashboard/:projectId) outside the bot middleware.
 */
async function sendOrEditDashboard(
  env: Env,
  projectId: string,
  project: ProjectConfig
): Promise<void> {
  const text = await renderDashboard(env, projectId, project);
  const state = await getDashboardState(env.PROJECTS, projectId);

  const buttons = {
    inline_keyboard: [
      [
        { text: "\u{1F504} Refresh", callback_data: "refresh" },
        { text: "\u{1F465} Active", callback_data: "active" },
      ],
      [
        { text: "\u{1F4CB} Claim Tasks", callback_data: "claim" },
        { text: "\u{2705} Done", callback_data: "done" },
      ],
    ],
  };

  if (state.messageId) {
    // Try to edit existing message
    const body: Record<string, unknown> = {
      chat_id: project.chatId,
      message_id: state.messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: buttons,
    };

    const res = await fetch(
      `https://api.telegram.org/bot${project.botToken}/editMessageText`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      }
    );
    const result = (await res.json()) as { ok: boolean };

    if (result.ok) {
      state.lastUpdated = new Date().toISOString();
      await saveDashboardState(env.PROJECTS, projectId, state);
      return;
    }
    // If edit failed (message deleted etc.), fall through to send new
  }

  // Send new dashboard message
  const body: Record<string, unknown> = {
    chat_id: project.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: buttons,
  };
  if (project.threadId) body.message_thread_id = project.threadId;

  const res = await fetch(
    `https://api.telegram.org/bot${project.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    }
  );
  const result = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };

  if (result.ok && result.result?.message_id) {
    state.messageId = result.result.message_id;
    state.lastUpdated = new Date().toISOString();
    await saveDashboardState(env.PROJECTS, projectId, state);

    // Pin the dashboard message so it stays visible
    await fetch(
      `https://api.telegram.org/bot${project.botToken}/pinChatMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: project.chatId,
          message_id: result.result.message_id,
          disable_notification: true,
        }),
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Telegram helpers for sending messages with inline keyboards
// ---------------------------------------------------------------------------

/**
 * Send a message with an inline keyboard to a Telegram chat.
 * Returns the sent message's ID so it can be pinned afterwards.
 */
async function sendTelegramWithKeyboard(
  botToken: string,
  chatId: string,
  text: string,
  replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
  threadId?: number
): Promise<number | null> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  };

  if (threadId) {
    body.message_thread_id = threadId;
  }

  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    }
  );

  const result = (await res.json()) as {
    ok: boolean;
    result?: { message_id: number };
  };

  if (result.ok && result.result?.message_id) {
    return result.result.message_id;
  }
  return null;
}

/**
 * Pin a message in a Telegram chat (silently, without notification).
 */
async function pinMessage(
  botToken: string,
  chatId: string,
  messageId: number
): Promise<void> {
  await fetch(
    `https://api.telegram.org/bot${botToken}/pinChatMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        disable_notification: true,
      }),
    }
  );
}

// ---------------------------------------------------------------------------
// Control Panel — Login Channel (team-wide overview)
// ---------------------------------------------------------------------------

/**
 * Send and pin the Login Channel control message with 6 quick-access buttons.
 * This panel provides team-wide visibility: who is online, daily summary,
 * work hours, aggregated tasks, blockers, and open PRs across all projects.
 */
async function sendLoginControlMessage(
  project: ProjectConfig,
  env: Env
): Promise<void> {
  const chatId = project.loginChatId || project.chatId;

  const text =
    "\u{1F4CA} <b>Team Status \u{2014} Control Panel</b>\n\n" +
    "Use the buttons below for quick access:";

  const buttons = {
    inline_keyboard: [
      [
        { text: "\u{1F465} Who is on?", callback_data: "login_online" },
        { text: "\u{1F4CA} Today", callback_data: "login_today" },
      ],
      [
        { text: "\u{23F1} Work Hours", callback_data: "login_hours" },
        { text: "\u{1F4CB} All Tasks", callback_data: "login_tasks" },
      ],
      [
        { text: "\u{1F525} Blockers", callback_data: "login_blockers" },
        { text: "\u{1F504} Open PRs", callback_data: "login_prs" },
      ],
    ],
  };

  const messageId = await sendTelegramWithKeyboard(
    project.botToken,
    chatId,
    text,
    buttons,
    project.loginThreadId ?? undefined
  );

  if (messageId) {
    await pinMessage(project.botToken, chatId, messageId);
  }
}

// ---------------------------------------------------------------------------
// Control Panel — Project Group (project-specific)
// ---------------------------------------------------------------------------

/**
 * Send and pin the Project Group control message with 7 quick-access buttons.
 * This panel provides project-level actions: board view, personal tasks,
 * open PRs, review queue, urgent items, milestones, and weekly reports.
 */
async function sendProjectControlMessage(
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<void> {
  const text =
    `\u{1F4CB} <b>${projectId}</b> \u{2014} Control Panel\n\n` +
    "Use the buttons below for quick access:";

  const buttons = {
    inline_keyboard: [
      [
        { text: "\u{1F4CB} Board", callback_data: "project_board" },
        { text: "\u{1F4CC} My Tasks", callback_data: "project_mytasks" },
      ],
      [
        { text: "\u{1F500} Open PRs", callback_data: "project_prs" },
        { text: "\u{1F440} Needs Review", callback_data: "project_reviews" },
      ],
      [
        { text: "\u{1F525} Urgent", callback_data: "project_urgent" },
        { text: "\u{1F3AF} Milestone", callback_data: "project_milestone" },
      ],
      [
        { text: "\u{1F4C8} Weekly Report", callback_data: "project_weekly" },
      ],
      [
        { text: "\u{1F4C2} Assign Category", callback_data: "cat_assign" },
        { text: "\u{1F4CA} Category Status", callback_data: "cat_status" },
      ],
    ],
  };

  const messageId = await sendTelegramWithKeyboard(
    project.botToken,
    project.chatId,
    text,
    buttons,
    project.threadId
  );

  if (messageId) {
    await pinMessage(project.botToken, project.chatId, messageId);
  }
}

// ---------------------------------------------------------------------------
// Callback handlers — Login Channel buttons (fully implemented)
// ---------------------------------------------------------------------------

/**
 * Handle "Who is on?" button — show active sessions across ALL registered
 * projects. Iterates through KV keys to find all project sessions.
 */
async function handleLoginOnline(
  env: Env,
  project: ProjectConfig
): Promise<string> {
  // List all KV keys to discover registered projects
  const keyList = await env.PROJECTS.list();
  const members = await getTeamMembers(env.PROJECTS);

  const lines: string[] = [
    "\u{1F465} <b>Team Status (Live)</b>",
    "\u{2501}".repeat(16),
  ];

  let anyoneOnline = false;

  for (const key of keyList.keys) {
    const keyName = key.name;

    // Skip non-project keys (team-members, *:sessions, *:dashboard, etc.)
    if (
      keyName === "team-members" ||
      keyName.includes(":sessions") ||
      keyName.includes(":dashboard")
    ) {
      continue;
    }

    // This is a project key — check for active sessions
    const sessions = await getActiveSessions(env.PROJECTS, keyName);

    for (const s of sessions) {
      anyoneOnline = true;
      const color = getUserColorByName(members, s.user);
      lines.push(
        `\u{1F7E2} ${s.user} \u{2014} ${keyName} (since ${s.since})`
      );
    }
  }

  if (!anyoneOnline) {
    // Check all known members and mark them as offline
    if (members.length > 0) {
      for (const m of members) {
        lines.push(`\u{1F534} ${m.name} \u{2014} not seen today`);
      }
    } else {
      lines.push("No team members registered yet.");
      lines.push("Use /register <github-username> to join.");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Callback handlers — Project Group buttons (fully implemented)
// ---------------------------------------------------------------------------

/**
 * Handle "Board" button — show open GitHub issues grouped by status.
 * Provides a quick sprint-board overview with assigned vs unassigned issues.
 */
async function handleProjectBoard(
  project: ProjectConfig,
  projectId: string
): Promise<string> {
  if (!project.githubToken) {
    return "\u{1F4CB} No GitHub token configured. Cannot load board.";
  }

  const response = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues?state=open&per_page=50`,
    project.githubToken
  );

  if (!response.ok) {
    return `\u{1F4CB} GitHub API error: ${response.status}`;
  }

  const issues = (await response.json()) as Array<{
    number: number;
    title: string;
    assignee?: { login: string } | null;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;

  // Filter out pull requests (GitHub API returns PRs as issues too)
  const realIssues = issues.filter((i) => !i.pull_request);

  if (realIssues.length === 0) {
    return `\u{1F4CB} <b>${projectId}</b> \u{2014} Board\n\u{2501}`.repeat(0) +
      `\u{1F4CB} <b>${projectId}</b> \u{2014} Board\n\u{2501}${"\u{2501}".repeat(15)}\n\nNo open issues.`;
  }

  // Check for active blockers — show prominently at top
  const blockers = realIssues.filter((i) =>
    i.labels.some((l) => l.name === "priority:blocker")
  );

  const assigned = sortByPriority(realIssues.filter((i) => i.assignee));
  const unassigned = sortByPriority(realIssues.filter((i) => !i.assignee));

  const lines: string[] = [
    `\u{1F4CB} <b>${projectId}</b> \u{2014} Board`,
    "\u{2501}".repeat(16),
  ];

  // Blocker banner — shown when any blocker issue exists
  if (blockers.length > 0) {
    lines.push("");
    lines.push("\u{1F6A8} <b>BLOCKER</b> \u{2014} category claims paused:");
    for (const b of blockers) {
      lines.push(`  \u{2022} #${b.number} ${escapeHtml(b.title)}`);
    }
  }

  if (unassigned.length > 0) {
    lines.push(`\nOpen (${unassigned.length}):`);
    for (const issue of unassigned.slice(0, 15)) {
      const pri = formatPriority(getIssuePriority(issue.labels));
      lines.push(`${pri} #${issue.number} ${escapeHtml(issue.title)} [open]`);
    }
    if (unassigned.length > 15) {
      lines.push(`  ... and ${unassigned.length - 15} more`);
    }
  }

  if (assigned.length > 0) {
    lines.push(`\nIn Progress (${assigned.length}):`);
    for (const issue of assigned.slice(0, 15)) {
      const pri = formatPriority(getIssuePriority(issue.labels));
      lines.push(
        `${pri} #${issue.number} ${escapeHtml(issue.title)} [${escapeHtml(issue.assignee!.login)}]`
      );
    }
    if (assigned.length > 15) {
      lines.push(`  ... and ${assigned.length - 15} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Handle "My Tasks" button — show tasks assigned to the calling user.
 * Looks up the caller's GitHub username from the team registry, then
 * filters GitHub issues by assignee.
 */
async function handleProjectMyTasks(
  project: ProjectConfig,
  env: Env,
  callerTelegramId: number,
  callerFirstName: string
): Promise<string> {
  if (!project.githubToken) {
    return "\u{1F4CC} No GitHub token configured.";
  }

  // Look up the caller's GitHub username from the team registry
  const members = await getTeamMembers(env.PROJECTS);
  const member = members.find((m) => m.telegram_id === callerTelegramId);
  const githubUsername = member?.github;

  if (!githubUsername) {
    return (
      `\u{1F4CC} <b>Your Tasks, ${callerFirstName}</b>\n\u{2501}${"\u{2501}".repeat(15)}\n\n` +
      "You are not registered yet.\n" +
      "Use /register <github-username> to link your account."
    );
  }

  // Fetch issues assigned to this user
  const response = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues?state=open&assignee=${githubUsername}&per_page=30`,
    project.githubToken
  );

  if (!response.ok) {
    return `\u{1F4CC} GitHub API error: ${response.status}`;
  }

  const issues = (await response.json()) as Array<{
    number: number;
    title: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;

  // Filter out pull requests, then sort by priority
  const myIssues = sortByPriority(issues.filter((i) => !i.pull_request));

  // Check for active blockers — warn the user
  const blockers = await isBlockerActive(project);

  const safeFirstName = escapeHtml(callerFirstName);
  const lines: string[] = [
    `\u{1F4CC} <b>Your Tasks, ${safeFirstName}</b>`,
    "\u{2501}".repeat(16),
  ];

  if (blockers.length > 0) {
    lines.push("");
    lines.push("\u{1F6A8} <b>BLOCKER active</b> \u{2014} focus on these first:");
    for (const b of blockers) {
      lines.push(`  \u{2022} #${b.number} ${escapeHtml(b.title)}`);
    }
  }

  if (myIssues.length === 0) {
    lines.push("\nNo tasks assigned to you.");
    lines.push("Use /grab #1 #2 to claim some!");
  } else {
    lines.push(`\nAssigned to you (${myIssues.length}):`);
    for (const issue of myIssues) {
      const pri = formatPriority(getIssuePriority(issue.labels));
      lines.push(`${pri} #${issue.number} ${escapeHtml(issue.title)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Handle "Meine Aufgaben" — DM task list with priority sorting and
 * inline [Start] / [Done] buttons per task.
 *
 * Returns { text, keyboard } so the caller can send or edit the message.
 */
async function handleMeineAufgaben(
  env: Env,
  telegramId: number,
  firstName: string
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const kb = new InlineKeyboard();
  const safeFirstName = escapeHtml(firstName);

  // Resolve active project
  const active = await resolveActiveProject(env, telegramId);
  if (!active) {
    return {
      text: `\u{2705} <b>Meine Aufgaben, ${safeFirstName}</b>\n${"━".repeat(16)}\n\nNo project configured yet.`,
      keyboard: kb,
    };
  }

  const { projectId, projectConfig: project } = active;

  if (!project.githubToken) {
    return {
      text: `\u{2705} <b>Meine Aufgaben, ${safeFirstName}</b>\n${"━".repeat(16)}\n\n📌 No GitHub token configured.`,
      keyboard: kb,
    };
  }

  // Look up the caller's GitHub username
  const members = await getTeamMembers(env.PROJECTS);
  const member = members.find((m) => m.telegram_id === telegramId);
  const githubUsername = member?.github;

  if (!githubUsername) {
    return {
      text:
        `\u{2705} <b>Meine Aufgaben, ${safeFirstName}</b>\n${"━".repeat(16)}\n\n` +
        "You are not registered yet.\n" +
        "Use /register &lt;github-username&gt; to link your account.",
      keyboard: kb,
    };
  }

  // Fetch issues assigned to this user
  const response = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues?state=open&assignee=${githubUsername}&per_page=30`,
    project.githubToken
  );

  if (!response.ok) {
    return {
      text: `\u{2705} <b>Meine Aufgaben</b>\n\n⚠️ GitHub API error: ${response.status}`,
      keyboard: kb,
    };
  }

  const issues = (await response.json()) as Array<{
    number: number;
    title: string;
    labels: Array<{ name: string }>;
    pull_request?: unknown;
  }>;

  // Filter out pull requests, sort by priority (blocker first)
  const myIssues = sortByPriority(issues.filter((i) => !i.pull_request));

  // Read the user's currently active task and today's done counter
  const activeTaskNumber = await getActiveTask(env.PROJECTS, telegramId, projectId);
  const todayDone = await getTodayDoneCount(env.PROJECTS, telegramId);

  // Build the message
  const lines: string[] = [
    `\u{2705} <b>Meine Aufgaben, ${safeFirstName}</b>`,
    "━".repeat(16),
  ];

  if (myIssues.length === 0) {
    lines.push("");
    lines.push("No tasks assigned to you.");
    lines.push("");
    lines.push("Use \u{1F4CB} <b>Aufgabe nehmen</b> to claim a category first!");
    lines.push("");
    lines.push(`\u{1F3C6} Today completed: <b>${todayDone}</b>`);

    // Show daily tracked time (Issue #60)
    const dailyMinutes0 = await getDailyHours(env.DB, telegramId, new Date().toISOString().slice(0, 10));
    const currentTimer0 = await getTimer(env.PROJECTS, telegramId, projectId);
    let runningMinutes0 = 0;
    if (currentTimer0) {
      runningMinutes0 = Math.round(
        (Date.now() - new Date(currentTimer0.startedAt).getTime()) / 60000
      );
    }
    const totalMinutes0 = dailyMinutes0 + runningMinutes0;
    if (totalMinutes0 > 0) {
      lines.push(`\u{23F1} Today: <b>${formatDuration(totalMinutes0)}</b>`);
    }

    return { text: lines.join("\n"), keyboard: kb };
  }

  // Separate blockers from the rest for prominent display
  const blockerIssues = myIssues.filter(
    (i) => getIssuePriority(i.labels) === "priority:blocker"
  );
  const otherIssues = myIssues.filter(
    (i) => getIssuePriority(i.labels) !== "priority:blocker"
  );

  // Show blocker warning at top
  if (blockerIssues.length > 0) {
    lines.push("");
    lines.push("\u{1F6A8} <b>BLOCKER — fix these first:</b>");
    for (const issue of blockerIssues) {
      const isActive = issue.number === activeTaskNumber;
      const activeTag = isActive ? " ▶ <b>ACTIVE</b>" : "";
      lines.push(
        `\u{1F6A8} #${issue.number} ${escapeHtml(issue.title)}${activeTag}`
      );
      // Add Start/Done buttons for this blocker
      kb.text(
        isActive ? "▶ Active" : "▶ Start",
        `mytasks_start:${issue.number}`
      ).text("✅ Done", `mytasks_done:${issue.number}`);
      kb.row();
    }
  }

  // Show remaining tasks grouped by priority
  if (otherIssues.length > 0) {
    lines.push("");
    lines.push(`Assigned to you (${otherIssues.length}):`);
    for (const issue of otherIssues) {
      const priority = getIssuePriority(issue.labels);
      const emoji = PRIORITY_EMOJIS[priority] || PRIORITY_EMOJIS[PRIORITY_DEFAULT];
      const isActive = issue.number === activeTaskNumber;
      const activeTag = isActive ? " ▶ <b>ACTIVE</b>" : "";
      lines.push(
        `${emoji} #${issue.number} ${escapeHtml(issue.title)}${activeTag}`
      );
      // Add Start/Done buttons for this task
      kb.text(
        isActive ? "▶ Active" : "▶ Start",
        `mytasks_start:${issue.number}`
      ).text("✅ Done", `mytasks_done:${issue.number}`);
      kb.row();
    }
  }

  // Footer: today counter + time tracker + refresh + pause
  lines.push("");
  lines.push(`\u{1F3C6} Today completed: <b>${todayDone}</b>`);

  // Show daily tracked time (Issue #60)
  const dailyMinutes = await getDailyHours(env.DB, telegramId, new Date().toISOString().slice(0, 10));
  const currentTimer = await getTimer(env.PROJECTS, telegramId, projectId);
  let runningMinutes = 0;
  if (currentTimer) {
    runningMinutes = Math.round(
      (Date.now() - new Date(currentTimer.startedAt).getTime()) / 60000
    );
  }
  const totalMinutes = dailyMinutes + runningMinutes;
  if (totalMinutes > 0) {
    lines.push(`\u{23F1} Today: <b>${formatDuration(totalMinutes)}</b>`);
  }

  // Show Pause button when user has a claimed category
  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const myClaim = claimsState.claims.find((c) => c.telegramId === telegramId);
  if (myClaim) {
    kb.text("\u{23F8} Pause", "mytasks_pause");
  }

  // Show [Create Preview] when user has a claimed category with a branch
  // that has commits but no open PR yet
  if (myClaim && project.githubToken) {
    const categorySlug = myClaim.category.replace("area:", "").toLowerCase();
    const branchName = `feature/${categorySlug}`;

    try {
      // Check if there is already an open PR for this branch
      const owner = project.githubRepo.split("/")[0];
      const prsRes = await githubRequest(
        "GET",
        `/repos/${project.githubRepo}/pulls?state=open&head=${owner}:${branchName}&per_page=1`,
        project.githubToken
      );
      const prs = prsRes.ok
        ? ((await prsRes.json()) as Array<{ number: number }>)
        : [];

      if (prs.length === 0) {
        // No PR yet — check if branch exists (implies commits)
        const branchRes = await githubRequest(
          "GET",
          `/repos/${project.githubRepo}/branches/${encodeURIComponent(branchName)}`,
          project.githubToken
        );
        if (branchRes.ok) {
          kb.row();
          kb.text(
            "\u{1F680} Create Preview",
            `preview_create:${projectId}:${myClaim.category}`
          );
        }
      }
    } catch {
      // GitHub API error — silently skip button
    }
  }

  kb.text("\u{1F504} Refresh", "mytasks_refresh");

  return { text: lines.join("\n"), keyboard: kb };
}

// ---------------------------------------------------------------------------
// Preview & Merge helpers (Issue #56)
// ---------------------------------------------------------------------------

/**
 * Retrieve a Coolify preview URL from KV.
 * Returns null when no preview has been stored yet.
 */
async function getPreviewUrl(
  kv: KVNamespace,
  projectId: string,
  prNumber: number
): Promise<string | null> {
  return kv.get(`preview:${projectId}:${prNumber}`);
}

/**
 * Store a Coolify preview URL in KV with a 7-day TTL.
 * Preview links are ephemeral — they become stale after the branch is merged
 * or the deployment is torn down.
 */
async function setPreviewUrl(
  kv: KVNamespace,
  projectId: string,
  prNumber: number,
  url: string
): Promise<void> {
  await kv.put(`preview:${projectId}:${prNumber}`, url, { expirationTtl: 604800 });
}

/**
 * Create a Pull Request on GitHub for the given branch.
 * Returns the PR number and URL on success, null on failure.
 */
async function createPreviewPR(
  project: ProjectConfig,
  branchName: string,
  title: string,
  body: string
): Promise<{ number: number; html_url: string } | null> {
  if (!project.githubToken) return null;

  const res = await githubRequest(
    "POST",
    `/repos/${project.githubRepo}/pulls`,
    project.githubToken,
    { title, head: branchName, base: "main", body }
  );

  if (!res.ok) return null;
  const pr = (await res.json()) as { number: number; html_url: string };
  return pr;
}

/**
 * Submit a GitHub PR review (approve or request changes).
 * Returns true on success, false on failure.
 */
async function submitPRReview(
  project: ProjectConfig,
  prNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES",
  body?: string
): Promise<boolean> {
  if (!project.githubToken) return false;

  const payload: Record<string, string> = { event };
  if (body) payload.body = body;

  const res = await githubRequest(
    "POST",
    `/repos/${project.githubRepo}/pulls/${prNumber}/reviews`,
    project.githubToken,
    payload
  );

  return res.ok;
}

/**
 * Send a "please git pull" DM to all team members except the person who
 * merged the PR.  Always-on — not controlled by notification preferences
 * because stale local branches cause real problems.
 *
 * Deduplication: stores a KV key with 1h TTL to avoid sending the same
 * reminder if the webhook fires more than once.
 */
async function sendPullReminder(
  env: Env,
  botToken: string,
  mergerGithub: string,
  prTitle: string,
  prNumber: number,
  commitCount: number
): Promise<void> {
  // Dedup: check if we already sent this reminder
  const projects = await getProjectList(env);
  const projectId = projects.length > 0 ? projects[0].id : "default";
  const dedupKey = `pullreminder:${projectId}:${prNumber}`;
  const existing = await env.PROJECTS.get(dedupKey);
  if (existing) return;

  // Mark as sent (1h TTL) before sending to prevent races
  await env.PROJECTS.put(dedupKey, "1", { expirationTtl: 3600 });

  const members = await getTeamMembers(env.PROJECTS);

  for (const member of members) {
    // Skip the person who merged
    if (member.github === mergerGithub) continue;

    // Respect DND status
    const dnd = await isUserDND(env.PROJECTS, member.telegram_id);
    if (dnd) continue;

    const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
    if (!prefs.dm_chat_id) continue;

    const commitWord = commitCount === 1 ? "commit" : "commits";
    const text =
      `\u{1F504} <b>Pull Reminder</b>\n${"━".repeat(16)}\n\n` +
      `@${escapeHtml(mergerGithub)} merged PR #${prNumber}:\n` +
      `"${escapeHtml(prTitle)}"\n\n` +
      `\u{1F4E6} ${commitCount} ${commitWord} added to main.\n\n` +
      `\u{26A1} Please <code>git pull</code> before continuing work!`;

    const status = await sendDM(botToken, prefs.dm_chat_id, text);

    if (status === "blocked") {
      prefs.dm_chat_id = null;
      await saveUserPreferences(env.PROJECTS, member.telegram_id, prefs);
    }
  }
}

/**
 * Send preview link and review buttons to all team members.
 * Called after a PR is created via the [Create Preview] button.
 */
async function sendPreviewNotifications(
  env: Env,
  botToken: string,
  creatorTelegramId: number,
  prNumber: number,
  prTitle: string,
  prUrl: string,
  previewUrl: string | null
): Promise<void> {
  const members = await getTeamMembers(env.PROJECTS);

  for (const member of members) {
    // Skip the PR creator
    if (member.telegram_id === creatorTelegramId) continue;

    const dnd = await isUserDND(env.PROJECTS, member.telegram_id);
    if (dnd) continue;

    const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
    if (!prefs.dm_chat_id) continue;

    // Only send to members who opted in for previews or PR reviews
    if (!prefs.previews && !prefs.pr_reviews) continue;

    const previewLine = previewUrl
      ? `\n\u{1F310} <a href="${previewUrl}">Preview</a>`
      : "";

    const text =
      `\u{1F680} <b>New Preview</b>\n${"━".repeat(16)}\n\n` +
      `PR #${prNumber}: "${escapeHtml(prTitle)}"\n` +
      `\u{1F517} <a href="${prUrl}">View on GitHub</a>${previewLine}\n\n` +
      `Please review:`;

    const reviewKb: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> } = {
      inline_keyboard: [
        [
          { text: "\u{2705} Approve", callback_data: `review_approve:${prNumber}` },
          { text: "\u{270F}\u{FE0F} Request Changes", callback_data: `review_changes:${prNumber}` },
        ],
        [
          { text: "\u{1F517} View PR", url: prUrl },
        ],
      ],
    };

    const status = await sendDM(botToken, prefs.dm_chat_id, text, reviewKb);

    if (status === "blocked") {
      prefs.dm_chat_id = null;
      await saveUserPreferences(env.PROJECTS, member.telegram_id, prefs);
    }
  }
}

// ---------------------------------------------------------------------------
// Team Board — overview of all members, categories, and progress
// ---------------------------------------------------------------------------

/**
 * Render the Team Board view showing all team members with their current
 * category assignment, task progress, and branch status across all projects.
 *
 * Returns { text, keyboard } so the caller can send or edit the message.
 */
async function renderTeamBoard(
  env: Env,
  telegramId: number
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const kb = new InlineKeyboard();
  const members = await getTeamMembers(env.PROJECTS);
  const projects = await getProjectList(env);

  if (projects.length === 0) {
    return {
      text: "👥 <b>Team Board</b>\n━━━━━━━━━━━━━━━━\n\nNo projects configured yet.",
      keyboard: kb,
    };
  }

  const lines: string[] = [
    "👥 <b>Team Board</b>",
    "━".repeat(16),
  ];

  for (const { id: projectId, config: project } of projects) {
    lines.push("");
    lines.push(`📂 <b>${escapeHtml(projectId)}</b>`);
    lines.push("─".repeat(14));

    // Fetch all data for this project in parallel where possible
    const [claimsState, pausedCategories, openIssuesByCategory, openPRs] =
      await Promise.all([
        getCategoryClaims(env.PROJECTS, projectId),
        getPausedCategories(env.PROJECTS, projectId),
        project.githubToken
          ? fetchOpenIssuesByCategory(project, "area:")
          : Promise.resolve(new Map() as Map<string, Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }> }>>),
        project.githubToken
          ? githubRequest(
              "GET",
              `/repos/${project.githubRepo}/pulls?state=open&per_page=30`,
              project.githubToken
            )
              .then(async (res) => {
                if (!res.ok) return [];
                return (await res.json()) as Array<{
                  number: number;
                  title: string;
                  head: { ref: string };
                  user: { login: string };
                }>;
              })
              .catch(() => [] as Array<{ number: number; title: string; head: { ref: string }; user: { login: string } }>)
          : Promise.resolve([] as Array<{ number: number; title: string; head: { ref: string }; user: { login: string } }>),
      ]);

    // Build a set of open issue numbers for progress calculation
    const allOpenIssueNumbers = new Set<number>();
    for (const issues of openIssuesByCategory.values()) {
      for (const issue of issues) {
        allOpenIssueNumbers.add(issue.number);
      }
    }

    // Track which categories are claimed or paused so we know which are free
    const claimedCategories = new Set(
      claimsState.claims.map((c) => c.category)
    );
    const pausedCategoryNames = new Set(
      pausedCategories.map((p) => p.category)
    );

    // ── Claimed categories ──
    if (claimsState.claims.length > 0) {
      lines.push("");
      for (const claim of claimsState.claims) {
        const color = getUserColor(members, claim.telegramId);
        const safeName = escapeHtml(claim.telegramName);
        const safeDisplay = escapeHtml(claim.displayName);

        // Task progress: assigned issues that are no longer open = done
        const totalAssigned = claim.assignedIssues.length;
        const stillOpen = claim.assignedIssues.filter((n) =>
          allOpenIssueNumbers.has(n)
        ).length;
        const done = totalAssigned - stillOpen;
        const progressText =
          totalAssigned > 0 ? `${done}/${totalAssigned} done` : "0 issues";

        // Branch status: check for a matching open PR
        const categorySlug = claim.category
          .replace("area:", "")
          .toLowerCase();
        const matchingPR = openPRs.find((pr) =>
          pr.head.ref.includes(categorySlug)
        );
        let branchStatus = "in progress";
        if (matchingPR) {
          // Check for a preview URL stored by Coolify webhook
          const previewUrl = await getPreviewUrl(env.PROJECTS, projectId, matchingPR.number);
          if (previewUrl) {
            branchStatus = `PR open \u{00B7} <a href="${previewUrl}">Preview</a>`;
          } else {
            branchStatus = "PR open";
          }
        }

        lines.push(
          `${color} <b>${safeDisplay}</b> \u{2192} ${safeName}`
        );
        lines.push(
          `    \u{1F4CA} ${progressText} \u{00B7} ${branchStatus}`
        );

        // Show [Create Preview] button when this claim's branch exists
        // but has no open PR yet — the viewer can create one
        if (!matchingPR && project.githubToken && claim.telegramId === telegramId) {
          const branchName = `feature/${categorySlug}`;
          try {
            const branchRes = await githubRequest(
              "GET",
              `/repos/${project.githubRepo}/branches/${encodeURIComponent(branchName)}`,
              project.githubToken
            );
            if (branchRes.ok) {
              kb.text(
                "\u{1F680} Create Preview",
                `preview_create:${projectId}:${claim.category}`
              );
              kb.row();
            }
          } catch {
            // Branch does not exist or API error — skip button
          }
        }

        // Show tasks within this category sorted by priority
        const categoryIssues = openIssuesByCategory.get(claim.category);
        if (categoryIssues && categoryIssues.length > 0) {
          const sorted = sortByPriority(categoryIssues);
          for (const issue of sorted) {
            const priority = getIssuePriority(issue.labels);
            const emoji =
              PRIORITY_EMOJIS[priority] || PRIORITY_EMOJIS[PRIORITY_DEFAULT];
            lines.push(
              `    ${emoji} #${issue.number} ${escapeHtml(issue.title)}`
            );
          }
        }
      }
    }

    // ── Paused categories ──
    if (pausedCategories.length > 0) {
      lines.push("");
      for (const paused of pausedCategories) {
        const safePausedBy = escapeHtml(paused.pausedBy);
        const safeDisplay = escapeHtml(paused.displayName);
        lines.push(
          `⏸ <b>${safeDisplay}</b> — paused by ${safePausedBy} (${paused.completedTasks}/${paused.totalTasks} done)`
        );
      }
    }

    // ── Unclaimed categories (not claimed, not paused) ──
    const unclaimedCategories: Array<{ category: string; issueCount: number }> =
      [];
    for (const [category, issues] of openIssuesByCategory.entries()) {
      if (!claimedCategories.has(category) && !pausedCategoryNames.has(category)) {
        unclaimedCategories.push({ category, issueCount: issues.length });
      }
    }

    if (unclaimedCategories.length > 0) {
      lines.push("");
      lines.push("<i>Free categories:</i>");
      for (const { category, issueCount } of unclaimedCategories) {
        const displayName = category.replace("area:", "");
        lines.push(
          `⬜ ${escapeHtml(displayName)} — free (${issueCount} ${issueCount === 1 ? "issue" : "issues"})`
        );
      }
    }

    // Show "nothing here" if project has no categories at all
    if (
      claimsState.claims.length === 0 &&
      pausedCategories.length === 0 &&
      unclaimedCategories.length === 0
    ) {
      lines.push("");
      lines.push("<i>No categories found.</i>");
    }
  }

  // Footer with timestamp and refresh button
  const now = new Date();
  const timeStr = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  lines.push("");
  lines.push(`🕐 Updated: ${timeStr}`);

  kb.text("\u{1F4CA} Velocity", "board_velocity");
  kb.text("\u{1F504} Refresh", "teamboard_refresh");

  return { text: lines.join("\n"), keyboard: kb };
}

// ---------------------------------------------------------------------------
// Velocity View — weekly comparison accessible from Team Board (Issue #61)
// ---------------------------------------------------------------------------

/**
 * Format a delta value with a +/- prefix and directional arrow.
 * Positive = up (good for tasks, neutral for hours), negative = down.
 */
function formatDelta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "\u{2796} 0";
  const sign = diff > 0 ? "+" : "";
  const arrow = diff > 0 ? "\u{2B06}" : "\u{2B07}";
  return `${arrow} ${sign}${diff}`;
}

/**
 * Render the Velocity view showing this week vs last week comparison,
 * per-person breakdown, and fastest/longest task highlights.
 *
 * Returns { text, keyboard } so the caller can send or edit the message.
 */
async function renderVelocityView(
  env: Env
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const kb = new InlineKeyboard();
  const projects = await getProjectList(env);
  const members = await getTeamMembers(env.PROJECTS);

  if (projects.length === 0) {
    kb.text("\u{2B05}\u{FE0F} Back", "velocity_back");
    return {
      text: "\u{1F4CA} <b>Velocity</b>\n\u{2501}".repeat(16) + "\n\nNo projects configured yet.",
      keyboard: kb,
    };
  }

  const lines: string[] = [
    "\u{1F4CA} <b>Velocity Report</b>",
    "\u{2501}".repeat(16),
  ];

  for (const { id: projectId } of projects) {
    lines.push("");
    lines.push(`\u{1F4C2} <b>${escapeHtml(projectId)}</b>`);
    lines.push("\u{2500}".repeat(14));

    // Fetch the last two weeks of saved velocity data
    const [thisWeek, lastWeek] = await getLastTwoWeeksVelocity(
      env.DB,
      projectId
    );

    if (!thisWeek) {
      // No saved data yet — calculate live from current week
      const liveSnapshot = await calculateVelocitySnapshot(
        env.DB,
        projectId,
        members
      );

      lines.push("");
      lines.push(`\u{1F4C5} This week (${escapeHtml(liveSnapshot.weekStart)}):`);
      lines.push(`   \u{2705} Tasks closed: ${liveSnapshot.tasksCompleted}`);
      lines.push(`   \u{1F4DD} Tasks opened: ${liveSnapshot.tasksOpened}`);
      lines.push(`   \u{23F1} Team hours: ${formatDuration(liveSnapshot.teamHours)}`);

      if (liveSnapshot.perMember.length > 0) {
        lines.push("");
        lines.push("<b>Per Person:</b>");
        for (const pm of liveSnapshot.perMember) {
          const color = getUserColorByName(members, pm.name);
          lines.push(
            `${color} ${escapeHtml(pm.name)}: ${pm.tasks} tasks \u{00B7} ${formatDuration(pm.hours)}`
          );
        }
      }

      if (liveSnapshot.fastestTask) {
        lines.push("");
        lines.push(
          `\u{26A1} Fastest: #${liveSnapshot.fastestTask.number} ${escapeHtml(liveSnapshot.fastestTask.title)} (${formatDuration(liveSnapshot.fastestTask.minutes)})`
        );
      }
      if (liveSnapshot.longestTask) {
        lines.push(
          `\u{1F422} Longest: #${liveSnapshot.longestTask.number} ${escapeHtml(liveSnapshot.longestTask.title)} (${formatDuration(liveSnapshot.longestTask.minutes)})`
        );
      }

      lines.push("");
      lines.push("<i>No previous week data for comparison yet.</i>");
      continue;
    }

    // We have at least this week's data — show it with comparison if available
    lines.push("");
    lines.push(`\u{1F4C5} This week (${escapeHtml(thisWeek.weekStart)}):`);
    lines.push(`   \u{2705} Tasks closed: ${thisWeek.tasksCompleted}`);
    lines.push(`   \u{1F4DD} Tasks opened: ${thisWeek.tasksOpened}`);
    lines.push(`   \u{23F1} Team hours: ${formatDuration(thisWeek.teamHours)}`);

    if (lastWeek) {
      lines.push("");
      lines.push(`\u{1F4C5} Last week (${escapeHtml(lastWeek.weekStart)}):`);
      lines.push(`   \u{2705} Tasks closed: ${lastWeek.tasksCompleted}`);
      lines.push(`   \u{1F4DD} Tasks opened: ${lastWeek.tasksOpened}`);
      lines.push(`   \u{23F1} Team hours: ${formatDuration(lastWeek.teamHours)}`);

      // Delta comparison
      lines.push("");
      lines.push("<b>Week-over-Week:</b>");
      lines.push(
        `   Tasks: ${formatDelta(thisWeek.tasksCompleted, lastWeek.tasksCompleted)}`
      );
      lines.push(
        `   Hours: ${formatDelta(thisWeek.teamHours, lastWeek.teamHours)}`
      );
    }

    // Per-person breakdown (from this week's data)
    if (thisWeek.perMember.length > 0) {
      lines.push("");
      lines.push("<b>Per Person:</b>");
      for (const pm of thisWeek.perMember) {
        const color = getUserColorByName(members, pm.name);
        const safeName = escapeHtml(pm.name);
        lines.push(
          `${color} ${safeName}: ${pm.tasks} tasks \u{00B7} ${formatDuration(pm.hours)}`
        );
      }
    }

    // Fastest / longest task highlights
    if (thisWeek.fastestTask) {
      lines.push("");
      lines.push(
        `\u{26A1} Fastest: #${thisWeek.fastestTask.number} ${escapeHtml(thisWeek.fastestTask.title)} (${formatDuration(thisWeek.fastestTask.minutes)})`
      );
    }
    if (thisWeek.longestTask) {
      lines.push(
        `\u{1F422} Longest: #${thisWeek.longestTask.number} ${escapeHtml(thisWeek.longestTask.title)} (${formatDuration(thisWeek.longestTask.minutes)})`
      );
    }
  }

  // Footer
  const now = new Date();
  const timeStr = now.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  lines.push("");
  lines.push(`\u{1F555} Updated: ${timeStr}`);

  kb.text("\u{2B05}\u{FE0F} Back", "velocity_back");
  kb.text("\u{1F504} Refresh", "velocity_refresh");

  return { text: lines.join("\n"), keyboard: kb };
}

/**
 * Handle "Open PRs" button — show open pull requests with status info.
 * Uses GitHub API to fetch PRs and shows author, reviewer, and CI status.
 */
async function handleProjectPRs(
  project: ProjectConfig,
  projectId: string
): Promise<string> {
  if (!project.githubToken) {
    return "\u{1F500} No GitHub token configured.";
  }

  const response = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/pulls?state=open&per_page=20`,
    project.githubToken
  );

  if (!response.ok) {
    return `\u{1F500} GitHub API error: ${response.status}`;
  }

  const prs = (await response.json()) as Array<{
    number: number;
    title: string;
    user: { login: string };
    requested_reviewers?: Array<{ login: string }>;
    draft?: boolean;
  }>;

  const lines: string[] = [
    `\u{1F500} <b>Open PRs \u{2014} ${projectId}</b>`,
    "\u{2501}".repeat(16),
  ];

  if (prs.length === 0) {
    lines.push("\nNo open pull requests.");
    return lines.join("\n");
  }

  for (const pr of prs) {
    const draft = pr.draft ? " [DRAFT]" : "";
    const reviewers =
      pr.requested_reviewers && pr.requested_reviewers.length > 0
        ? pr.requested_reviewers.map((r) => r.login).join(", ")
        : "No reviewer";

    lines.push(
      `\n#${pr.number} "${pr.title}"${draft} \u{2014} @${pr.user.login}`
    );
    lines.push(`   \u{23F3} ${reviewers}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Settings Wizard — message builder
// ---------------------------------------------------------------------------

/**
 * Build the settings message text and inline keyboard for the notification
 * preferences panel. Shows toggle buttons with checkmarks/X marks.
 */
function buildSettingsMessage(prefs: UserPreferences): {
  text: string;
  keyboard: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
} {
  const on = "\u{2705}";  // green checkmark
  const off = "\u{274C}"; // red X

  const text =
    "\u{2699}\u{FE0F} <b>Notification Settings</b>\n" +
    "\u{2501}".repeat(20) + "\n\n" +
    `\u{1F512} Task Assignments \u{2014} always on\n` +
    `${prefs.commits ? on : off} Commit Notifications\n` +
    `${prefs.previews ? on : off} Preview Deployments\n` +
    `${prefs.pr_reviews ? on : off} PR Review Requests\n` +
    `${prefs.sessions ? on : off} Teammate Online/Offline\n\n` +
    "Tap a button to toggle notifications on/off:";

  const keyboard = {
    inline_keyboard: [
      [
        { text: `${prefs.commits ? on : off} Commits`, callback_data: "pref_toggle:commits" },
        { text: `${prefs.previews ? on : off} Previews`, callback_data: "pref_toggle:previews" },
      ],
      [
        { text: `${prefs.pr_reviews ? on : off} PR Reviews`, callback_data: "pref_toggle:pr_reviews" },
        { text: `${prefs.sessions ? on : off} Online/Offline`, callback_data: "pref_toggle:sessions" },
      ],
      [
        { text: "\u{1F4E6} Recent Commits", callback_data: "info:commits" },
        { text: "\u{1F310} Previews", callback_data: "info:previews" },
      ],
      [
        { text: "\u{1F465} Who is Online?", callback_data: "info:online" },
      ],
    ],
  };

  return { text, keyboard };
}

/**
 * Send a 3-message workflow tutorial explaining how the team bot works.
 * Used as the final onboarding step for new users.
 */
async function sendOnboardingTutorial(ctx: Context): Promise<void> {
  await ctx.reply(
    "\u{1F4D6} <b>How the Team Bot Works</b>\n" +
      "\u{2501}".repeat(20) +
      "\n\n" +
      "This bot helps your team coordinate work on projects. " +
      "Here\u2019s the workflow in 3 steps:",
    { parse_mode: "HTML" }
  );

  await ctx.reply(
    "1\u{FE0F}\u{20E3} <b>Claim a Category</b>\n" +
      "Pick a work area (e.g., \u201CFrontend\u201D, \u201CAPI\u201D). " +
      "All issues in that area get assigned to you.\n\n" +
      "2\u{FE0F}\u{20E3} <b>Work on Your Branch</b>\n" +
      "Create a feature branch and code. " +
      "When ready, create a PR \u2014 your team gets a preview link to review.\n\n" +
      "3\u{FE0F}\u{20E3} <b>Pull After Merge</b>\n" +
      "After your PR is merged, everyone gets a reminder to pull. " +
      "This keeps the whole team in sync.",
    { parse_mode: "HTML" }
  );

  await ctx.reply(
    "\u{26A1} <b>The Golden Rule</b>\n" +
      "\u{2501}".repeat(20) +
      "\n\n" +
      "<i>One person per category. Always pull after a merge.</i>\n\n" +
      "This prevents merge conflicts and keeps the team in sync.\n\n" +
      "\u{2705} You\u2019re all set! Use the buttons below to get started.",
    { parse_mode: "HTML" }
  );
}

// ---------------------------------------------------------------------------
// Category handler functions
// ---------------------------------------------------------------------------

/**
 * Show the category picker with issue counts per area: label.
 */
async function handleCategoryAssign(
  ctx: Context,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Block category claims when a blocker issue is active
  const blockers = await isBlockerActive(project);
  if (blockers.length > 0) {
    const blockerList = blockers
      .map((b) => `\u{2022} #${b.number} ${escapeHtml(b.title)}`)
      .join("\n");
    await ctx.editMessageText(
      `\u{1F6A8} <b>Blocker active \u{2014} claims paused</b>\n\n` +
        `The following blocker issue(s) must be resolved first:\n${blockerList}\n\n` +
        "Category claims will be available again once all blockers are closed.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Check if user already has a category claimed
  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const existingClaim = claimsState.claims.find((c) => c.telegramId === telegramId);

  if (existingClaim) {
    const text =
      `\u{26A0}\u{FE0F} You already have <b>${escapeHtml(existingClaim.displayName)}</b> ` +
      `(${existingClaim.assignedIssues.length} issues).\n\n` +
      "Release your current category first before claiming a new one.";

    const keyboard = {
      inline_keyboard: [
        [
          { text: "\u{1F5D1} Release Category", callback_data: "cat_release" },
          { text: "\u{274C} Cancel", callback_data: "cat_cancel" },
        ],
      ],
    };

    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    return;
  }

  // Fetch categories from GitHub
  const categories = await fetchOpenIssuesByCategory(project);
  const members = await getTeamMembers(env.PROJECTS);

  if (categories.size === 0) {
    await ctx.editMessageText(
      "\u{1F4C2} No categories found.\n\nAdd labels with the <code>area:</code> prefix to your GitHub issues to create categories.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Build category picker buttons with color indicators
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  const sortedCategories = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pausedList = await getPausedCategories(env.PROJECTS, projectId);

  for (const [label, issues] of sortedCategories) {
    const displayName = label.replace("area:", "");
    const claimer = claimsState.claims.find((c) => c.category === label);
    const paused = pausedList.find((p) => p.category === label);

    let buttonText: string;
    if (claimer) {
      const claimerColor = getUserColor(members, claimer.telegramId);
      buttonText = `${claimerColor} ${displayName} (${issues.length}) \u{2014} \u{1F512}${claimer.telegramName}`;
    } else if (paused) {
      // Paused — show pause icon + who paused + progress
      buttonText = `\u{23F8} ${displayName} (${issues.length}) \u{2014} paused by ${paused.pausedBy} (${paused.completedTasks}/${paused.totalTasks} done)`;
    } else {
      buttonText = `\u{1F7E2} ${displayName} (${issues.length}) \u{2014} free`;
    }

    buttons.push([{
      text: buttonText,
      callback_data: claimer ? "cat_cancel" : `cat_pick:${label}`,
    }]);
  }

  buttons.push([{ text: "\u{274C} Cancel", callback_data: "cat_cancel" }]);

  await ctx.editMessageText(
    "\u{1F4C2} <b>Choose a Category</b>\n\nPick a category to claim all its open issues:",
    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

/**
 * Show confirmation with the list of issues that will be assigned.
 */
async function handleCategoryPick(
  ctx: Context,
  project: ProjectConfig,
  env: Env,
  projectId: string,
  label: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Re-check race condition: is this category still available?
  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const existingClaimer = claimsState.claims.find((c) => c.category === label);

  if (existingClaimer) {
    await ctx.editMessageText(
      `\u{26A0}\u{FE0F} <b>${escapeHtml(label.replace("area:", ""))}</b> was just claimed by ${escapeHtml(existingClaimer.telegramName)}!`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Check if the caller already has a category
  const callerClaim = claimsState.claims.find((c) => c.telegramId === telegramId);
  if (callerClaim) {
    await ctx.editMessageText(
      `\u{26A0}\u{FE0F} You already have <b>${escapeHtml(callerClaim.displayName)}</b>. Release it first.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Fetch issues for this category, now including labels for priority sorting
  const categories = await fetchOpenIssuesByCategory(project);
  const issues = categories.get(label) || [];

  if (issues.length === 0) {
    await ctx.editMessageText(
      `\u{1F4C2} No open issues with label <code>${escapeHtml(label)}</code>.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Sort by priority (blocker → high → medium → low)
  const sorted = sortByPriority(issues);

  const displayName = label.replace("area:", "");
  const issueList = sorted
    .slice(0, 10)
    .map((i) => {
      const priority = getIssuePriority(i.labels);
      const emoji = PRIORITY_EMOJIS[priority] || PRIORITY_EMOJIS[PRIORITY_DEFAULT];
      return `${emoji} #${i.number} ${escapeHtml(i.title)}`;
    })
    .join("\n");
  const overflow = issues.length > 10 ? `\n...and ${issues.length - 10} more` : "";

  const text =
    `\u{1F4C2} <b>${escapeHtml(displayName)}</b> \u{2014} ${issues.length} issues\n\n` +
    `These issues will be assigned to you:\n${issueList}${overflow}\n\n` +
    "Confirm?";

  const keyboard = {
    inline_keyboard: [
      [
        { text: "\u{2705} Confirm", callback_data: `cat_confirm:${label}` },
        { text: "\u{2B05} Back", callback_data: "cat_assign" },
      ],
    ],
  };

  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
}

/**
 * Confirm category claim: assign issues on GitHub, save to KV, notify.
 */
async function handleCategoryConfirm(
  ctx: Context,
  project: ProjectConfig,
  env: Env,
  projectId: string,
  label: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || "Unknown";
  if (!telegramId) return;

  // Block confirmation when a blocker issue appeared between pick and confirm
  const blockers = await isBlockerActive(project);
  if (blockers.length > 0) {
    const blockerList = blockers
      .map((b) => `\u{2022} #${b.number} ${escapeHtml(b.title)}`)
      .join("\n");
    await ctx.editMessageText(
      `\u{1F6A8} <b>Blocker active \u{2014} claims paused</b>\n\n` +
        `A blocker appeared while you were choosing:\n${blockerList}\n\n` +
        "Try again once all blockers are closed.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Race-condition protection: re-read KV before confirming
  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const existingClaimer = claimsState.claims.find((c) => c.category === label);
  if (existingClaimer) {
    await ctx.editMessageText(
      `\u{26A0}\u{FE0F} Too late! <b>${escapeHtml(label.replace("area:", ""))}</b> was claimed by ${escapeHtml(existingClaimer.telegramName)}.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Double-check caller doesn't already have a category
  const callerClaim = claimsState.claims.find((c) => c.telegramId === telegramId);
  if (callerClaim) {
    await ctx.editMessageText(
      `\u{26A0}\u{FE0F} You already have <b>${escapeHtml(callerClaim.displayName)}</b>.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Look up GitHub username
  const members = await getTeamMembers(env.PROJECTS);
  const member = members.find((m) => m.telegram_id === telegramId);
  const githubUsername = member?.github || firstName;

  // Fetch issues for this label
  const categories = await fetchOpenIssuesByCategory(project);
  const issues = categories.get(label) || [];
  const issueNumbers = issues.map((i) => i.number);

  // Assign on GitHub
  const result = await assignIssuesToUser(project, issueNumbers, githubUsername);

  const displayName = label.replace("area:", "");
  const safeDisplayName = escapeHtml(displayName);
  const safeFirstName = escapeHtml(firstName);

  // Save claim to KV
  const claim: CategoryClaim = {
    telegramId,
    telegramName: firstName,
    githubUsername,
    category: label,
    displayName,
    assignedIssues: result.success,
    claimedAt: new Date().toISOString(),
  };
  claimsState.claims.push(claim);
  await saveCategoryClaims(env.PROJECTS, projectId, claimsState);

  // Start category timer (Issue #60)
  await startTimer(env.PROJECTS, telegramId, projectId, label);

  // Remove any paused marker for this category (someone is picking it up)
  await removePausedCategory(env.PROJECTS, projectId, label);

  // Update the message in the group
  const successText =
    `\u{2705} <b>${safeDisplayName}</b> \u{2192} ${safeFirstName}\n\n` +
    `${result.success.length} issues assigned` +
    (result.failed.length > 0 ? `, ${result.failed.length} failed` : "") +
    ".";

  await ctx.editMessageText(successText, { parse_mode: "HTML" });

  // Send DM with full task list, priority emojis, links, and branch name
  const prefs = await getUserPreferences(env.PROJECTS, telegramId);
  if (prefs.dm_chat_id) {
    const assignedIssues = sortByPriority(
      issues.filter((i) => result.success.includes(i.number))
    );
    const dmIssueList = assignedIssues
      .map((i) => {
        const priority = getIssuePriority(i.labels);
        const emoji = PRIORITY_EMOJIS[priority] || PRIORITY_EMOJIS[PRIORITY_DEFAULT];
        return `${emoji} <a href="${i.html_url}">#${i.number} ${escapeHtml(i.title)}</a>`;
      })
      .join("\n");

    // Branch name: feature/{category}, lowercased, spaces → dashes
    const branchName = `feature/${displayName.toLowerCase().replace(/\s+/g, "-")}`;

    const dmStatus = await sendDM(
      project.botToken,
      prefs.dm_chat_id,
      `\u{1F4C2} <b>Category Assigned: ${safeDisplayName}</b>\n` +
        `\u{1F4C2} Branch: <code>${escapeHtml(branchName)}</code>\n\n` +
        `You now own ${result.success.length} issues:\n${dmIssueList}\n\n` +
        "Use /done #N when you finish an issue."
    );
    if (dmStatus === "blocked") {
      prefs.dm_chat_id = null;
      await saveUserPreferences(env.PROJECTS, telegramId, prefs);
    }
  }

  // Post to group
  await sendTelegram(
    project.botToken,
    project.chatId,
    `\u{1F4C2} ${safeDisplayName} \u{2192} ${safeFirstName} (${result.success.length} issues)`,
    project.threadId
  );
}

/**
 * Show release confirmation for the user's current category.
 */
async function handleCategoryRelease(
  ctx: Context,
  env: Env,
  projectId: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const claim = claimsState.claims.find((c) => c.telegramId === telegramId);

  if (!claim) {
    await ctx.editMessageText(
      "\u{2139}\u{FE0F} You don't have a category claimed.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const text =
    `\u{1F5D1} Release <b>${escapeHtml(claim.displayName)}</b>?\n\n` +
    `${claim.assignedIssues.length} issues will be unassigned from you on GitHub.`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "\u{2705} Yes, release", callback_data: "cat_release_confirm" },
        { text: "\u{274C} Cancel", callback_data: "cat_cancel" },
      ],
    ],
  };

  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
}

/**
 * Confirm release: unassign on GitHub, remove from KV.
 */
async function handleCategoryReleaseConfirm(
  ctx: Context,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || "Unknown";
  if (!telegramId) return;

  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const claimIndex = claimsState.claims.findIndex((c) => c.telegramId === telegramId);

  if (claimIndex < 0) {
    await ctx.editMessageText(
      "\u{2139}\u{FE0F} No category to release.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const claim = claimsState.claims[claimIndex];

  // Unassign on GitHub
  await unassignIssuesFromUser(project, claim.assignedIssues, claim.githubUsername);

  // Remove from KV
  claimsState.claims.splice(claimIndex, 1);
  await saveCategoryClaims(env.PROJECTS, projectId, claimsState);

  // Stop category timer and log time (Issue #60)
  const timerState = await stopTimer(env.PROJECTS, telegramId, projectId);
  if (timerState) {
    const endedAt = new Date().toISOString();
    const durationMinutes = Math.round(
      (new Date(endedAt).getTime() - new Date(timerState.startedAt).getTime()) / 60000
    );
    await logTimeEntry(env.DB, {
      userId: telegramId,
      project: projectId,
      category: timerState.category,
      startedAt: timerState.startedAt,
      endedAt,
      durationMinutes,
      tasksCompleted: 0,
    });
  }

  const safeDisplayName = escapeHtml(claim.displayName);
  const safeFirstName = escapeHtml(firstName);

  await ctx.editMessageText(
    `\u{1F5D1} <b>${safeDisplayName}</b> released by ${safeFirstName}.\n` +
      `${claim.assignedIssues.length} issues unassigned.`,
    { parse_mode: "HTML" }
  );

  // Post to group
  await sendTelegram(
    project.botToken,
    project.chatId,
    `\u{1F5D1} ${safeDisplayName} released by ${safeFirstName}`,
    project.threadId
  );
}

/**
 * Show pause confirmation dialog.  Explains that tasks will be unassigned
 * and the category freed, but the branch stays on GitHub.
 */
async function handlePause(
  ctx: Context,
  env: Env,
  project: ProjectConfig,
  projectId: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const claim = claimsState.claims.find((c) => c.telegramId === telegramId);

  if (!claim) {
    await ctx.editMessageText(
      "\u{2139}\u{FE0F} You don\u2019t have a category to pause.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const safeDisplayName = escapeHtml(claim.displayName);

  const text =
    `\u{23F8} <b>Pause ${safeDisplayName}?</b>\n\n` +
    `This will:\n` +
    `\u{2022} Unassign ${claim.assignedIssues.length} issues from you on GitHub\n` +
    `\u{2022} Free the category for someone else to claim\n` +
    `\u{2022} Mark it as \u201Cpaused\u201D so the next person knows the state\n\n` +
    `\u{2705} Your <b>branch stays on GitHub</b> \u{2014} nothing is lost.\n` +
    `The next developer can continue right where you left off.`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "\u{23F8} Yes, pause", callback_data: "mytasks_pause_confirm" },
        { text: "\u{274C} Cancel", callback_data: "mytasks_refresh" },
      ],
    ],
  };

  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
}

/**
 * Execute the pause: unassign issues, remove claim, store paused marker,
 * clear active task, and notify the team.
 */
async function handlePauseConfirm(
  ctx: Context,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  const firstName = ctx.from?.first_name || "Unknown";
  if (!telegramId) return;

  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const claimIndex = claimsState.claims.findIndex((c) => c.telegramId === telegramId);

  if (claimIndex < 0) {
    await ctx.editMessageText(
      "\u{2139}\u{FE0F} No category to pause.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const claim = claimsState.claims[claimIndex];
  const safeDisplayName = escapeHtml(claim.displayName);
  const safeFirstName = escapeHtml(firstName);

  // Count completed tasks: compare originally assigned vs. currently open
  let completedCount = 0;
  const totalCount = claim.assignedIssues.length;

  if (project.githubToken && claim.assignedIssues.length > 0) {
    // Check which of the originally assigned issues are still open
    let openCount = 0;
    for (const issueNum of claim.assignedIssues) {
      try {
        const res = await githubRequest(
          "GET",
          `/repos/${project.githubRepo}/issues/${issueNum}`,
          project.githubToken
        );
        if (res.ok) {
          const issue = (await res.json()) as { state: string };
          if (issue.state === "open") {
            openCount++;
          }
        } else {
          // API error — count as open to be safe
          openCount++;
        }
      } catch {
        // Network error — count as open to be safe
        openCount++;
      }
    }
    completedCount = totalCount - openCount;
  }

  // 1. Unassign all open issues on GitHub
  await unassignIssuesFromUser(project, claim.assignedIssues, claim.githubUsername);

  // 2. Remove claim from KV
  claimsState.claims.splice(claimIndex, 1);
  await saveCategoryClaims(env.PROJECTS, projectId, claimsState);

  // 3. Store paused marker so the category picker shows the status
  const pausedEntry: PausedCategory = {
    category: claim.category,
    displayName: claim.displayName,
    pausedBy: firstName,
    completedTasks: completedCount,
    totalTasks: totalCount,
    pausedAt: new Date().toISOString(),
  };
  await addPausedCategory(env.PROJECTS, projectId, pausedEntry);

  // 4. Clear the user's active task
  await clearActiveTask(env.PROJECTS, telegramId, projectId);

  // 5. Stop category timer and log time (Issue #60)
  const timerState = await stopTimer(env.PROJECTS, telegramId, projectId);
  if (timerState) {
    const endedAt = new Date().toISOString();
    const durationMinutes = Math.round(
      (new Date(endedAt).getTime() - new Date(timerState.startedAt).getTime()) / 60000
    );
    await logTimeEntry(env.DB, {
      userId: telegramId,
      project: projectId,
      category: timerState.category,
      startedAt: timerState.startedAt,
      endedAt,
      durationMinutes,
      tasksCompleted: completedCount,
    });
  }

  // 6. Confirm to user
  await ctx.editMessageText(
    `\u{23F8} <b>${safeDisplayName}</b> paused by ${safeFirstName}.\n\n` +
      `${completedCount}/${totalCount} tasks completed.\n` +
      `Branch preserved on GitHub \u{2014} the next developer can continue.`,
    { parse_mode: "HTML" }
  );

  // 7. Notify team in group chat
  await sendTelegram(
    project.botToken,
    project.chatId,
    `\u{23F8} ${safeDisplayName} paused by ${safeFirstName} (${completedCount}/${totalCount} done) \u{2014} category available!`,
    project.threadId
  );

  // 8. Notify subscribers that a category is available
  await notifySubscribers(
    env,
    project.botToken,
    "tasks",
    () =>
      `\u{1F4CB} <b>${safeDisplayName}</b> is available again!\n` +
      `Paused by ${safeFirstName} (${completedCount}/${totalCount} done).\n` +
      `Branch is preserved \u{2014} use \u{1F4CB} Aufgabe nehmen to continue.`,
    telegramId
  );
}

/**
 * Show who has which category.
 */
async function handleCategoryStatus(
  ctx: Context,
  env: Env,
  projectId: string
): Promise<void> {
  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const members = await getTeamMembers(env.PROJECTS);

  if (claimsState.claims.length === 0) {
    await ctx.editMessageText(
      "\u{1F4CA} <b>Category Status</b>\n\nNo categories claimed yet.\nUse the \u{1F4C2} Assign Category button to get started.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const lines: string[] = ["\u{1F4CA} <b>Category Status</b>", ""];

  for (const claim of claimsState.claims) {
    const color = getUserColor(members, claim.telegramId);
    lines.push(
      `${color} <b>${escapeHtml(claim.displayName)}</b> \u{2192} ${escapeHtml(claim.telegramName)} ` +
        `(${claim.assignedIssues.length} issues, since ${claim.claimedAt.substring(0, 10)})`
    );
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: "\u{1F504} Refresh", callback_data: "cat_status" }],
    ],
  };

  await ctx.editMessageText(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

/**
 * Handle the "Aufgabe nehmen" reply keyboard button.
 * Mirrors handleCategoryAssign but uses ctx.reply() instead of
 * ctx.editMessageText(), since reply keyboard buttons produce new messages
 * rather than inline callback edits.
 */
async function handleAufgabeNehmen(
  ctx: Context,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  // Block category claims when a blocker issue is active
  const blockers = await isBlockerActive(project);
  if (blockers.length > 0) {
    const blockerList = blockers
      .map((b) => `\u{2022} #${b.number} ${escapeHtml(b.title)}`)
      .join("\n");
    await ctx.reply(
      `\u{1F6A8} <b>Blocker active \u{2014} claims paused</b>\n\n` +
        `The following blocker issue(s) must be resolved first:\n${blockerList}\n\n` +
        "Category claims will be available again once all blockers are closed.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Check if user already has a category claimed
  const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
  const existingClaim = claimsState.claims.find((c) => c.telegramId === telegramId);

  if (existingClaim) {
    const text =
      `\u{26A0}\u{FE0F} You already have <b>${escapeHtml(existingClaim.displayName)}</b> ` +
      `(${existingClaim.assignedIssues.length} issues).\n\n` +
      "Release your current category first before claiming a new one.";

    const keyboard = {
      inline_keyboard: [
        [
          { text: "\u{1F5D1} Release Category", callback_data: "cat_release" },
          { text: "\u{274C} Cancel", callback_data: "cat_cancel" },
        ],
      ],
    };

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    return;
  }

  // Fetch categories from GitHub
  const categories = await fetchOpenIssuesByCategory(project);
  const members = await getTeamMembers(env.PROJECTS);

  if (categories.size === 0) {
    await ctx.reply(
      "\u{1F4C2} No categories found.\n\nAdd labels with the <code>area:</code> prefix to your GitHub issues to create categories.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Build category picker buttons with color indicators
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  const sortedCategories = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const pausedList = await getPausedCategories(env.PROJECTS, projectId);

  for (const [label, issues] of sortedCategories) {
    const displayName = label.replace("area:", "");
    const claimer = claimsState.claims.find((c) => c.category === label);
    const paused = pausedList.find((p) => p.category === label);

    let buttonText: string;
    if (claimer) {
      // Claimed — show lock icon + claimer's color + name
      const claimerColor = getUserColor(members, claimer.telegramId);
      buttonText = `${claimerColor} ${displayName} (${issues.length}) \u{2014} \u{1F512}${claimer.telegramName}`;
    } else if (paused) {
      // Paused — show pause icon + who paused + progress
      buttonText = `\u{23F8} ${displayName} (${issues.length}) \u{2014} paused by ${paused.pausedBy} (${paused.completedTasks}/${paused.totalTasks} done)`;
    } else {
      // Free — show green indicator
      buttonText = `\u{1F7E2} ${displayName} (${issues.length}) \u{2014} free`;
    }

    buttons.push([{
      text: buttonText,
      callback_data: claimer ? "cat_cancel" : `cat_pick:${label}`,
    }]);
  }

  buttons.push([{ text: "\u{274C} Cancel", callback_data: "cat_cancel" }]);

  await ctx.reply(
    "\u{1F4CB} <b>Aufgabe nehmen</b>\n\nPick a category to claim all its open issues:",
    { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
  );
}

// ---------------------------------------------------------------------------
// Project list helper — used by createBot and cron handlers
// ---------------------------------------------------------------------------

async function getProjectList(env: Env): Promise<Array<{ id: string; config: ProjectConfig }>> {
  const keys = await env.PROJECTS.list();
  const projects: Array<{ id: string; config: ProjectConfig }> = [];
  for (const key of keys.keys) {
    if (key.name.includes(":") || key.name === "team-members") continue;
    const config = await getProject(env.PROJECTS, key.name, env);
    if (config) projects.push({ id: key.name, config });
  }
  return projects;
}

// ---------------------------------------------------------------------------
// Home screen helper — re-used by /start, onboarding, and project switch
// ---------------------------------------------------------------------------

/**
 * Send the project header (with Switch button) and the 5-button reply
 * keyboard.  Extracted so that project switching can re-render the home
 * screen without duplicating the layout logic.
 */
async function renderHomeScreen(
  ctx: Context,
  env: Env,
  telegramId: number
): Promise<void> {
  const active = await resolveActiveProject(env, telegramId);
  if (active) {
    const projectName = escapeHtml(active.projectId);
    await ctx.reply(
      `\u{1F4C2} <b>Project:</b> ${projectName}`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "\u{1F504} Switch", callback_data: "home_switch_project" }]],
        },
      }
    );
  }

  const keyboard = new Keyboard()
    .text("\u{1F4CB} Aufgabe nehmen").text("\u{2705} Meine Aufgaben")
    .row()
    .text("\u{1F465} Team Board").text("\u{1F4A1} Neue Idee")
    .row()
    .text("\u{2753} Hilfe")
    .resized()
    .persistent();

  await ctx.reply("\u{2328}\u{FE0F} Quick actions activated! Use the buttons below.", {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });
}

// ---------------------------------------------------------------------------
// grammy bot factory — creates a bot instance with all handlers registered
// ---------------------------------------------------------------------------

/**
 * Create a grammy Bot instance with all command, callback, and keyboard
 * handlers registered. Called once per incoming Telegram webhook request
 * with the matching project configuration.
 *
 * We pass env and projectId via closure so handlers can access KV.
 */
function createBot(
  project: ProjectConfig,
  env: Env,
  projectId: string
): Bot {
  const bot = new Bot(project.botToken);

  // Global error handler — prevents errors from leaking to Telegram users
  bot.catch((err) => {
    console.error(`[Bot Error] ${err.message}`);
  });

  // -------------------------------------------------------------------
  // Private-chat middleware — auto-save dm_chat_id on first DM
  // -------------------------------------------------------------------

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type === "private" && ctx.from?.id) {
      const telegramId = ctx.from.id;
      const prefs = await getUserPreferences(env.PROJECTS, telegramId);
      if (!prefs.dm_chat_id || prefs.dm_chat_id !== ctx.chat.id) {
        prefs.dm_chat_id = ctx.chat.id;
        await saveUserPreferences(env.PROJECTS, telegramId, prefs);
      }
    }
    await next();
  });

  // -------------------------------------------------------------------
  // Command handlers
  // -------------------------------------------------------------------

  // /start, /menu — activate reply keyboard; trigger onboarding for new DM users
  bot.command(["start", "menu"], async (ctx: Context) => {
    const telegramId = ctx.from?.id;

    // In private chat: check if this user needs onboarding first
    if (ctx.chat?.type === "private" && telegramId) {
      const members = await getTeamMembers(env.PROJECTS);
      const isMember = members.some((m) => m.telegram_id === telegramId);
      const onboarded = await isOnboarded(env.PROJECTS, telegramId);

      if (!isMember && !onboarded) {
        // Start the 3-step onboarding wizard
        await setOnboardingState(env.PROJECTS, telegramId, "awaiting_github");
        await ctx.reply(
          "\u{1F44B} <b>Welcome to the Team Bot!</b>\n\n" +
            "Let\u2019s get you set up in 3 quick steps.\n\n" +
            "<b>Step 1/3: GitHub Account</b>\n" +
            "Please send me your GitHub username:",
          { parse_mode: "HTML" }
        );
        return;
      }
    }

    // Normal flow for registered / already-onboarded users

    // Project header with inline [Switch] button
    if (telegramId) {
      const active = await resolveActiveProject(env, telegramId);
      if (active) {
        const projectName = escapeHtml(active.projectId);
        await ctx.reply(
          `\u{1F4C2} <b>Project:</b> ${projectName}`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "\u{1F504} Switch", callback_data: "home_switch_project" }]],
            },
          }
        );
      }
    }

    // New 5-button reply keyboard
    const keyboard = new Keyboard()
      .text("\u{1F4CB} Aufgabe nehmen").text("\u{2705} Meine Aufgaben")
      .row()
      .text("\u{1F465} Team Board").text("\u{1F4A1} Neue Idee")
      .row()
      .text("\u{2753} Hilfe")
      .resized()
      .persistent();

    await ctx.reply("\u{2328}\u{FE0F} Quick actions activated! Use the buttons below.", {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  });

  // /dashboard — send or refresh the live dashboard
  bot.command("dashboard", async () => {
    await sendOrEditDashboard(env, projectId, project);
  });

  // /active — show who is currently working
  bot.command("active", async () => {
    await sendActiveInfo(env, project, projectId);
  });

  // /tasks — list open GitHub issues
  bot.command("tasks", async () => {
    await handleTasksCommand(env, project, projectId);
  });

  // /wer — show who is currently working (German alias)
  bot.command("wer", async () => {
    await handleWerCommand(env, project, projectId);
  });

  // /new <title> — create a new GitHub issue
  bot.command("new", async (ctx: Context) => {
    const title = ctx.match as string;
    await handleNewCommand(project, title);
  });

  // /assign #N @name — assign a GitHub issue
  bot.command("assign", async (ctx: Context) => {
    const args = ctx.match as string;
    await handleAssignCommand(project, args);
  });

  // /done #N — close a GitHub issue
  bot.command("done", async (ctx: Context) => {
    const args = ctx.match as string;
    await handleDoneCommand(project, args);
  });

  // /grab #1 #2 #3 — claim tasks for yourself
  bot.command("grab", async (ctx: Context) => {
    const argsText = ctx.match as string;
    const fromUser = ctx.from?.first_name || "Unknown";

    const taskNumbers =
      argsText.match(/#?(\d+)/g)?.map((n) => parseInt(n.replace("#", ""), 10)) || [];

    if (taskNumbers.length === 0) {
      await sendTelegram(
        project.botToken,
        project.chatId,
        "Usage: /grab #1 #2 #3",
        project.threadId
      );
      return;
    }

    const state = await getDashboardState(env.PROJECTS, projectId);

    // Find or create user's session in dashboard state
    let userSession = state.activeSessions.find((s) => s.user === fromUser);
    if (!userSession) {
      userSession = {
        user: fromUser,
        since: new Date().toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        tasks: [],
      };
      state.activeSessions.push(userSession);
    }

    // Add new tasks (avoid duplicates)
    for (const t of taskNumbers) {
      if (!userSession.tasks.includes(t)) userSession.tasks.push(t);
    }

    // Also assign on GitHub if token available
    if (project.githubToken) {
      const members = await getTeamMembers(env.PROJECTS);
      const member = members.find((m) => m.name === fromUser);
      const githubUser = member?.github || fromUser;

      for (const num of taskNumbers) {
        try {
          await fetch(
            `https://api.github.com/repos/${project.githubRepo}/issues/${num}/assignees`,
            {
              method: "POST",
              headers: {
                "User-Agent": "CortexBot",
                Authorization: "token " + project.githubToken,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ assignees: [githubUser] }),
            }
          );
        } catch {
          // Best-effort — don't fail the whole command if GitHub is unreachable
        }
      }
    }

    await saveDashboardState(env.PROJECTS, projectId, state);

    // Update dashboard
    await sendOrEditDashboard(env, projectId, project);

    const taskStr = taskNumbers.map((t) => "#" + t).join(", ");
    await sendTelegram(
      project.botToken,
      project.chatId,
      `${fromUser} claimed ${taskStr}`,
      project.threadId
    );
  });

  // /register <github-username> — register sender as a team member
  // /dnd — personal do not disturb
  bot.command("dnd", async (ctx: Context) => {
    const args = ((ctx.match as string) || "").trim();
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (args === "off") {
      await env.PROJECTS.delete(`dnd:${telegramId}`);
      await ctx.reply("\u{1F514} DND disabled. You will receive notifications again.");
      return;
    }

    const match = args.match(/^(\d+)([hmd])$/);
    if (!match) {
      await ctx.reply("Usage:\n/dnd 2h \u{2014} silence for 2 hours\n/dnd 30m \u{2014} silence for 30 minutes\n/dnd 1d \u{2014} silence for 1 day\n/dnd off \u{2014} disable DND");
      return;
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2];
    let seconds = 0;
    if (unit === "m") seconds = amount * 60;
    else if (unit === "h") seconds = amount * 3600;
    else if (unit === "d") seconds = amount * 86400;

    // Minimum 60s (KV TTL requirement)
    if (seconds < 60) seconds = 60;

    await env.PROJECTS.put(`dnd:${telegramId}`, new Date(Date.now() + seconds * 1000).toISOString(), { expirationTtl: seconds });

    const timeStr = new Date(Date.now() + seconds * 1000).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
    });
    await ctx.reply(`\u{1F515} DND enabled until ${timeStr}. Use /dnd off to disable.`);
  });

  bot.command("register", async (ctx: Context) => {
    const githubUsername = (ctx.match as string).trim();

    if (!githubUsername) {
      await ctx.reply(
        "Usage: /register <github-username>\n\nExample: /register NabilW1995"
      );
      return;
    }

    const telegramId = ctx.from?.id;
    const telegramUsername = ctx.from?.username || "";
    const firstName = ctx.from?.first_name || "Unknown";

    if (!telegramId) {
      await ctx.reply("Could not identify your Telegram account.");
      return;
    }

    // Save to central team registry
    await upsertTeamMember(env.PROJECTS, {
      telegram_id: telegramId,
      telegram_username: telegramUsername || firstName,
      github: githubUsername.replace(/^@/, ""),
      name: firstName,
    });

    // Retrieve updated member list to show the assigned color
    const members = await getTeamMembers(env.PROJECTS);
    const color = getUserColor(members, telegramId);

    await ctx.reply(
      `${color} <b>Registered!</b>\n\n` +
        `Telegram: @${telegramUsername || firstName}\n` +
        `GitHub: ${githubUsername.replace(/^@/, "")}\n\n` +
        `You can now use:\n` +
        `\u{1F4CB} /tasks \u{2014} see open tasks\n` +
        `\u{1F4CC} /grab #1 #2 \u{2014} claim tasks\n` +
        `\u{2705} /done #5 \u{2014} mark task done\n` +
        `\u{1F4CA} /dashboard \u{2014} live dashboard`,
      { parse_mode: "HTML" }
    );
  });

  // /setup — send and pin the control panel with all buttons
  bot.command("setup", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Determine whether this is the Login Channel or a Project Group
    const isLoginChannel =
      project.loginChatId && String(chatId) === String(project.loginChatId);

    if (isLoginChannel) {
      await sendLoginControlMessage(project, env);
      await ctx.reply("\u{2705} Login Control Panel sent and pinned.");
    } else {
      await sendProjectControlMessage(project, env, projectId);
      await ctx.reply("\u{2705} Project Control Panel sent and pinned.");
    }
  });

  // /settings — open notification preferences
  bot.command("settings", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    if (ctx.chat?.type === "private") {
      // In private chat: show settings panel directly
      const prefs = await getUserPreferences(env.PROJECTS, telegramId);
      const { text, keyboard } = buildSettingsMessage(prefs);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    } else {
      // In group: ask the user to go to DM
      await ctx.reply(
        "\u{2699}\u{FE0F} Send me /settings in a private chat to manage your notifications.",
        { parse_mode: "HTML" }
      );

      // Also try to send a DM with the settings panel
      const prefs = await getUserPreferences(env.PROJECTS, telegramId);
      if (prefs.dm_chat_id) {
        const { text, keyboard } = buildSettingsMessage(prefs);
        const dmStatus = await sendDM(project.botToken, prefs.dm_chat_id, text, keyboard);
        if (dmStatus === "blocked") {
          prefs.dm_chat_id = null;
          await saveUserPreferences(env.PROJECTS, telegramId, prefs);
        }
      }
    }
  });

  // -------------------------------------------------------------------
  // Callback query handlers (inline button presses on the dashboard)
  // -------------------------------------------------------------------

  bot.callbackQuery("refresh", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    await sendOrEditDashboard(env, projectId, project);
  });

  bot.callbackQuery("active", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    await sendActiveInfo(env, project, projectId);
  });

  bot.callbackQuery("claim", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const fromUser = ctx.from?.first_name || "Unknown";
    await sendTelegram(
      project.botToken,
      project.chatId,
      `${fromUser}: To claim tasks, use /grab #1 #2 #3`,
      project.threadId
    );
  });

  bot.callbackQuery("done", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const fromUser = ctx.from?.first_name || "Unknown";
    await sendTelegram(
      project.botToken,
      project.chatId,
      `${fromUser}: To mark tasks done, use /done #1`,
      project.threadId
    );
  });

  // -------------------------------------------------------------------
  // Login Channel callback handlers (control panel buttons)
  // -------------------------------------------------------------------

  bot.callbackQuery("login_online", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const text = await handleLoginOnline(env, project);
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      text,
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_today", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F4CA} Daily summary coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_hours", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const workHours = await getWorkHoursToday(env.DB);
    const members = await getTeamMembers(env.PROJECTS);

    const lines: string[] = ["\u{23F1} <b>Work Hours Today</b>", "\u{2500}".repeat(25), ""];

    if (workHours.length === 0) {
      lines.push("No sessions recorded today.");
    } else {
      const maxMinutes = Math.max(...workHours.map((w) => w.total_minutes), 1);
      for (const w of workHours) {
        const color = getUserColorByName(members, w.user_id);
        const hours = Math.floor(w.total_minutes / 60);
        const mins = w.total_minutes % 60;
        const blocks = Math.round((w.total_minutes / maxMinutes) * 10);
        const bar = "\u{2588}".repeat(blocks) + "\u{2591}".repeat(10 - blocks);
        lines.push(`${color} ${w.user_id}`);
        lines.push(`   ${bar} ${hours}h ${mins}m`);
      }
    }

    const chatId = project.loginChatId || project.chatId;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (project.loginThreadId) body.message_thread_id = project.loginThreadId;
    await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  });

  bot.callbackQuery("login_tasks", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F4CB} Aggregated task view coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_blockers", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F525} Blocker detection coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_prs", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F504} Cross-repo PR view coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  // -------------------------------------------------------------------
  // Project Group callback handlers (control panel buttons)
  // -------------------------------------------------------------------

  bot.callbackQuery("project_board", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const text = await handleProjectBoard(project, projectId);
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.callbackQuery("project_mytasks", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const telegramId = ctx.from?.id || 0;
    const firstName = ctx.from?.first_name || "Unknown";
    const text = await handleProjectMyTasks(
      project,
      env,
      telegramId,
      firstName
    );
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.callbackQuery("project_prs", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const text = await handleProjectPRs(project, projectId);
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.callbackQuery("project_reviews", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const githubToken = getGitHubToken(env, project);
    if (!githubToken) { await sendTelegram(project.botToken, project.chatId, "\u{1F440} No GitHub token.", project.threadId); return; }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=20`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + githubToken } }
      );
      if (!res.ok) throw new Error("API");
      const prs = await res.json() as Array<{
        number: number; title: string; html_url: string; user: { login: string };
        requested_reviewers: Array<{ login: string }>; draft: boolean; created_at: string;
      }>;
      const needsReview = prs.filter(pr => !pr.draft && pr.requested_reviewers.length === 0);
      const pendingReview = prs.filter(pr => !pr.draft && pr.requested_reviewers.length > 0);

      const lines: string[] = ["\u{1F440} <b>Review Queue</b>", ""];
      if (needsReview.length > 0) {
        lines.push("\u{1F6A8} <b>No reviewer assigned:</b>");
        for (const pr of needsReview) {
          const age = Math.round((Date.now() - new Date(pr.created_at).getTime()) / 3600000);
          lines.push(`\u{2022} #${pr.number} ${pr.title} (@${pr.user.login}, ${age}h)\n   \u{1F517} ${pr.html_url}`);
        }
      }
      if (pendingReview.length > 0) {
        lines.push("");
        lines.push("\u{23F3} <b>Waiting for review:</b>");
        for (const pr of pendingReview) {
          const reviewers = pr.requested_reviewers.map(r => r.login).join(", ");
          lines.push(`\u{2022} #${pr.number} ${pr.title} \u{2192} ${reviewers}`);
        }
      }
      if (needsReview.length === 0 && pendingReview.length === 0) {
        lines.push("\u{2705} All PRs reviewed or no open PRs!");
      }
      const body: Record<string, unknown> = {
        chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
      };
      if (project.threadId) body.message_thread_id = project.threadId;
      await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
      });
    } catch {
      await sendTelegram(project.botToken, project.chatId, "\u{1F440} Could not load review queue.", project.threadId);
    }
  });

  bot.callbackQuery("project_urgent", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const githubToken = getGitHubToken(env, project);
    if (!githubToken) { await sendTelegram(project.botToken, project.chatId, "\u{1F525} No GitHub token.", project.threadId); return; }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/issues?state=open&labels=urgent,blocked,critical&per_page=20`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + githubToken } }
      );
      if (!res.ok) throw new Error("API");
      const issues = await res.json() as Array<{
        number: number; title: string; html_url: string;
        labels: Array<{ name: string }>; assignee: { login: string } | null;
      }>;
      const lines: string[] = ["\u{1F525} <b>Urgent & Blocked</b>", ""];
      if (issues.length === 0) {
        lines.push("\u{2705} No urgent or blocked issues!");
      } else {
        for (const issue of issues) {
          const labels = issue.labels.map(l => l.name).join(", ");
          const assignee = issue.assignee ? issue.assignee.login : "unassigned";
          lines.push(`\u{2022} #${issue.number} ${issue.title} [${labels}] \u{2192} ${assignee}\n   \u{1F517} ${issue.html_url}`);
        }
      }
      const body: Record<string, unknown> = {
        chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
      };
      if (project.threadId) body.message_thread_id = project.threadId;
      await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
      });
    } catch {
      await sendTelegram(project.botToken, project.chatId, "\u{1F525} Could not load urgent issues.", project.threadId);
    }
  });

  bot.callbackQuery("project_milestone", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const githubToken = getGitHubToken(env, project);
    if (!githubToken) {
      await sendTelegram(project.botToken, project.chatId, "\u{1F3AF} No GitHub token configured.", project.threadId);
      return;
    }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/milestones?state=open&sort=due_on&per_page=3`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + githubToken } }
      );
      if (!res.ok) throw new Error("API error");
      const milestones = await res.json() as Array<{
        title: string; open_issues: number; closed_issues: number; due_on: string | null; html_url: string;
      }>;
      if (milestones.length === 0) {
        await sendTelegram(project.botToken, project.chatId, "\u{1F3AF} No open milestones found.", project.threadId);
        return;
      }
      const lines: string[] = ["\u{1F3AF} <b>Milestones</b>", ""];
      for (const m of milestones) {
        const total = m.open_issues + m.closed_issues;
        const pct = total > 0 ? Math.round((m.closed_issues / total) * 100) : 0;
        const blocks = Math.round(pct / 10);
        const bar = "\u{2588}".repeat(blocks) + "\u{2591}".repeat(10 - blocks);
        const due = m.due_on ? ` (due ${m.due_on.substring(0, 10)})` : "";
        lines.push(`<b>${m.title}</b>${due}`);
        lines.push(`${bar} ${pct}% (${m.closed_issues}/${total})`);
        lines.push(`\u{2022} ${m.open_issues} remaining`);
        lines.push("");
      }
      const body: Record<string, unknown> = {
        chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
      };
      if (project.threadId) body.message_thread_id = project.threadId;
      await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
      });
    } catch {
      await sendTelegram(project.botToken, project.chatId, "\u{1F3AF} Could not load milestones.", project.threadId);
    }
  });

  bot.callbackQuery("project_weekly", async (ctx: Context) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    // Fetch merged PRs from last 7 days as changelog
    const githubToken = getGitHubToken(env, project);
    const lines: string[] = ["\u{1F4C8} <b>Weekly Report</b>", ""];

    // D1 stats
    try {
      const weekEvents = await env.DB.prepare(
        "SELECT event_type, COUNT(*) as c FROM events WHERE repo = ? AND created_at > datetime('now', '-7 days') GROUP BY event_type"
      ).bind(project.githubRepo).all<{ event_type: string; c: number }>();

      if (weekEvents.results && weekEvents.results.length > 0) {
        const stats: Record<string, number> = {};
        for (const e of weekEvents.results) stats[e.event_type] = e.c;
        lines.push(`\u{1F4DD} Issues: ${stats["issues.opened"] || 0} opened, ${stats["issues.closed"] || 0} closed`);
        lines.push(`\u{1F500} PRs: ${stats["pr.merged"] || 0} merged, ${stats["pr.opened"] || 0} opened`);
        lines.push("");
      }
    } catch {}

    // Recent merged PRs as changelog
    if (githubToken) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/pulls?state=closed&sort=updated&direction=desc&per_page=10`,
          { headers: { "User-Agent": "CortexBot", Authorization: "token " + githubToken } }
        );
        if (res.ok) {
          const prs = await res.json() as Array<{ number: number; title: string; merged_at: string | null; user: { login: string } }>;
          const merged = prs.filter(pr => pr.merged_at);
          if (merged.length > 0) {
            lines.push("<b>Merged PRs:</b>");
            for (const pr of merged.slice(0, 5)) {
              lines.push(`\u{2022} #${pr.number} ${pr.title} (@${pr.user.login})`);
            }
          }
        }
      } catch {}
    }

    // Work hours
    try {
      const hours = await getWorkHoursToday(env.DB);
      if (hours.length > 0) {
        lines.push("");
        lines.push("<b>Work Hours (today):</b>");
        const members = await getTeamMembers(env.PROJECTS);
        for (const w of hours) {
          const color = getUserColorByName(members, w.user_id);
          const h = Math.floor(w.total_minutes / 60);
          const m = w.total_minutes % 60;
          lines.push(`${color} ${w.user_id}: ${h}h ${m}m`);
        }
      }
    } catch {}

    const body: Record<string, unknown> = {
      chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true,
    };
    if (project.threadId) body.message_thread_id = project.threadId;
    await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
    });
  });

  // -------------------------------------------------------------------
  // Contextual action callbacks — claim review, claim issue
  // -------------------------------------------------------------------

  bot.callbackQuery(/^claim_review:(\d+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const prNumber = parseInt(ctx.match![1], 10);
    const fromUser = ctx.from?.first_name || "Unknown";
    const members = await getTeamMembers(env.PROJECTS);
    const member = members.find((m) => m.telegram_id === ctx.from?.id);
    const githubUser = member?.github || fromUser;

    if (project.githubToken) {
      try {
        await fetch(
          `https://api.github.com/repos/${project.githubRepo}/pulls/${prNumber}/requested_reviewers`,
          {
            method: "POST",
            headers: { "User-Agent": "CortexBot", Authorization: "token " + project.githubToken, "Content-Type": "application/json" },
            body: JSON.stringify({ reviewers: [githubUser] }),
          }
        );
        await sendTelegram(project.botToken, project.chatId,
          `\u{2705} ${fromUser} assigned as reviewer on PR #${prNumber}`, project.threadId);
      } catch {
        await sendTelegram(project.botToken, project.chatId,
          `\u{274C} Could not assign reviewer. Check GitHub permissions.`, project.threadId);
      }
    }
  });

  bot.callbackQuery(/^claim_issue:(\d+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const issueNumber = parseInt(ctx.match![1], 10);
    const fromUser = ctx.from?.first_name || "Unknown";
    const members = await getTeamMembers(env.PROJECTS);
    const member = members.find((m) => m.telegram_id === ctx.from?.id);
    const githubUser = member?.github || fromUser;

    if (project.githubToken) {
      try {
        await fetch(
          `https://api.github.com/repos/${project.githubRepo}/issues/${issueNumber}/assignees`,
          {
            method: "POST",
            headers: { "User-Agent": "CortexBot", Authorization: "token " + project.githubToken, "Content-Type": "application/json" },
            body: JSON.stringify({ assignees: [githubUser] }),
          }
        );
        await sendTelegram(project.botToken, project.chatId,
          `\u{2705} ${fromUser} claimed Issue #${issueNumber}`, project.threadId);
      } catch {
        await sendTelegram(project.botToken, project.chatId,
          `\u{274C} Could not assign issue. Check GitHub permissions.`, project.threadId);
      }
    }
  });

  // -------------------------------------------------------------------
  // Preference toggle callbacks (Settings Wizard)
  // -------------------------------------------------------------------

  bot.callbackQuery(/^pref_toggle:(commits|previews|pr_reviews|sessions)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const field = ctx.match![1] as keyof UserPreferences;
    const prefs = await getUserPreferences(env.PROJECTS, telegramId);

    // Flip the boolean
    (prefs as unknown as Record<string, unknown>)[field] = !prefs[field];
    await saveUserPreferences(env.PROJECTS, telegramId, prefs);

    // Re-render the settings message in place
    const { text, keyboard } = buildSettingsMessage(prefs);
    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch {
      // Message unchanged or expired — safe to ignore
    }
  });

  // -------------------------------------------------------------------
  // On-demand info callbacks (Settings Wizard)
  // -------------------------------------------------------------------

  bot.callbackQuery("info:commits", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}

    // Query D1 events table for recent pushes
    const lines: string[] = ["\u{1F4E6} <b>Recent Commits</b>", ""];
    try {
      const events = await env.DB.prepare(
        `SELECT actor, target, metadata, created_at
         FROM events
         WHERE event_type LIKE 'push%'
         ORDER BY created_at DESC LIMIT 10`
      ).all<{ actor: string; target: string; metadata: string; created_at: string }>();

      if (events.results && events.results.length > 0) {
        for (const e of events.results) {
          let commitCount = "";
          try {
            const meta = JSON.parse(e.metadata || "{}");
            commitCount = meta.commit_count ? ` (${meta.commit_count} commits)` : "";
          } catch {}
          lines.push(`\u{2022} ${e.actor} \u{2192} ${e.target}${commitCount}`);
          lines.push(`  ${e.created_at}`);
        }
      } else {
        lines.push("No recent push events recorded.");
      }
    } catch {
      lines.push("Could not load commit data.");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.callbackQuery("info:previews", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    await ctx.reply("\u{1F310} No active previews right now.\n\nThis feature will show deployment preview links in a future update.");
  });

  bot.callbackQuery("info:online", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}

    const sessions = await getActiveSessions(env.PROJECTS, projectId);
    const members = await getTeamMembers(env.PROJECTS);

    if (sessions.length === 0) {
      await ctx.reply("\u{1F465} Nobody is currently online.");
      return;
    }

    const lines: string[] = ["\u{1F465} <b>Currently Online</b>", ""];
    for (const s of sessions) {
      const color = getUserColorByName(members, s.user);
      lines.push(`${color} ${s.user} (since ${s.since})`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  // -------------------------------------------------------------------
  // Category assignment callbacks
  // -------------------------------------------------------------------

  bot.callbackQuery("cat_assign", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    await handleCategoryAssign(ctx, project, env, projectId);
  });

  bot.callbackQuery(/^cat_pick:(.+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const label = ctx.match![1];
    await handleCategoryPick(ctx, project, env, projectId, label);
  });

  bot.callbackQuery(/^cat_confirm:(.+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const label = ctx.match![1];
    await handleCategoryConfirm(ctx, project, env, projectId, label);
  });

  bot.callbackQuery("cat_cancel", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    try {
      await ctx.editMessageText("\u{274C} Cancelled.", { parse_mode: "HTML" });
    } catch {}
  });

  bot.callbackQuery("cat_release", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    await handleCategoryRelease(ctx, env, projectId);
  });

  bot.callbackQuery("cat_release_confirm", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    await handleCategoryReleaseConfirm(ctx, project, env, projectId);
  });

  bot.callbackQuery("cat_status", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    await handleCategoryStatus(ctx, env, projectId);
  });

  // -------------------------------------------------------------------
  // "Meine Aufgaben" inline button callbacks — Start, Done, Refresh
  // -------------------------------------------------------------------

  bot.callbackQuery(/^mytasks_start:(\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const issueNumber = parseInt(ctx.match![1], 10);
    const firstName = ctx.from?.first_name || "User";

    try {
      const active = await resolveActiveProject(env, telegramId);
      if (!active) {
        await ctx.answerCallbackQuery({ text: "No project configured." });
        return;
      }

      // Set as active task in KV
      await setActiveTask(env.PROJECTS, telegramId, active.projectId, issueNumber);

      // Refresh the whole task list to reflect the new active state
      const { text, keyboard } = await handleMeineAufgaben(env, telegramId, firstName);
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
      try { await ctx.answerCallbackQuery(); } catch {}

      // Generate and send Claude Code prompt as DM (non-blocking)
      try {
        const prefs = await getUserPreferences(env.PROJECTS, telegramId);
        if (prefs.dm_chat_id) {
          // Find the user's category claim to use for branch naming
          const claimsState = await getCategoryClaims(env.PROJECTS, active.projectId);
          const userClaim = claimsState.claims.find(
            (c) => c.telegramId === telegramId
          );
          const category = userClaim?.displayName || null;

          const prompt = await generateClaudePrompt(
            active.projectConfig,
            issueNumber,
            category
          );

          // Truncate prompt to stay within Telegram's 4096-char message limit
          const MAX_PROMPT_CHARS = 3400;
          const safePrompt = prompt.length > MAX_PROMPT_CHARS
            ? prompt.slice(0, MAX_PROMPT_CHARS) + "\n... (truncated)"
            : prompt;

          const dmText =
            `\u{1F680} <b>Claude Code Prompt for #${issueNumber}</b>\n\n` +
            `<pre>${escapeHtml(safePrompt)}</pre>\n\n` +
            `<i>\u{1F4A1} Long-press the code block above to copy, then paste into VS Code.</i>`;

          const dmStatus = await sendDM(
            active.projectConfig.botToken,
            prefs.dm_chat_id,
            dmText
          );

          if (dmStatus === "blocked") {
            prefs.dm_chat_id = null;
            await saveUserPreferences(env.PROJECTS, telegramId, prefs);
          }
        }
      } catch (promptErr) {
        // Prompt generation is best-effort — don't fail the task start
        console.error("generateClaudePrompt DM error:", promptErr);
      }
    } catch (err) {
      console.error("mytasks_start error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not start task." });
      } catch {}
    }
  });

  bot.callbackQuery(/^mytasks_done:(\d+)$/, async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const issueNumber = parseInt(ctx.match![1], 10);
    const firstName = ctx.from?.first_name || "User";

    try {
      const active = await resolveActiveProject(env, telegramId);
      if (!active) {
        await ctx.answerCallbackQuery({ text: "No project configured." });
        return;
      }

      const { projectConfig: proj } = active;
      if (!proj.githubToken) {
        await ctx.answerCallbackQuery({ text: "No GitHub token configured." });
        return;
      }

      // Close the issue on GitHub
      const closeRes = await githubRequest(
        "PATCH",
        `/repos/${proj.githubRepo}/issues/${issueNumber}`,
        proj.githubToken,
        { state: "closed" }
      );

      if (!closeRes.ok) {
        await ctx.answerCallbackQuery({
          text: `GitHub error closing #${issueNumber}: ${closeRes.status}`,
        });
        return;
      }

      // Clear active task if it was the one being completed
      const currentActive = await getActiveTask(
        env.PROJECTS,
        telegramId,
        active.projectId
      );
      if (currentActive === issueNumber) {
        await clearActiveTask(env.PROJECTS, telegramId, active.projectId);
      }

      // Increment daily counter
      const newCount = await incrementTodayDoneCount(env.PROJECTS, telegramId);

      // Refresh the task list to show the issue removed
      const { text, keyboard } = await handleMeineAufgaben(env, telegramId, firstName);
      const footer = `\n\n✅ <b>#${issueNumber} closed!</b> (Today: ${newCount})`;
      await ctx.editMessageText(text + footer, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
      try { await ctx.answerCallbackQuery(); } catch {}
    } catch (err) {
      console.error("mytasks_done error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not complete task." });
      } catch {}
    }
  });

  bot.callbackQuery("mytasks_refresh", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const firstName = ctx.from?.first_name || "User";

    try {
      const { text, keyboard } = await handleMeineAufgaben(env, telegramId, firstName);
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("mytasks_refresh error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not refresh." });
      } catch {}
    }
  });

  // -------------------------------------------------------------------
  // Team Board — Refresh callback
  // -------------------------------------------------------------------

  bot.callbackQuery("teamboard_refresh", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const { text, keyboard } = await renderTeamBoard(env, telegramId);
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("teamboard_refresh error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not refresh Team Board." });
      } catch {}
    }
  });

  // -------------------------------------------------------------------
  // Velocity — View, Refresh, Back callbacks (Issue #61)
  // -------------------------------------------------------------------

  bot.callbackQuery("board_velocity", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    try {
      const { text, keyboard } = await renderVelocityView(env);
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("board_velocity error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not load Velocity view." });
      } catch {}
    }
  });

  bot.callbackQuery("velocity_refresh", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    try {
      const { text, keyboard } = await renderVelocityView(env);
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("velocity_refresh error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not refresh Velocity." });
      } catch {}
    }
  });

  bot.callbackQuery("velocity_back", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;
    try {
      const { text, keyboard } = await renderTeamBoard(env, telegramId);
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("velocity_back error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not go back." });
      } catch {}
    }
  });

  // -------------------------------------------------------------------
  // Preview & Merge — Create Preview, Approve, Request Changes (#56)
  // -------------------------------------------------------------------

  /**
   * [Create Preview] button — creates a PR on GitHub and notifies the team.
   * Callback data format: preview_create:{projectId}:{category}
   */
  bot.callbackQuery(/^preview_create:([^:]+):(.+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery({ text: "Creating PR..." }); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const targetProjectId = ctx.match![1];
    const category = ctx.match![2];

    try {
      const targetProject = await getProject(env.PROJECTS, targetProjectId, env);
      if (!targetProject || !targetProject.githubToken) {
        try { await ctx.answerCallbackQuery({ text: "Project or token not found." }); } catch {}
        return;
      }

      // Resolve who is creating the PR
      const members = await getTeamMembers(env.PROJECTS);
      const member = members.find((m) => m.telegram_id === telegramId);
      if (!member) {
        try { await ctx.answerCallbackQuery({ text: "You are not registered." }); } catch {}
        return;
      }

      const categorySlug = category.replace("area:", "").toLowerCase();
      const displayName = category.replace("area:", "");
      const branchName = `feature/${categorySlug}`;

      // Build PR title and body from category info
      const prTitle = `feat: ${displayName}`;
      const prBody =
        `## ${displayName}\n\n` +
        `Category: \`${category}\`\n` +
        `Created by: @${member.github} via Cortex Team Bot`;

      const pr = await createPreviewPR(targetProject, branchName, prTitle, prBody);
      if (!pr) {
        await ctx.editMessageText(
          `\u{26A0}\u{FE0F} Could not create PR for branch <code>${escapeHtml(branchName)}</code>.\n` +
          "The branch may not exist or there may already be a PR.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Log the event
      await logEvent(env.DB, targetProject.githubRepo, "pr.created_via_bot", member.github, String(pr.number));

      // Check if a preview URL already exists (Coolify may have deployed)
      const previewUrl = await getPreviewUrl(env.PROJECTS, targetProjectId, pr.number);

      // Update the message with success info
      const previewLine = previewUrl
        ? `\n\u{1F310} <a href="${previewUrl}">Preview</a>`
        : "\n\u{23F3} Waiting for Coolify preview deployment...";

      const successKb = new InlineKeyboard();
      successKb.url("\u{1F517} View PR", pr.html_url);
      successKb.row();
      successKb.text("\u{1F504} Refresh", "mytasks_refresh");

      await ctx.editMessageText(
        `\u{2705} <b>PR Created!</b>\n${"━".repeat(16)}\n\n` +
        `PR #${pr.number}: "${escapeHtml(prTitle)}"\n` +
        `\u{1F517} <a href="${pr.html_url}">View on GitHub</a>${previewLine}`,
        { parse_mode: "HTML", reply_markup: successKb }
      );

      // Notify team members about the new preview
      await sendPreviewNotifications(
        env,
        targetProject.botToken,
        telegramId,
        pr.number,
        prTitle,
        pr.html_url,
        previewUrl
      );
    } catch (err) {
      console.error("preview_create error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Error creating PR." });
      } catch {}
    }
  });

  /**
   * [Approve] button — submits an APPROVE review via GitHub API.
   * Self-approve is allowed but marked in the review body.
   * Callback data format: review_approve:{prNumber}
   */
  bot.callbackQuery(/^review_approve:(\d+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery({ text: "Submitting approval..." }); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const prNumber = parseInt(ctx.match![1], 10);

    try {
      const active = await resolveActiveProject(env, telegramId);
      if (!active || !active.projectConfig.githubToken) {
        try { await ctx.answerCallbackQuery({ text: "No project configured." }); } catch {}
        return;
      }

      const { projectConfig: proj } = active;

      // Look up reviewer's GitHub username
      const members = await getTeamMembers(env.PROJECTS);
      const reviewer = members.find((m) => m.telegram_id === telegramId);
      if (!reviewer) {
        try { await ctx.answerCallbackQuery({ text: "You are not registered." }); } catch {}
        return;
      }

      // Fetch PR to detect self-approve
      const prRes = await githubRequest(
        "GET",
        `/repos/${proj.githubRepo}/pulls/${prNumber}`,
        proj.githubToken!
      );
      let isSelfApprove = false;
      if (prRes.ok) {
        const prData = (await prRes.json()) as { user: { login: string } };
        isSelfApprove = prData.user.login === reviewer.github;
      }

      const reviewBody = isSelfApprove
        ? "\u{2705} Self-approved via Cortex Team Bot (self-approved)"
        : "\u{2705} Approved via Cortex Team Bot";

      const ok = await submitPRReview(proj, prNumber, "APPROVE", reviewBody);

      if (ok) {
        await logEvent(env.DB, proj.githubRepo, "review.approved.bot", reviewer.github, String(prNumber));

        const label = isSelfApprove ? "Self-Approved" : "Approved";
        await ctx.editMessageText(
          `\u{2705} <b>${label}!</b>\n\n` +
          `PR #${prNumber} approved by @${escapeHtml(reviewer.github)}` +
          (isSelfApprove ? " (self-approved)" : ""),
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.editMessageText(
          `\u{26A0}\u{FE0F} Could not approve PR #${prNumber}. GitHub API error.`,
          { parse_mode: "HTML" }
        );
      }
    } catch (err) {
      console.error("review_approve error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Error submitting review." });
      } catch {}
    }
  });

  /**
   * [Request Changes] button — submits a REQUEST_CHANGES review via GitHub API.
   * Callback data format: review_changes:{prNumber}
   */
  bot.callbackQuery(/^review_changes:(\d+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery({ text: "Submitting review..." }); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const prNumber = parseInt(ctx.match![1], 10);

    try {
      const active = await resolveActiveProject(env, telegramId);
      if (!active || !active.projectConfig.githubToken) {
        try { await ctx.answerCallbackQuery({ text: "No project configured." }); } catch {}
        return;
      }

      const { projectConfig: proj } = active;

      // Look up reviewer's GitHub username
      const members = await getTeamMembers(env.PROJECTS);
      const reviewer = members.find((m) => m.telegram_id === telegramId);
      if (!reviewer) {
        try { await ctx.answerCallbackQuery({ text: "You are not registered." }); } catch {}
        return;
      }

      const ok = await submitPRReview(
        proj,
        prNumber,
        "REQUEST_CHANGES",
        "\u{270F}\u{FE0F} Changes requested via Cortex Team Bot"
      );

      if (ok) {
        await logEvent(env.DB, proj.githubRepo, "review.changes_requested.bot", reviewer.github, String(prNumber));

        await ctx.editMessageText(
          `\u{270F}\u{FE0F} <b>Changes Requested</b>\n\n` +
          `PR #${prNumber} — @${escapeHtml(reviewer.github)} requested changes.`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.editMessageText(
          `\u{26A0}\u{FE0F} Could not submit review for PR #${prNumber}. GitHub API error.`,
          { parse_mode: "HTML" }
        );
      }
    } catch (err) {
      console.error("review_changes error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Error submitting review." });
      } catch {}
    }
  });

  // -------------------------------------------------------------------
  // "Meine Aufgaben" — Pause flow callbacks
  // -------------------------------------------------------------------

  bot.callbackQuery("mytasks_pause", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    try {
      await handlePause(ctx, env, project, projectId);
    } catch (err) {
      console.error("mytasks_pause error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not show pause dialog." });
      } catch {}
    }
  });

  bot.callbackQuery("mytasks_pause_confirm", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    try {
      await handlePauseConfirm(ctx, project, env, projectId);
    } catch (err) {
      console.error("mytasks_pause_confirm error:", err);
      try {
        await ctx.answerCallbackQuery({ text: "Could not pause category." });
      } catch {}
    }
  });

  // -------------------------------------------------------------------
  // New group member detection — auto-greet and prompt for registration
  // Past work — show last 5 days of activity from D1
  bot.callbackQuery("past_work", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}

    const lines: string[] = ["\u{1F4C5} <b>Past Work (last 5 days)</b>", ""];

    const pastMembers = await getTeamMembers(env.PROJECTS);
    try {
      const result = await env.DB.prepare(
        `SELECT user_id, date(started_at) as day, SUM(duration_minutes) as total_min, COUNT(*) as sessions
         FROM sessions
         WHERE project = ? AND started_at > datetime('now', '-5 days')
         GROUP BY user_id, day
         ORDER BY day DESC, total_min DESC`
      ).bind(projectId).all<{ user_id: string; day: string; total_min: number; sessions: number }>();

      if (result.results && result.results.length > 0) {
        let currentDay = "";
        for (const row of result.results) {
          if (row.day !== currentDay) {
            currentDay = row.day;
            lines.push(`<b>${row.day}</b>`);
          }
          const hours = Math.floor((row.total_min || 0) / 60);
          const mins = (row.total_min || 0) % 60;
          const color = getUserColorByName(pastMembers, row.user_id);
          lines.push(`${color} ${row.user_id}: ${hours}h ${mins}m (${row.sessions} sessions)`);
        }
      } else {
        lines.push("No activity recorded yet.");
      }

      // Also show recent events
      const events = await env.DB.prepare(
        `SELECT event_type, actor, target, created_at
         FROM events
         WHERE repo = ? AND created_at > datetime('now', '-5 days')
         ORDER BY created_at DESC LIMIT 10`
      ).bind(project.githubRepo).all<{ event_type: string; actor: string; target: string; created_at: string }>();

      if (events.results && events.results.length > 0) {
        lines.push("");
        lines.push("<b>Recent events:</b>");
        for (const e of events.results) {
          const icon = e.event_type.includes("opened") ? "\u{1F4DD}" :
                       e.event_type.includes("closed") || e.event_type.includes("merged") ? "\u{2705}" :
                       e.event_type.includes("review") ? "\u{1F440}" : "\u{2022}";
          lines.push(`${icon} ${e.event_type} #${e.target || "?"} by ${e.actor}`);
        }
      }
    } catch {
      lines.push("Could not load activity data.");
    }

    const pastBody: Record<string, unknown> = {
      chat_id: project.chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (project.threadId) pastBody.message_thread_id = project.threadId;
    await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(pastBody),
    });
  });

  // -------------------------------------------------------------------

  bot.on("message:new_chat_members", async (ctx) => {
    const newMembers = ctx.message.new_chat_members || [];
    for (const member of newMembers) {
      // Skip other bots joining the group
      if (member.is_bot) continue;

      // Check if this user is already registered in the team registry
      const members = await getTeamMembers(env.PROJECTS);
      const existing = members.find((m) => m.telegram_id === member.id);

      if (existing) {
        await ctx.reply(
          `\u{1F44B} Welcome back, ${member.first_name}! ` +
            `You're linked to GitHub as <b>${existing.github}</b>.`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(
          `\u{1F44B} Welcome, <b>${member.first_name}</b>!\n\n` +
            `Please link your GitHub account:\n` +
            `<code>/register your-github-username</code>\n\n` +
            `This lets the bot show your tasks and track your activity.`,
          { parse_mode: "HTML" }
        );
      }
    }
  });

  // -------------------------------------------------------------------
  // Reply keyboard button handlers — v4 (5-button layout)
  // -------------------------------------------------------------------

  bot.hears("\u{1F4CB} Aufgabe nehmen", async (ctx) => {
    await handleAufgabeNehmen(ctx, project, env, projectId);
  });

  bot.hears("\u{2705} Meine Aufgaben", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const firstName = ctx.from?.first_name || "User";
    try {
      const { text, keyboard } = await handleMeineAufgaben(env, telegramId, firstName);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("Meine Aufgaben error:", err);
      await ctx.reply("⚠️ Could not load your tasks. Please try again.", {
        parse_mode: "HTML",
      });
    }
  });

  bot.hears("\u{1F465} Team Board", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    try {
      const { text, keyboard } = await renderTeamBoard(env, telegramId);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
    } catch (err) {
      console.error("Team Board error:", err);
      await ctx.reply("⚠️ Could not load the Team Board. Please try again.", {
        parse_mode: "HTML",
      });
    }
  });

  bot.hears("\u{1F4A1} Neue Idee", async (ctx) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // Start the guided issue creation wizard
    await setNewIdeaState(env.PROJECTS, telegramId, { step: "awaiting_title" });
    await ctx.reply(
      "\u{1F4A1} <b>Neue Idee</b>\n\n" +
        "Schick mir den Titel f\u{00FC}r dein neues Issue:",
      { parse_mode: "HTML" }
    );
  });

  // -------------------------------------------------------------------
  // "Neue Idee" wizard — category selection callback handlers
  // -------------------------------------------------------------------

  bot.callbackQuery(/^newidea_cat:(.+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const state = await getNewIdeaState(env.PROJECTS, telegramId);
    if (!state || state.step !== "awaiting_category") return;

    const category = ctx.match[1];
    // Validate category is a real area: label (defense-in-depth)
    if (!category.startsWith("area:")) return;
    const displayName = category.replace("area:", "");

    // Save category and advance to priority step
    await setNewIdeaState(env.PROJECTS, telegramId, {
      ...state,
      step: "awaiting_priority",
      category,
    });

    const priorityKb = buildIdeaPriorityKeyboard();
    await ctx.editMessageText(
      `\u{1F4A1} <b>Neue Idee</b>\n\n` +
        `\u{1F4DD} ${escapeHtml(state.title || "")}\n` +
        `\u{1F4C2} ${escapeHtml(displayName)}\n\n` +
        "W\u{00E4}hle die Priorit\u{00E4}t:",
      { parse_mode: "HTML", reply_markup: priorityKb }
    );
  });

  bot.callbackQuery("newidea_cat_skip", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const state = await getNewIdeaState(env.PROJECTS, telegramId);
    if (!state || state.step !== "awaiting_category") return;

    // Skip category and advance to priority step
    await setNewIdeaState(env.PROJECTS, telegramId, {
      ...state,
      step: "awaiting_priority",
    });

    const priorityKb = buildIdeaPriorityKeyboard();
    await ctx.editMessageText(
      `\u{1F4A1} <b>Neue Idee</b>\n\n` +
        `\u{1F4DD} ${escapeHtml(state.title || "")}\n` +
        `\u{1F4C2} <i>no category</i>\n\n` +
        "W\u{00E4}hle die Priorit\u{00E4}t:",
      { parse_mode: "HTML", reply_markup: priorityKb }
    );
  });

  // -------------------------------------------------------------------
  // "Neue Idee" wizard — priority selection callback handlers
  // -------------------------------------------------------------------

  bot.callbackQuery(/^newidea_pri:(.+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const state = await getNewIdeaState(env.PROJECTS, telegramId);
    if (!state || state.step !== "awaiting_priority") return;

    const priority = ctx.match[1];
    // Validate priority against known values (defense-in-depth)
    const VALID_PRIORITIES = ["priority:high", "priority:medium", "priority:low"];
    if (!VALID_PRIORITIES.includes(priority)) return;
    await finalizeNewIdea(ctx, env, telegramId, state, priority);
  });

  bot.callbackQuery("newidea_pri_skip", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const state = await getNewIdeaState(env.PROJECTS, telegramId);
    if (!state || state.step !== "awaiting_priority") return;

    // Default to medium priority
    await finalizeNewIdea(ctx, env, telegramId, state, PRIORITY_DEFAULT);
  });

  bot.hears("\u{2753} Hilfe", async (ctx) => {
    const keyboard = new InlineKeyboard()
      .text("\u{1F6AB} Blocker", "help_blocker")
      .text("\u{1F4CA} Priorit\u{00E4}ten", "help_priorities")
      .row()
      .text("\u{1F4C1} Kategorien", "help_categories")
      .text("\u{1F441} Preview", "help_preview")
      .row()
      .text("\u{26A0}\u{FE0F} Konflikte", "help_conflicts");

    await ctx.reply(HELP_TEXTS.overview, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  // -------------------------------------------------------------------
  // Help sub-view callback handlers (Issue #52)
  // -------------------------------------------------------------------

  bot.callbackQuery("help_blocker", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired */ }
    const keyboard = new InlineKeyboard().text("\u{2B05}\u{FE0F} Zur\u{00FC}ck", "help_back");
    await ctx.editMessageText(HELP_TEXTS.blocker, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("help_priorities", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired */ }
    const keyboard = new InlineKeyboard().text("\u{2B05}\u{FE0F} Zur\u{00FC}ck", "help_back");
    await ctx.editMessageText(HELP_TEXTS.priorities, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("help_categories", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired */ }
    const keyboard = new InlineKeyboard().text("\u{2B05}\u{FE0F} Zur\u{00FC}ck", "help_back");
    await ctx.editMessageText(HELP_TEXTS.categories, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("help_preview", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired */ }
    const keyboard = new InlineKeyboard().text("\u{2B05}\u{FE0F} Zur\u{00FC}ck", "help_back");
    await ctx.editMessageText(HELP_TEXTS.preview, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("help_conflicts", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired */ }
    const keyboard = new InlineKeyboard().text("\u{2B05}\u{FE0F} Zur\u{00FC}ck", "help_back");
    await ctx.editMessageText(HELP_TEXTS.conflicts, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("help_back", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired */ }
    const keyboard = new InlineKeyboard()
      .text("\u{1F6AB} Blocker", "help_blocker")
      .text("\u{1F4CA} Priorit\u{00E4}ten", "help_priorities")
      .row()
      .text("\u{1F4C1} Kategorien", "help_categories")
      .text("\u{1F441} Preview", "help_preview")
      .row()
      .text("\u{26A0}\u{FE0F} Konflikte", "help_conflicts");

    await ctx.editMessageText(HELP_TEXTS.overview, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  });

  // -------------------------------------------------------------------
  // Home screen — project switch handlers
  // -------------------------------------------------------------------

  bot.callbackQuery("home_switch_project", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const projects = await getProjectList(env);
    if (projects.length <= 1) {
      await ctx.reply("\u{1F4C2} Only one project registered \u{2014} no switching needed.");
      return;
    }

    const currentProjectId = await getActiveProject(env.PROJECTS, telegramId);

    // Build enriched project list: name + personal claim + open task count
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    for (const p of projects) {
      const isCurrent = p.id === currentProjectId;

      // Check if user has a category claim in this project
      const claimsState = await getCategoryClaims(env.PROJECTS, p.id);
      const userClaim = claimsState.claims.find((c) => c.telegramId === telegramId);

      // Count open issues for this project
      const issueMap = await fetchOpenIssuesByCategory(p.config);
      let totalOpen = 0;
      for (const issues of issueMap.values()) {
        totalOpen += issues.length;
      }

      // Build label: checkmark + name + personal info + open tasks
      let label = isCurrent ? "\u{2705} " : "";
      label += p.id;
      if (userClaim) {
        label += ` \u{1F4CC} ${userClaim.displayName}`;
      }
      label += ` (${totalOpen} open)`;

      buttons.push([{
        text: label,
        callback_data: `switch_project:${p.id}`,
      }]);
    }

    await ctx.reply("\u{1F4C2} <b>Switch Project:</b>", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons },
    });
  });

  // Switch to a new project — checks for active claims before allowing switch
  bot.callbackQuery(/^switch_project:/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const newProjectId = (ctx.callbackQuery?.data || "").substring("switch_project:".length);
    if (!newProjectId) return;

    const currentProjectId = await getActiveProject(env.PROJECTS, telegramId);

    // Already on this project — nothing to do
    if (newProjectId === currentProjectId) {
      await ctx.editMessageText(
        `\u{1F4C2} <b>Project:</b> ${escapeHtml(newProjectId)}\n\u{2705} Already active!`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Check if user has an active category claim in the CURRENT project
    if (currentProjectId) {
      const claimsState = await getCategoryClaims(env.PROJECTS, currentProjectId);
      const userClaim = claimsState.claims.find((c) => c.telegramId === telegramId);

      if (userClaim) {
        // User has open work — show warning dialog
        const safeCategory = escapeHtml(userClaim.displayName);
        const safeCurrentProject = escapeHtml(currentProjectId);

        const text =
          `\u{26A0}\u{FE0F} <b>Open tasks in ${safeCurrentProject}</b>\n\n` +
          `You have <b>${safeCategory}</b> claimed with ` +
          `${userClaim.assignedIssues.length} assigned issue(s).\n\n` +
          `What would you like to do?`;

        const keyboard = {
          inline_keyboard: [
            [
              { text: "\u{1F4CB} Finish tasks", callback_data: "switch_finish" },
              { text: "\u{23F8} Pause & Switch", callback_data: `switch_pause_and_go:${newProjectId}` },
            ],
          ],
        };

        await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
        return;
      }
    }

    // No active claim — switch immediately
    await setActiveProject(env.PROJECTS, telegramId, newProjectId);
    await ctx.editMessageText(
      `\u{1F4C2} <b>Project:</b> ${escapeHtml(newProjectId)}\n\u{2705} Switched!`,
      { parse_mode: "HTML" }
    );

    // Re-render the home screen with the new project context
    await renderHomeScreen(ctx, env, telegramId);
  });

  // "Finish tasks" — user chose to stay and finish current work
  bot.callbackQuery("switch_finish", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    await ctx.editMessageText(
      "\u{1F4CB} OK \u{2014} finish your current tasks first, then switch!",
      { parse_mode: "HTML" }
    );
  });

  // "Pause & Switch" — pause current category, then switch to new project
  bot.callbackQuery(/^switch_pause_and_go:/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    const firstName = ctx.from?.first_name || "Unknown";
    if (!telegramId) return;

    const newProjectId = (ctx.callbackQuery?.data || "").substring("switch_pause_and_go:".length);
    if (!newProjectId) return;

    const currentProjectId = await getActiveProject(env.PROJECTS, telegramId);
    if (!currentProjectId) return;

    const currentConfig = await getProject(env.PROJECTS, currentProjectId, env);
    if (!currentConfig) return;

    // --- Execute pause logic (mirrors handlePauseConfirm) ---

    const claimsState = await getCategoryClaims(env.PROJECTS, currentProjectId);
    const claimIndex = claimsState.claims.findIndex((c) => c.telegramId === telegramId);

    if (claimIndex < 0) {
      // Claim was already released — just switch
      await setActiveProject(env.PROJECTS, telegramId, newProjectId);
      await ctx.editMessageText(
        `\u{1F4C2} <b>Project:</b> ${escapeHtml(newProjectId)}\n\u{2705} Switched!`,
        { parse_mode: "HTML" }
      );
      await renderHomeScreen(ctx, env, telegramId);
      return;
    }

    const claim = claimsState.claims[claimIndex];
    const safeDisplayName = escapeHtml(claim.displayName);
    const safeFirstName = escapeHtml(firstName);

    // Count completed tasks
    let completedCount = 0;
    const totalCount = claim.assignedIssues.length;

    if (currentConfig.githubToken && claim.assignedIssues.length > 0) {
      let openCount = 0;
      for (const issueNum of claim.assignedIssues) {
        try {
          const res = await githubRequest(
            "GET",
            `/repos/${currentConfig.githubRepo}/issues/${issueNum}`,
            currentConfig.githubToken
          );
          if (res.ok) {
            const issue = (await res.json()) as { state: string };
            if (issue.state === "open") openCount++;
          } else {
            openCount++;
          }
        } catch {
          openCount++;
        }
      }
      completedCount = totalCount - openCount;
    }

    // 1. Unassign all open issues on GitHub
    await unassignIssuesFromUser(currentConfig, claim.assignedIssues, claim.githubUsername);

    // 2. Remove claim from KV
    claimsState.claims.splice(claimIndex, 1);
    await saveCategoryClaims(env.PROJECTS, currentProjectId, claimsState);

    // 3. Store paused marker
    const pausedEntry: PausedCategory = {
      category: claim.category,
      displayName: claim.displayName,
      pausedBy: firstName,
      completedTasks: completedCount,
      totalTasks: totalCount,
      pausedAt: new Date().toISOString(),
    };
    await addPausedCategory(env.PROJECTS, currentProjectId, pausedEntry);

    // 4. Clear active task
    await clearActiveTask(env.PROJECTS, telegramId, currentProjectId);

    // 5. Stop category timer and log time (Issue #60)
    const timerState = await stopTimer(env.PROJECTS, telegramId, currentProjectId);
    if (timerState) {
      const endedAt = new Date().toISOString();
      const durationMinutes = Math.round(
        (new Date(endedAt).getTime() - new Date(timerState.startedAt).getTime()) / 60000
      );
      await logTimeEntry(env.DB, {
        userId: telegramId,
        project: currentProjectId,
        category: timerState.category,
        startedAt: timerState.startedAt,
        endedAt,
        durationMinutes,
        tasksCompleted: completedCount,
      });
    }

    // 6. Notify team in group chat
    await sendTelegram(
      currentConfig.botToken,
      currentConfig.chatId,
      `\u{23F8} ${safeDisplayName} paused by ${safeFirstName} (${completedCount}/${totalCount} done) \u{2014} switching to ${escapeHtml(newProjectId)}`,
      currentConfig.threadId
    );

    // 7. Notify subscribers
    await notifySubscribers(
      env,
      currentConfig.botToken,
      "tasks",
      () =>
        `\u{1F4CB} <b>${safeDisplayName}</b> is available again!\n` +
        `Paused by ${safeFirstName} (${completedCount}/${totalCount} done).\n` +
        `Branch is preserved \u{2014} use \u{1F4CB} Aufgabe nehmen to continue.`,
      telegramId
    );

    // --- Switch to new project ---
    await setActiveProject(env.PROJECTS, telegramId, newProjectId);

    await ctx.editMessageText(
      `\u{23F8} <b>${safeDisplayName}</b> paused (${completedCount}/${totalCount} done).\n` +
      `\u{1F4C2} Switched to <b>${escapeHtml(newProjectId)}</b>!`,
      { parse_mode: "HTML" }
    );

    // Re-render home screen for the new project
    await renderHomeScreen(ctx, env, telegramId);
  });

  // -------------------------------------------------------------------
  // Team Messaging — Reply callback (Issue #59)
  // When a recipient taps [Reply], set a temporary flag so their next
  // text message is forwarded back to the original sender.
  // -------------------------------------------------------------------

  bot.callbackQuery(/^msg_reply:(.+)$/, async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch { /* query expired — safe to ignore */ }
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const threadKey = ctx.match![1];
    const thread = await getMessageThread(env.PROJECTS, threadKey);
    if (!thread) {
      await ctx.reply(
        "This conversation has expired (24h limit). Please start a new message.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Set a 5-minute flag so the next text message is treated as a reply
    await env.PROJECTS.put(`msg_replying:${telegramId}`, threadKey, {
      expirationTtl: 300,
    });

    const safeSenderName = escapeHtml(thread.senderName);
    await ctx.reply(
      `Type your reply to <b>${safeSenderName}</b>:`,
      { parse_mode: "HTML" }
    );
  });

  // -------------------------------------------------------------------
  // Onboarding wizard — "Continue to Tutorial" callback
  // -------------------------------------------------------------------

  bot.callbackQuery("onboard_continue", async (ctx) => {
    try { await ctx.answerCallbackQuery(); } catch {}
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    await setOnboardingState(env.PROJECTS, telegramId, "tutorial");

    // Send the 3-message workflow tutorial
    await sendOnboardingTutorial(ctx);

    // Mark onboarding as permanently complete
    await markOnboarded(env.PROJECTS, telegramId);
    await clearOnboardingState(env.PROJECTS, telegramId);

    // Project header with inline [Switch] button
    if (telegramId) {
      const active = await resolveActiveProject(env, telegramId);
      if (active) {
        const projectName = escapeHtml(active.projectId);
        await ctx.reply(
          `\u{1F4C2} <b>Project:</b> ${projectName}`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "\u{1F504} Switch", callback_data: "home_switch_project" }]],
            },
          }
        );
      }
    }

    // Show the normal reply keyboard so the user can start working
    const keyboard = new Keyboard()
      .text("\u{1F4CB} Aufgabe nehmen").text("\u{2705} Meine Aufgaben")
      .row()
      .text("\u{1F465} Team Board").text("\u{1F4A1} Neue Idee")
      .row()
      .text("\u{2753} Hilfe")
      .resized()
      .persistent();
    await ctx.reply("\u{2328}\u{FE0F} Quick actions activated! Use the buttons below.", {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  });

  // -------------------------------------------------------------------
  // Onboarding wizard — GitHub username input handler
  // Must be AFTER all bot.command() and bot.hears() handlers so it only
  // catches free-text messages from users in a wizard (new idea or onboarding).
  // -------------------------------------------------------------------

  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    // -----------------------------------------------------------------
    // Team Messaging — reply capture (Issue #59)
    // If the user previously tapped [Reply], their next message is
    // forwarded back to the original sender.
    // -----------------------------------------------------------------
    const replyingTo = await env.PROJECTS.get(`msg_replying:${telegramId}`);
    if (replyingTo) {
      // Clear the replying flag immediately so it doesn't trigger again
      await env.PROJECTS.delete(`msg_replying:${telegramId}`);

      const thread = await getMessageThread(env.PROJECTS, replyingTo);
      if (!thread) {
        await ctx.reply(
          "This conversation has expired (24h limit). Please start a new message.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Resolve sender's project for the bot token
      const active = await resolveActiveProject(env, telegramId);
      if (!active) {
        await ctx.reply(
          "No project configured. Use /start to set up first.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const replyText = ctx.message.text.trim();
      const safeReplyText = escapeHtml(replyText);
      const safeRecipientName = escapeHtml(thread.recipientName);
      const safeSenderName = escapeHtml(thread.senderName);

      // Build the reply message for the original sender
      let replyMsg =
        `<b>Reply from ${safeRecipientName}:</b>\n\n` +
        `${safeReplyText}`;

      if (thread.issueNumber) {
        replyMsg += `\n\n<i>Re: #${thread.issueNumber}</i>`;
      }

      // Look up the original sender's DM chat_id
      const senderPrefs = await getUserPreferences(env.PROJECTS, thread.senderTelegramId);
      if (!senderPrefs.dm_chat_id) {
        await ctx.reply(
          `Could not deliver reply — ${safeSenderName} hasn't started a DM with the bot yet.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const status = await sendDM(
        active.projectConfig.botToken,
        senderPrefs.dm_chat_id,
        replyMsg
      );

      if (status === "sent") {
        await ctx.reply(
          `Reply sent to <b>${safeSenderName}</b>.`,
          { parse_mode: "HTML" }
        );
      } else if (status === "blocked") {
        senderPrefs.dm_chat_id = null;
        await saveUserPreferences(env.PROJECTS, thread.senderTelegramId, senderPrefs);
        await ctx.reply(
          `Could not deliver reply — ${safeSenderName} has blocked the bot.`,
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(
          "Failed to send reply. Please try again later.",
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    // -----------------------------------------------------------------
    // Team Messaging — @Name mentions (Issue #59)
    // Detect @Name in private messages and forward to the mentioned
    // team member as a DM.
    // -----------------------------------------------------------------
    const messageText = ctx.message.text;
    const mentions = parseAtMentions(messageText);
    if (mentions.length > 0) {
      const members = await getTeamMembers(env.PROJECTS);
      const senderName = ctx.from?.first_name || "Unknown";

      const uniqueMentions = [...new Set(mentions)];

      // Resolve project once for bot token and GitHub access
      const active = await resolveActiveProject(env, telegramId);
      if (!active) {
        await ctx.reply(
          "No project configured. Use /start to set up first.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Check for issue references (#N) and fetch titles once
      const issueRefs = parseIssueReferences(messageText);
      let issueContext = "";
      let firstIssueNumber: number | undefined;
      if (issueRefs.length > 0 && active.projectConfig.githubToken) {
        firstIssueNumber = issueRefs[0];
        try {
          const issueRes = await githubRequest(
            "GET",
            `/repos/${active.projectConfig.githubRepo}/issues/${firstIssueNumber}`,
            active.projectConfig.githubToken
          );
          if (issueRes.ok) {
            const issueData = (await issueRes.json()) as {
              title: string;
              html_url: string;
            };
            issueContext =
              `\n\n<b>Issue #${firstIssueNumber}:</b> ` +
              `<a href="${issueData.html_url}">${escapeHtml(issueData.title)}</a>`;
          }
        } catch {
          // GitHub API error — send message without issue context
        }
      }

      for (const mentionedName of uniqueMentions) {
        // Case-insensitive match against the member's name field
        const recipient = members.find(
          (m) => m.name.toLowerCase() === mentionedName.toLowerCase()
        );

        if (!recipient) {
          const memberNames = members.map((m) => m.name).join(", ");
          await ctx.reply(
            `User <b>@${escapeHtml(mentionedName)}</b> not found.\n\n` +
            `Registered members: ${escapeHtml(memberNames || "none")}`,
            { parse_mode: "HTML" }
          );
          continue;
        }

        // Don't allow messaging yourself
        if (recipient.telegram_id === telegramId) {
          await ctx.reply(
            "You can't send a message to yourself.",
            { parse_mode: "HTML" }
          );
          continue;
        }

        // Respect Do Not Disturb mode
        const recipientDnd = await isUserDND(env.PROJECTS, recipient.telegram_id);
        if (recipientDnd) {
          await ctx.reply(
            `<b>${escapeHtml(recipient.name)}</b> is in Do Not Disturb mode right now.`,
            { parse_mode: "HTML" }
          );
          continue;
        }

        // Check if recipient has a DM chat_id
        const recipientPrefs = await getUserPreferences(env.PROJECTS, recipient.telegram_id);
        if (!recipientPrefs.dm_chat_id) {
          await ctx.reply(
            `<b>${escapeHtml(recipient.name)}</b> hasn't started a DM with the bot yet. ` +
            `They need to message the bot first.`,
            { parse_mode: "HTML" }
          );
          continue;
        }

        // Build the forwarded message
        const safeMessage = escapeHtml(messageText);
        const safeSender = escapeHtml(senderName);
        const safeRecipient = escapeHtml(recipient.name);

        // Create a unique thread key for this conversation
        const threadKey = `thread:${telegramId}:${recipient.telegram_id}:${Date.now()}`;

        // Store the thread in KV with 24h TTL
        await setMessageThread(env.PROJECTS, threadKey, {
          senderTelegramId: telegramId,
          senderName: senderName,
          recipientTelegramId: recipient.telegram_id,
          recipientName: recipient.name,
          originalMessage: messageText,
          issueNumber: firstIssueNumber,
          createdAt: new Date().toISOString(),
        });

        const forwardedMsg =
          `<b>Message from ${safeSender}:</b>\n\n` +
          `${safeMessage}` +
          `${issueContext}`;

        const replyMarkup = {
          inline_keyboard: [
            [{ text: "Reply", callback_data: `msg_reply:${threadKey}` }],
          ],
        };

        const status = await sendDM(
          active.projectConfig.botToken,
          recipientPrefs.dm_chat_id,
          forwardedMsg,
          replyMarkup
        );

        if (status === "sent") {
          await ctx.reply(
            `Message sent to <b>${safeRecipient}</b>.`,
            { parse_mode: "HTML" }
          );
        } else if (status === "blocked") {
          recipientPrefs.dm_chat_id = null;
          await saveUserPreferences(env.PROJECTS, recipient.telegram_id, recipientPrefs);
          await ctx.reply(
            `Could not deliver message — <b>${safeRecipient}</b> has blocked the bot.`,
            { parse_mode: "HTML" }
          );
        } else {
          await ctx.reply(
            `Failed to send message to <b>${safeRecipient}</b>. Please try again later.`,
            { parse_mode: "HTML" }
          );
        }
      }
      return;
    }

    // "Neue Idee" wizard — title input (checked BEFORE onboarding)
    const ideaState = await getNewIdeaState(env.PROJECTS, telegramId);
    if (ideaState?.step === "awaiting_title") {
      const title = ctx.message.text.trim();

      if (!title || title.length > 256) {
        await ctx.reply(
          "\u{274C} Bitte gib einen Titel ein (max. 256 Zeichen).",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Resolve project to fetch area labels
      const active = await resolveActiveProject(env, telegramId);
      if (!active) {
        await ctx.reply(
          "\u{26A0}\u{FE0F} No project configured. Use /start to set up first.",
          { parse_mode: "HTML" }
        );
        await clearNewIdeaState(env.PROJECTS, telegramId);
        return;
      }

      const { projectConfig: activeProject } = active;

      // Fetch available area: labels from the GitHub repo
      const areaLabels = await fetchAreaLabels(activeProject);

      if (areaLabels.length === 0) {
        // No categories available — skip directly to priority selection
        await setNewIdeaState(env.PROJECTS, telegramId, {
          step: "awaiting_priority",
          title,
        });

        const priorityKb = buildIdeaPriorityKeyboard();
        await ctx.reply(
          `\u{1F4A1} <b>Neue Idee</b>\n\n` +
            `\u{1F4DD} ${escapeHtml(title)}\n` +
            `\u{1F4C2} <i>no categories available</i>\n\n` +
            "W\u{00E4}hle die Priorit\u{00E4}t:",
          { parse_mode: "HTML", reply_markup: priorityKb }
        );
        return;
      }

      // Save title and advance to category step
      await setNewIdeaState(env.PROJECTS, telegramId, {
        step: "awaiting_category",
        title,
      });

      const categoryKb = buildIdeaCategoryKeyboard(areaLabels);
      await ctx.reply(
        `\u{1F4A1} <b>Neue Idee</b>\n\n` +
          `\u{1F4DD} ${escapeHtml(title)}\n\n` +
          "W\u{00E4}hle eine Kategorie:",
        { parse_mode: "HTML", reply_markup: categoryKb }
      );
      return;
    }

    const state = await getOnboardingState(env.PROJECTS, telegramId);
    if (state !== "awaiting_github") return;

    const username = ctx.message.text.trim().replace(/^@/, "");

    // Basic username validation before hitting the API
    if (!username || username.includes(" ") || username.length > 39) {
      await ctx.reply(
        "\u{274C} That doesn\u2019t look like a valid GitHub username. " +
          "Please send just your username (e.g., <code>octocat</code>).",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Verify the GitHub username exists via the public API
    const token = project.githubToken || env.GITHUB_API_TOKEN || "";
    const ghRes = await githubRequest(
      "GET",
      `/users/${encodeURIComponent(username)}`,
      token
    );

    if (!ghRes.ok) {
      await ctx.reply(
        `\u{274C} GitHub user <code>${escapeHtml(username)}</code> not found.\n\n` +
          "Please check the spelling and try again:",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Register the user in the central team registry
    const telegramUsername = ctx.from?.username || "";
    const firstName = ctx.from?.first_name || "Unknown";

    await upsertTeamMember(env.PROJECTS, {
      telegram_id: telegramId,
      telegram_username: telegramUsername || firstName,
      github: username,
      name: firstName,
    });

    const members = await getTeamMembers(env.PROJECTS);
    const color = getUserColor(members, telegramId);

    await ctx.reply(
      `${color} <b>GitHub linked!</b>\n\n` +
        `GitHub: <code>${escapeHtml(username)}</code>\n` +
        `Telegram: ${escapeHtml(firstName)}\n\n` +
        "<b>Step 2/3: Notification Settings</b>",
      { parse_mode: "HTML" }
    );

    // Advance to settings step and show the settings panel
    await setOnboardingState(env.PROJECTS, telegramId, "settings");
    const prefs = await getUserPreferences(env.PROJECTS, telegramId);
    const { text, keyboard } = buildSettingsMessage(prefs);

    // Append a "Continue" button below the existing settings keyboard
    const settingsKb = {
      inline_keyboard: [
        ...keyboard.inline_keyboard,
        [{ text: "\u{27A1}\u{FE0F} Continue to Tutorial", callback_data: "onboard_continue" }],
      ],
    };

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: settingsKb });
  });

  return bot;
}

// ---------------------------------------------------------------------------
// Shared command logic (used by both grammy handlers and keyboard handlers)
// ---------------------------------------------------------------------------

/**
 * Show detailed info about currently active sessions.
 * Used by /active command and the "Active" callback/keyboard button.
 */
async function sendActiveInfo(
  env: Env,
  project: ProjectConfig,
  projectId: string
): Promise<void> {
  const members = await getTeamMembers(env.PROJECTS);
  const sessions = await getActiveSessions(env.PROJECTS, projectId);
  const dashState = await getDashboardState(env.PROJECTS, projectId);

  if (sessions.length === 0) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "\u{1F465} Nobody is currently working on this project.",
      project.threadId
    );
    return;
  }

  const lines: string[] = ["\u{1F465} <b>Currently active:</b>", ""];

  for (const s of sessions) {
    const color = getUserColorByName(members, s.user);
    const userDash = dashState.activeSessions.find(
      (ds) => ds.user === s.user
    );
    const tasks = userDash?.tasks || [];

    lines.push(`${color} <b>${s.user}</b> (since ${s.since})`);

    // Show activity data from heartbeat (branch, files, commit)
    const activity = await getActivityData(env.PROJECTS, projectId, s.user);
    if (activity) {
      if (activity.branch) {
        lines.push(`   \u{1F4CB} Branch: ${activity.branch}`);
      }
      if (activity.lastFiles && activity.lastFiles.length > 0) {
        lines.push(`   \u{1F4DD} Editing: ${activity.lastFiles.slice(0, 3).join(", ")}`);
      }
      if (activity.lastCommit) {
        lines.push(`   \u{1F4AC} Last commit: ${activity.lastCommit}`);
      }
    }

    if (tasks.length > 0) {
      lines.push(
        `   \u{1F4CC} Claimed: ${tasks.map((t) => "#" + t).join(", ")}`
      );
    }
  }

  // Send with HTML formatting + "Past Work" button
  const buttons = [[{ text: "\u{1F4C5} Past Work (5 days)", callback_data: "past_work" }]];
  const body: Record<string, unknown> = {
    chat_id: project.chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  };
  if (project.threadId) body.message_thread_id = project.threadId;

  await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
}

/**
 * /tasks — List open GitHub issues for the project.
 * Overloaded: can be called with only project (legacy) or with all params.
 */
async function handleTasksCommand(
  _env: Env,
  project: ProjectConfig,
  _projectId: string
): Promise<void> {
  if (!project.githubToken) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "No GitHub token configured. Cannot load tasks.",
      project.threadId
    );
    return;
  }

  const response = await githubRequest(
    "GET",
    `/repos/${project.githubRepo}/issues?state=open&per_page=20`,
    project.githubToken
  );

  if (!response.ok) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      `GitHub API error: ${response.status}`,
      project.threadId
    );
    return;
  }

  const issues = (await response.json()) as Array<{
    number: number;
    title: string;
    assignee?: { login: string } | null;
  }>;

  if (issues.length === 0) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "No open tasks.",
      project.threadId
    );
    return;
  }

  const lines = issues.map((issue) => {
    const assignee = issue.assignee
      ? ` [${issue.assignee.login}]`
      : "";
    return `#${issue.number} ${issue.title}${assignee}`;
  });

  await sendTelegram(
    project.botToken,
    project.chatId,
    `Open Tasks:\n\n${lines.join("\n")}`,
    project.threadId
  );
}

/**
 * /wer — Show who is currently working (active Claude sessions).
 */
async function handleWerCommand(
  env: Env,
  project: ProjectConfig,
  projectId: string
): Promise<void> {
  const sessions = await getActiveSessions(env.PROJECTS, projectId);

  if (sessions.length === 0) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Nobody is currently working.",
      project.threadId
    );
    return;
  }

  const lines = sessions.map(
    (s) => `${s.user} (seit ${s.since})`
  );

  await sendTelegram(
    project.botToken,
    project.chatId,
    `Aktive Sessions:\n\n${lines.join("\n")}`,
    project.threadId
  );
}

/**
 * Create a GitHub issue from the "Neue Idee" guided wizard.
 * Returns the created issue's number and URL, or null on failure.
 */
async function createIdeaIssue(
  project: ProjectConfig,
  title: string,
  category: string | null,
  priority: string
): Promise<{ number: number; html_url: string } | null> {
  if (!project.githubToken) return null;

  const labels: string[] = [priority];
  if (category) labels.push(category);

  const response = await githubRequest(
    "POST",
    `/repos/${project.githubRepo}/issues`,
    project.githubToken,
    { title, labels }
  );

  if (!response.ok) return null;

  const issue = (await response.json()) as {
    number: number;
    html_url: string;
  };

  return { number: issue.number, html_url: issue.html_url };
}

/**
 * Build the category selection inline keyboard for the "Neue Idee" wizard.
 */
function buildIdeaCategoryKeyboard(areaLabels: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const label of areaLabels) {
    const displayName = label.replace("area:", "");
    kb.text(`\u{1F4C2} ${displayName}`, `newidea_cat:${label}`).row();
  }

  kb.text("\u{23ED}\u{FE0F} Skip (no category)", "newidea_cat_skip");
  return kb;
}

/**
 * Build the priority selection inline keyboard for the "Neue Idee" wizard.
 */
function buildIdeaPriorityKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();

  kb.text(`${PRIORITY_EMOJIS["priority:high"]} High`, "newidea_pri:priority:high");
  kb.text(`${PRIORITY_EMOJIS["priority:medium"]} Medium`, "newidea_pri:priority:medium");
  kb.text(`${PRIORITY_EMOJIS["priority:low"]} Low`, "newidea_pri:priority:low").row();
  kb.text("\u{23ED}\u{FE0F} Skip (defaults to Medium)", "newidea_pri_skip");

  return kb;
}

/**
 * Final step of the "Neue Idee" wizard — create the issue and send confirmation.
 */
async function finalizeNewIdea(
  ctx: Context,
  env: Env,
  telegramId: number,
  state: NewIdeaState,
  priority: string
): Promise<void> {
  const active = await resolveActiveProject(env, telegramId);
  if (!active) {
    await ctx.reply(
      "\u{26A0}\u{FE0F} No project configured. Use /start to set up first.",
      { parse_mode: "HTML" }
    );
    await clearNewIdeaState(env.PROJECTS, telegramId);
    return;
  }

  const { projectConfig: project } = active;

  if (!project.githubToken) {
    await ctx.reply(
      "\u{26A0}\u{FE0F} No GitHub token configured \u{2014} cannot create issues.",
      { parse_mode: "HTML" }
    );
    await clearNewIdeaState(env.PROJECTS, telegramId);
    return;
  }

  const title = state.title || "Untitled idea";
  const category = state.category || null;

  const issue = await createIdeaIssue(project, title, category, priority);

  await clearNewIdeaState(env.PROJECTS, telegramId);

  if (!issue) {
    await ctx.reply(
      "\u{274C} <b>Failed to create issue.</b>\n\nGitHub API returned an error. Please try again later.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Build the confirmation message
  const priorityEmoji = PRIORITY_EMOJIS[priority] || "\u{1F7E1}";
  const priorityName = priority.replace("priority:", "");
  const categoryDisplay = category
    ? `\u{1F4C2} ${escapeHtml(category.replace("area:", ""))}`
    : "\u{2014} <i>none</i>";

  let confirmationText =
    `\u{2705} <b>Issue #${issue.number} created!</b>\n\n` +
    `\u{1F4DD} <b>${escapeHtml(title)}</b>\n` +
    `${priorityEmoji} Priority: ${escapeHtml(priorityName)}\n` +
    `Category: ${categoryDisplay}\n\n` +
    `\u{1F517} <a href="${escapeHtml(issue.html_url)}">${escapeHtml(issue.html_url)}</a>`;

  // Contextual tip if no category was chosen
  if (!category) {
    confirmationText +=
      "\n\n\u{1F4A1} <i>Tip: Issues without a category may be overlooked in the category picker.</i>";
  }

  await ctx.reply(confirmationText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
}

/**
 * /new <title> — Create a new GitHub issue.
 */
async function handleNewCommand(
  project: ProjectConfig,
  title: string
): Promise<void> {
  if (!title) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Bitte einen Titel angeben: /new Mein neuer Task",
      project.threadId
    );
    return;
  }

  if (!project.githubToken) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Kein GitHub-Token konfiguriert. Issues koennen nicht erstellt werden.",
      project.threadId
    );
    return;
  }

  const response = await githubRequest(
    "POST",
    `/repos/${project.githubRepo}/issues`,
    project.githubToken,
    { title }
  );

  if (!response.ok) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      `Fehler beim Erstellen: ${response.status}`,
      project.threadId
    );
    return;
  }

  const issue = (await response.json()) as { number: number; title: string };

  await sendTelegram(
    project.botToken,
    project.chatId,
    `Task erstellt: #${issue.number} ${issue.title}`,
    project.threadId
  );
}

/**
 * /assign #N @name — Assign a GitHub issue to a team member.
 * Accepts formats: /assign #3 @nabil, /assign 3 nabil
 */
async function handleAssignCommand(
  project: ProjectConfig,
  args: string
): Promise<void> {
  if (!args) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Nutzung: /assign #3 @name",
      project.threadId
    );
    return;
  }

  if (!project.githubToken) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Kein GitHub-Token konfiguriert.",
      project.threadId
    );
    return;
  }

  // Parse issue number: accept "#3" or "3"
  const numberMatch = args.match(/#?(\d+)/);
  if (!numberMatch) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Konnte die Issue-Nummer nicht lesen. Beispiel: /assign #3 @name",
      project.threadId
    );
    return;
  }
  const issueNumber = parseInt(numberMatch[1], 10);

  // Parse assignee: accept "@name" or "name"
  const nameMatch = args.match(/@?(\w+)\s*$/);
  if (!nameMatch) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Konnte den Namen nicht lesen. Beispiel: /assign #3 @name",
      project.threadId
    );
    return;
  }
  const assigneeName = nameMatch[1].toLowerCase();

  // Look up the GitHub username from the members list
  const member = project.members.find(
    (m) =>
      m.name.toLowerCase() === assigneeName ||
      m.github.toLowerCase() === assigneeName ||
      m.telegram.replace("@", "").toLowerCase() === assigneeName
  );

  const githubUsername = member ? member.github : assigneeName;

  const response = await githubRequest(
    "POST",
    `/repos/${project.githubRepo}/issues/${issueNumber}/assignees`,
    project.githubToken,
    { assignees: [githubUsername] }
  );

  if (!response.ok) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      `Fehler beim Zuweisen: ${response.status}`,
      project.threadId
    );
    return;
  }

  await sendTelegram(
    project.botToken,
    project.chatId,
    `Task #${issueNumber} zugewiesen an ${githubUsername}`,
    project.threadId
  );
}

/**
 * /done #N — Close a GitHub issue and post "Ready for Review".
 */
async function handleDoneCommand(
  project: ProjectConfig,
  args: string
): Promise<void> {
  if (!args) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Nutzung: /done #3",
      project.threadId
    );
    return;
  }

  if (!project.githubToken) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Kein GitHub-Token konfiguriert.",
      project.threadId
    );
    return;
  }

  const numberMatch = args.match(/#?(\d+)/);
  if (!numberMatch) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Konnte die Issue-Nummer nicht lesen. Beispiel: /done #3",
      project.threadId
    );
    return;
  }
  const issueNumber = parseInt(numberMatch[1], 10);

  // Add a "Ready for Review" comment
  await githubRequest(
    "POST",
    `/repos/${project.githubRepo}/issues/${issueNumber}/comments`,
    project.githubToken,
    { body: "Ready for Review" }
  );

  // Close the issue
  const response = await githubRequest(
    "PATCH",
    `/repos/${project.githubRepo}/issues/${issueNumber}`,
    project.githubToken,
    { state: "closed" }
  );

  if (!response.ok) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      `Fehler beim Schliessen: ${response.status}`,
      project.threadId
    );
    return;
  }

  await sendTelegram(
    project.botToken,
    project.chatId,
    `Task #${issueNumber} erledigt — Ready for Review`,
    project.threadId
  );
}

// ---------------------------------------------------------------------------
// Route: POST /register-member
// ---------------------------------------------------------------------------

/**
 * HTTP endpoint to register a team member directly.
 * Stores in KV key "team-members" as a JSON array.
 */
async function handleRegisterMember(
  request: Request,
  env: Env
): Promise<Response> {
  let payload: TeamMember;
  try {
    payload = (await request.json()) as TeamMember;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!payload.telegram_id || !payload.github) {
    return new Response(
      "Missing required fields: telegram_id, github",
      { status: 400 }
    );
  }

  // Ensure defaults for optional fields
  const member: TeamMember = {
    telegram_id: payload.telegram_id,
    telegram_username: payload.telegram_username || "unknown",
    github: payload.github,
    name: payload.name || payload.telegram_username || "unknown",
  };

  await upsertTeamMember(env.PROJECTS, member);

  return new Response(
    JSON.stringify({ ok: true, member }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// ---------------------------------------------------------------------------
// Route: POST /github/:projectId
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GitHub sub-handlers — one per event type
// ---------------------------------------------------------------------------

/**
 * Handle GitHub "issues" events.
 * Sends Telegram notifications for opened, closed, assigned, and
 * labeled (only "urgent" or "blocked") actions.
 *
 * "labeled" and "assigned" actions support batching: when someone does
 * bulk operations on GitHub (e.g. labeling 20 issues at once), the bot
 * accumulates them in a KV buffer and sends a single summary message
 * instead of flooding the chat with 20 separate notifications.
 */
async function handleGitHubIssues(
  rawBody: string,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<Response> {
  let payload: GitHubIssuesPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubIssuesPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { action, issue, sender } = payload;
  let message: string | null = null;
  let eventType: string | null = null;

  switch (action) {
    case "opened":
      message =
        `\u{1F4DD} New Issue #${issue.number}: "${issue.title}" by @${sender.login}\n` +
        `\u{1F517} ${issue.html_url}`;
      eventType = "issues.opened";
      break;

    case "closed": {
      message = `\u{2705} Issue #${issue.number} closed by @${sender.login}`;
      eventType = "issues.closed";

      // If a blocker issue was closed, notify all team members that work can resume
      const closedIssueLabels = (issue.labels || []).map((l) => l.name);
      if (closedIssueLabels.includes("priority:blocker")) {
        const blockerMembers = await getTeamMembers(env.PROJECTS);
        for (const bMember of blockerMembers) {
          // Skip the person who closed the blocker
          if (bMember.github === sender.login) continue;
          const bPrefs = await getUserPreferences(env.PROJECTS, bMember.telegram_id);
          if (!bPrefs.dm_chat_id) continue;
          const bDnd = await isUserDND(env.PROJECTS, bMember.telegram_id);
          if (bDnd) continue;

          const dmStatus = await sendDM(
            project.botToken,
            bPrefs.dm_chat_id,
            `\u{1F7E2} <b>Blocker resolved!</b>\n\n` +
              `Issue #${issue.number}: "${escapeHtml(issue.title)}" was closed by @${escapeHtml(sender.login)}.\n\n` +
              "Category claims are available again. Use /start to pick a task!"
          );
          if (dmStatus === "blocked") {
            bPrefs.dm_chat_id = null;
            await saveUserPreferences(env.PROJECTS, bMember.telegram_id, bPrefs);
          }
        }
      }
      break;
    }

    case "assigned": {
      // Send assignment DM directly to the assignee (tasks = always on)
      if (issue.assignee) {
        const assignMembers = await getTeamMembers(env.PROJECTS);
        const assignee = assignMembers.find((m) => m.github === issue.assignee!.login);

        if (assignee) {
          const assigneeDnd = await isUserDND(env.PROJECTS, assignee.telegram_id);
          if (!assigneeDnd) {
            const assigneePrefs = await getUserPreferences(env.PROJECTS, assignee.telegram_id);
            if (assigneePrefs.dm_chat_id) {
              const dmStatus = await sendDM(
                project.botToken,
                assigneePrefs.dm_chat_id,
                `\u{1F4CC} Issue #${issue.number} assigned to you: "${escapeHtml(issue.title)}"\n\u{1F517} ${issue.html_url}`
              );
              if (dmStatus === "blocked") {
                assigneePrefs.dm_chat_id = null;
                await saveUserPreferences(env.PROJECTS, assignee.telegram_id, assigneePrefs);
              }
            }
          }
        }

        // No group message for assignments
        eventType = "issues.assigned";
      }
      break;
    }

    case "labeled": {
      const labelName = payload.label?.name?.toLowerCase() || "";
      const importantLabels = ["urgent", "blocked"];

      if (importantLabels.includes(labelName)) {
        // Important labels always send immediately — no batching
        message = `\u{1F3F7} Issue #${issue.number} labeled: ${payload.label!.name}`;
      } else {
        // Non-important labels: use batching for bulk operations
        const detail = `#${issue.number} \u{2192} ${payload.label?.name || "unknown"}`;
        const batch = await checkAndBatch(
          env.PROJECTS,
          projectId,
          "labeled",
          sender.login,
          detail
        );

        if (batch.shouldSend && batch.batchMessage) {
          // Buffer flushed — send the batch summary
          message = `\u{1F3F7} ${batch.batchMessage}`;
        }
        // else: either first event (no notification for non-important labels)
        //       or still accumulating in buffer
      }
      eventType = "issues.labeled";
      break;
    }

    default:
      break;
  }

  if (message) {
    // Quiet hours: skip non-urgent issue events
    const issueLabels = (issue.labels || []).map((l) => l.name);
    if (isQuietHours() && !isUrgentEvent(eventType || "", issueLabels)) {
      // Log to D1 but don't send Telegram message
      if (eventType) await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(issue.number));
      return new Response("OK");
    }

    // Contextual buttons for issue events
    const buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>> | undefined =
      action === "opened"
        ? [[
            { text: "\u{1F64B} I'll take this", callback_data: `claim_issue:${issue.number}` },
            { text: "\u{1F517} Open on GitHub", url: issue.html_url },
          ]]
        : undefined;

    if (action === "opened") {
      const sentId = await sendTelegramThreaded(
        project.botToken, project.chatId, message, project.threadId, null, buttons
      );
      if (sentId) {
        await saveThreadMessageId(env.PROJECTS, projectId, "issue", issue.number, sentId);
      }
    } else {
      const replyTo = await getThreadMessageId(env.PROJECTS, projectId, "issue", issue.number);
      await sendTelegramThreaded(
        project.botToken, project.chatId, message, project.threadId, replyTo
      );
    }
  }

  // Log ALL events to D1 for reports (even filtered ones)
  if (eventType) {
    await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(issue.number));
  }

  return new Response("OK");
}

/**
 * Handle GitHub "pull_request" events.
 * Sends Telegram notifications for opened (non-draft), ready_for_review,
 * and closed (merged vs. not merged) actions. Draft PR updates are ignored.
 */
async function handleGitHubPR(
  rawBody: string,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<Response> {
  let payload: GitHubPRPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubPRPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { action, pull_request: pr, sender } = payload;
  let message: string | null = null;
  let eventType: string | null = null;

  switch (action) {
    case "opened":
      // Skip draft PRs — they are work-in-progress and create noise
      if (pr.draft) {
        eventType = "pr.opened.draft";
        break;
      }
      message =
        `\u{1F500} New PR #${pr.number}: "${escapeHtml(pr.title)}" by @${escapeHtml(sender.login)}\n` +
        `\u{1F4CA} ${pr.changed_files} files | +${pr.additions}/-${pr.deletions} | ${escapeHtml(pr.head.ref)} \u{2192} ${escapeHtml(pr.base.ref)}\n` +
        `\u{1F517} ${pr.html_url}`;
      eventType = "pr.opened";
      break;

    case "ready_for_review":
      message =
        `\u{1F440} PR #${pr.number} is ready for review!\n` +
        `\u{1F517} ${pr.html_url}`;
      eventType = "pr.ready_for_review";
      break;

    case "closed":
      if (pr.merged) {
        message =
          `\u{1F389} PR #${pr.number} merged! "${escapeHtml(pr.title)}" \u{2192} ${escapeHtml(pr.base.ref)}\n` +
          `\u{1F517} ${pr.html_url}`;
        eventType = "pr.merged";
      } else {
        message = `\u{274C} PR #${pr.number} closed without merge`;
        eventType = "pr.closed";
      }
      break;

    default:
      // Ignore other PR actions (edited, synchronize, etc.) to reduce noise
      // Still log if it is a known action on a draft PR
      if (pr.draft) {
        eventType = `pr.${action}.draft`;
      }
      break;
  }

  if (message) {
    // Quiet hours: skip all PR events (never urgent enough for 2am)
    if (isQuietHours()) {
      if (eventType) await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(pr.number));
      return new Response("OK");
    }

    // Send PR notifications via DM to subscribers (not to group)
    // Look up the sender's telegram_id to exclude them
    const prMembers = await getTeamMembers(env.PROJECTS);
    const senderMember = prMembers.find((m) => m.github === sender.login);
    const finalMessage = message; // capture for closure

    await notifySubscribers(
      env,
      project.botToken,
      "pr_reviews",
      () => finalMessage,
      senderMember?.telegram_id
    );
  }

  // Always-on pull reminder when a PR is merged — not preference-gated
  // because stale local branches cause real merge conflicts
  if (pr.merged && action === "closed") {
    await sendPullReminder(
      env,
      project.botToken,
      sender.login,
      pr.title,
      pr.number,
      pr.commits
    );
  }

  // Log ALL events to D1 for reports (even filtered/draft ones)
  if (eventType) {
    await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(pr.number));
  }

  return new Response("OK");
}

/**
 * Handle GitHub "pull_request_review" events.
 * Sends DM to PR author for approved/changes_requested reviews.
 * Plain "commented" reviews are ignored to reduce noise.
 */
async function handleGitHubReview(
  rawBody: string,
  project: ProjectConfig,
  env: Env,
  projectId: string
): Promise<Response> {
  let payload: GitHubReviewPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubReviewPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { action, review, pull_request: pr, sender } = payload;
  let message: string | null = null;
  let eventType: string | null = null;

  if (action === "submitted") {
    switch (review.state) {
      case "approved":
        message = `\u{2705} @${escapeHtml(review.user.login)} approved PR #${pr.number}`;
        eventType = "review.approved";
        break;

      case "changes_requested":
        message = `\u{274C} @${escapeHtml(review.user.login)} requested changes on PR #${pr.number}`;
        eventType = "review.changes_requested";
        break;

      case "commented":
        // Plain comments are too noisy — log but don't notify
        eventType = "review.commented";
        break;

      default:
        eventType = `review.${review.state}`;
        break;
    }
  }

  if (message) {
    // Send review notification as DM to the PR author (always on — task-relevant)
    const reviewMembers = await getTeamMembers(env.PROJECTS);
    const prAuthor = reviewMembers.find((m) => m.github === pr.user.login);

    if (prAuthor) {
      const dnd = await isUserDND(env.PROJECTS, prAuthor.telegram_id);
      if (!dnd) {
        const authorPrefs = await getUserPreferences(env.PROJECTS, prAuthor.telegram_id);
        if (authorPrefs.dm_chat_id) {
          const dmStatus = await sendDM(project.botToken, authorPrefs.dm_chat_id, message);
          if (dmStatus === "blocked") {
            authorPrefs.dm_chat_id = null;
            await saveUserPreferences(env.PROJECTS, prAuthor.telegram_id, authorPrefs);
          }
        }
      }
    }
  }

  // Log ALL review events to D1 for reports
  if (eventType) {
    await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(pr.number));
  }

  return new Response("OK");
}

/**
 * Handle GitHub "push" events.
 * Only notifies for pushes to main/master — other branches are ignored
 * to prevent notification overload from feature branch work.
 */
async function handleGitHubPush(
  rawBody: string,
  project: ProjectConfig,
  env: Env,
  _projectId: string
): Promise<Response> {
  let payload: GitHubPushPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubPushPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { ref, commits, pusher } = payload;

  // Extract the branch name from the full ref (e.g., "refs/heads/main" → "main")
  const branch = ref.replace("refs/heads/", "");
  const isMainBranch = branch === "main" || branch === "master";
  const eventType = isMainBranch ? "push.main" : "push.branch";

  if (isMainBranch && commits.length > 0) {
    // Send commit notifications via DM to subscribers (not to group)
    await notifySubscribers(
      env,
      project.botToken,
      "commits",
      () => `\u{1F680} ${commits.length} new commit${commits.length === 1 ? "" : "s"} on ${escapeHtml(branch)} by @${escapeHtml(pusher.name)}`
    );
  }

  // Log ALL push events to D1 (even non-main branches) for reports
  await logEvent(env.DB, project.githubRepo, eventType, pusher.name, branch, {
    commit_count: commits.length,
  });

  // Check for merge conflicts on open PRs after push to main
  if (isMainBranch && project.githubToken) {
    try {
      const prsRes = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=50`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + project.githubToken } }
      );
      if (prsRes.ok) {
        const prs = await prsRes.json() as Array<{
          number: number; title: string; mergeable: boolean | null; html_url: string;
        }>;
        const conflicts = prs.filter((pr) => pr.mergeable === false);
        if (conflicts.length > 0) {
          const conflictMsg = conflicts
            .map((pr) => `\u{26A0}\u{FE0F} PR #${pr.number} "${pr.title}"\n\u{1F517} ${pr.html_url}`)
            .join("\n\n");
          const body: Record<string, unknown> = {
            chat_id: project.chatId,
            text: `\u{1F6A8} <b>Merge conflicts after push to ${branch}:</b>\n\n${conflictMsg}`,
            parse_mode: "HTML", disable_web_page_preview: true,
          };
          if (project.threadId) body.message_thread_id = project.threadId;
          await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(body),
          });
        }
      }
    } catch {}
  }

  return new Response("OK");
}

/**
 * Handle GitHub "workflow_run" events.
 * Only notifies on failures — successful CI runs are silent to reduce noise.
 */
async function handleGitHubWorkflow(
  rawBody: string,
  project: ProjectConfig,
  env: Env,
  _projectId: string
): Promise<Response> {
  let payload: GitHubWorkflowPayload;
  try {
    payload = JSON.parse(rawBody) as GitHubWorkflowPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { action, workflow_run: run, sender } = payload;
  let message: string | null = null;
  let eventType: string | null = null;

  if (action === "completed") {
    if (run.conclusion === "failure") {
      message =
        `\u{274C} CI failed: ${run.name} on ${run.head_branch}\n` +
        `\u{1F517} ${run.html_url}`;
      eventType = "ci.failure";
    } else {
      // Success, cancelled, skipped, etc. — log but don't notify
      eventType = `ci.${run.conclusion}`;
    }
  }

  if (message) {
    await sendTelegram(project.botToken, project.chatId, message, project.threadId);
  }

  // Log ALL workflow events to D1 for reports
  if (eventType) {
    await logEvent(env.DB, project.githubRepo, eventType, sender.login, run.name, {
      conclusion: run.conclusion,
      branch: run.head_branch,
    });
  }

  return new Response("OK");
}

// ---------------------------------------------------------------------------
// Route: POST /github/:projectId — main GitHub webhook entry point
// ---------------------------------------------------------------------------

/**
 * Main GitHub webhook handler. Verifies the signature, reads the event type
 * from the X-GitHub-Event header, and dispatches to the appropriate
 * sub-handler. Unknown event types are acknowledged silently.
 */
async function handleGitHub(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const project = await getProject(env.PROJECTS, projectId, env);
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  // Read raw body first — needed for signature verification and JSON parsing
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return new Response("Could not read request body", { status: 400 });
  }

  // Verify GitHub webhook signature when secret is configured
  if (env.GITHUB_WEBHOOK_SECRET) {
    const signature = request.headers.get("X-Hub-Signature-256");
    const valid = await verifyGitHubSignature(
      rawBody,
      signature,
      env.GITHUB_WEBHOOK_SECRET
    );
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }
  }
  // When no secret is configured, all requests are accepted (development mode)

  const event = request.headers.get("X-GitHub-Event");

  switch (event) {
    case "issues":
      return handleGitHubIssues(rawBody, project, env, projectId);

    case "pull_request":
      return handleGitHubPR(rawBody, project, env, projectId);

    case "pull_request_review":
      return handleGitHubReview(rawBody, project, env, projectId);

    case "push":
      return handleGitHubPush(rawBody, project, env, projectId);

    case "workflow_run":
      return handleGitHubWorkflow(rawBody, project, env, projectId);

    default:
      // Acknowledge unknown events without processing
      return new Response("OK");
  }
}

// ---------------------------------------------------------------------------
// Route: POST /session/:projectId
// ---------------------------------------------------------------------------

async function handleSession(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const project = await getProject(env.PROJECTS, projectId, env);
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  let update: SessionUpdate;
  try {
    update = (await request.json()) as SessionUpdate;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!update.type || !update.user) {
    return new Response("Missing type or user", { status: 400 });
  }

  const sessions = await getActiveSessions(env.PROJECTS, projectId);

  if (update.type === "start") {
    // Preserve original "since" time if user is already active (context compression re-fires start)
    const existingStart = sessions.find((s) => s.user === update.user)?.since;
    const isNewSession = !existingStart;
    const filtered = sessions.filter((s) => s.user !== update.user);
    filtered.push({
      user: update.user,
      since: existingStart ||
        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }),
    });
    await setActiveSessions(env.PROJECTS, projectId, filtered);
    // Log session start to D1 for work hours tracking
    await logSessionStart(env.DB, update.user, projectId);

    // Notify session subscribers via DM (only for genuinely new sessions)
    if (isNewSession) {
      await notifySubscribers(
        env,
        project.botToken,
        "sessions",
        () => `\u{1F7E2} ${escapeHtml(update.user)} is now online (${escapeHtml(projectId)})`
      );

      // Send private morning DM on session start (deduped — only once per 12h)
      try {
        const allMembers = await getTeamMembers(env.PROJECTS);
        const member = allMembers.find(
          (m) => m.github === update.user || m.name === update.user
        );
        if (member) {
          const dedupKey = `morning_dm:${member.telegram_id}`;
          const alreadySent = await env.PROJECTS.get(dedupKey);
          if (!alreadySent) {
            const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
            if (prefs.dm_chat_id) {
              const projects = await getProjectList(env);
              await sendPrivateMorningDM(env, member, projects, allMembers);
              await env.PROJECTS.put(dedupKey, "1", { expirationTtl: 43200 }); // 12h TTL
            }
          }
        }
      } catch (e) {
        console.error("[Session] Morning DM on session start failed:", e);
      }
    }
  } else if (update.type === "heartbeat") {
    // Refresh session TTL (keeps user "online") but preserve original "since" time
    const existingSince = sessions.find((s) => s.user === update.user)?.since;
    const filtered = sessions.filter((s) => s.user !== update.user);
    filtered.push({
      user: update.user,
      since: existingSince ||
        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }),
    });
    await setActiveSessions(env.PROJECTS, projectId, filtered);

    // Store activity data (branch, files, commit) for /active display
    if (update.branch) {
      await saveActivityData(env.PROJECTS, projectId, update.user, {
        branch: update.branch,
        lastFiles: update.lastFiles || [],
        lastCommit: update.lastCommit || "",
      });
    }

    // File-level conflict detection — warn users editing the same files
    const heartbeatFiles = update.lastFiles || [];
    if (heartbeatFiles.length > 0) {
      // Resolve current user's telegram_id from team member registry
      const allMembers = await getTeamMembers(env.PROJECTS);
      const currentMember = allMembers.find(
        (m) => m.github === update.user || m.name === update.user
      );
      if (currentMember) {
        await saveChangedFiles(env.PROJECTS, projectId, currentMember.telegram_id, heartbeatFiles);
        await detectFileConflicts(
          env,
          projectId,
          update.user,
          currentMember.telegram_id,
          heartbeatFiles,
          project.botToken
        );
      }
    }
  } else if (update.type === "end") {
    // Don't remove from KV — auto-expires via TTL (prevents false offline from context compression)
    // But DO log the end to D1 for work hours tracking
    await logSessionEnd(env.DB, update.user, projectId);
    // Clear claimed tasks from dashboard state
    const dashState = await getDashboardState(env.PROJECTS, projectId);
    dashState.activeSessions = dashState.activeSessions.filter(
      (s) => s.user !== update.user
    );
    await saveDashboardState(env.PROJECTS, projectId, dashState);

    // Notify session subscribers via DM
    await notifySubscribers(
      env,
      project.botToken,
      "sessions",
      () => `\u{1F534} ${escapeHtml(update.user)} went offline (${escapeHtml(projectId)})`
    );

    // Send private evening DM on session end (deduped — only once per 24h)
    try {
      const allMembers = await getTeamMembers(env.PROJECTS);
      const member = allMembers.find(
        (m) => m.github === update.user || m.name === update.user
      );
      if (member) {
        const projects = await getProjectList(env);
        await sendPrivateEveningDM(env, member, projects, allMembers);
      }
    } catch (e) {
      console.error("[Session] Evening DM on session end failed:", e);
    }
  } else {
    return new Response("Invalid session type", { status: 400 });
  }

  return Response.json({ ok: true, type: update.type, user: update.user });
}

// ---------------------------------------------------------------------------
// Route: POST /register
// ---------------------------------------------------------------------------

async function handleRegister(
  request: Request,
  env: Env
): Promise<Response> {
  let payload: RegisterPayload;
  try {
    payload = (await request.json()) as RegisterPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!payload.projectId || !payload.botToken || !payload.chatId) {
    return new Response(
      "Missing required fields: projectId, botToken, chatId",
      { status: 400 }
    );
  }

  const config: ProjectConfig = {
    botToken: payload.botToken,
    chatId: payload.chatId,
    threadId: payload.threadId,
    loginThreadId: payload.loginThreadId || null,
    loginChatId: payload.loginChatId || null,
    githubRepo: payload.githubRepo,
    githubToken: payload.githubToken,
    members: payload.members || [],
  };

  await env.PROJECTS.put(payload.projectId, JSON.stringify(config));

  return new Response(
    JSON.stringify({
      ok: true,
      projectId: payload.projectId,
      webhooks: {
        telegram: `/telegram/${payload.projectId}`,
        github: `/github/${payload.projectId}`,
        session: `/session/${payload.projectId}`,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

// ---------------------------------------------------------------------------
// Router for non-Telegram routes
// ---------------------------------------------------------------------------

/**
 * Simple path-based router for API routes (GitHub, sessions, register, etc.).
 * Telegram routes are handled separately via grammy webhookCallback.
 */
function matchRoute(
  method: string,
  pathname: string
): { handler: string; projectId?: string } | null {
  if (method === "GET" && pathname === "/") {
    return { handler: "health" };
  }

  if (method === "POST" && pathname === "/register") {
    return { handler: "register" };
  }

  if (method === "POST" && pathname === "/register-member") {
    return { handler: "register-member" };
  }

  // GET /sessions/:projectId — fetch active sessions (for notify.js)
  const sessionsMatch = pathname.match(/^\/sessions\/([a-zA-Z0-9_-]+)\/?$/);
  if (sessionsMatch && method === "GET") {
    return { handler: "get-sessions", projectId: sessionsMatch[1] };
  }

  // Match /:handler/:projectId patterns (excluding telegram — handled by grammy)
  const match = pathname.match(
    /^\/(github|session|dashboard)\/([a-zA-Z0-9_-]+)\/?$/
  );
  if (match && method === "POST") {
    return { handler: match[1], projectId: match[2] };
  }

  // Telegram webhook: POST /telegram/:projectId
  const telegramMatch = pathname.match(
    /^\/telegram\/([a-zA-Z0-9_-]+)\/?$/
  );
  if (telegramMatch && method === "POST") {
    return { handler: "telegram", projectId: telegramMatch[1] };
  }

  // Coolify deployment webhook: POST /coolify/:projectId
  const coolifyMatch = pathname.match(
    /^\/coolify\/([a-zA-Z0-9_-]+)\/?$/
  );
  if (coolifyMatch && method === "POST") {
    return { handler: "coolify", projectId: coolifyMatch[1] };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Test-only exports — onboarding helpers & supporting functions
// ---------------------------------------------------------------------------

export {
  getOnboardingState,
  setOnboardingState,
  clearOnboardingState,
  isOnboarded,
  markOnboarded,
  sendOnboardingTutorial,
  getTeamMembers,
  upsertTeamMember,
  getUserPreferences,
  saveUserPreferences,
  buildSettingsMessage,
  escapeHtml,
  githubRequest,
  getActiveProject,
  setActiveProject,
  resolveActiveProject,
  getProjectList,
  // Priority system helpers
  getIssuePriority,
  getPrioritySortWeight,
  sortByPriority,
  isBlockerActive,
  formatPriority,
  PRIORITY_LEVELS,
  PRIORITY_EMOJIS,
  PRIORITY_DEFAULT,
  // Help system texts (Issue #52, foundation for #65)
  HELP_TEXTS,
  // Meine Aufgaben helpers
  getActiveTask,
  setActiveTask,
  clearActiveTask,
  getTodayDoneCount,
  incrementTodayDoneCount,
  handleMeineAufgaben,
  // Category assignment helpers (Issue #48)
  getCategoryClaims,
  saveCategoryClaims,
  fetchOpenIssuesByCategory,
  assignIssuesToUser,
  unassignIssuesFromUser,
  getUserColor,
  getUserColorByName,
  handleAufgabeNehmen,
  handleCategoryPick,
  handleCategoryConfirm,
  handleCategoryAssign,
  // Pause flow helpers (Issue #50)
  getPausedCategories,
  savePausedCategories,
  addPausedCategory,
  removePausedCategory,
  handlePause,
  handlePauseConfirm,
  // Neue Idee helpers (Issue #51)
  getNewIdeaState,
  setNewIdeaState,
  clearNewIdeaState,
  fetchAreaLabels,
  createIdeaIssue,
  buildIdeaCategoryKeyboard,
  buildIdeaPriorityKeyboard,
  finalizeNewIdea,
  // Project switcher helper (Issue #53)
  renderHomeScreen,
  // Team Board (Issue #54)
  renderTeamBoard,
  // Prompt generator (Issue #54 — Claude Code prompts from issues)
  parseIssueBody,
  findRelevantFiles,
  generateClaudePrompt,
  // Preview & Merge helpers (Issue #56)
  getPreviewUrl,
  setPreviewUrl,
  createPreviewPR,
  submitPRReview,
  sendPullReminder,
  sendPreviewNotifications,
  // Conflict detector helpers (Issue #58)
  saveChangedFiles,
  getChangedFiles,
  hasConflictWarning,
  setConflictWarning,
  detectFileConflicts,
  isUserDND,
  sendDM,
  // Team messaging helpers (Issue #59)
  parseAtMentions,
  parseIssueReferences,
  getMessageThread,
  setMessageThread,
  // Time tracker helpers (Issue #60)
  getTimer,
  startTimer,
  stopTimer,
  logTimeEntry,
  getDailyHours,
  getWeeklyHours,
  formatDuration,
  // Velocity report helpers (Issue #61)
  saveVelocitySnapshot,
  getVelocityData,
  getLastTwoWeeksVelocity,
  calculateVelocitySnapshot,
  getWeekStartDate,
  formatDelta,
  renderVelocityView,
  // Morning message helpers (Issue #62)
  sendPrivateMorningDM,
  sendGroupMorningMessage,
  sendMorningDigest,
  getYesterdayStats,
  getYesterdayWorkHours,
  // Evening message helpers (Issue #63)
  sendPrivateEveningDM,
  sendGroupEveningMessage,
  sendEveningDigest,
};
export type { OnboardingStep, TeamMember, UserPreferences, Env, ProjectConfig, CategoryClaim, CategoryClaimsState, PausedCategory, NewIdeaState, MessageThread, TimerState, VelocitySnapshot };

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);

    if (!route) {
      return new Response("Not Found", { status: 404 });
    }

    switch (route.handler) {
      case "health":
        return new Response("Cortex Team Bot Worker is running");

      case "register":
        if (!verifyBotSecret(request, env)) return new Response("Unauthorized", { status: 401 });
        return handleRegister(request, env);

      case "register-member":
        if (!verifyBotSecret(request, env)) return new Response("Unauthorized", { status: 401 });
        return handleRegisterMember(request, env);

      case "telegram": {
        // grammy handles the Telegram webhook — create a bot per project
        const project = await getProject(env.PROJECTS, route.projectId!, env);
        if (!project) {
          return new Response("Project not found", { status: 404 });
        }

        const bot = createBot(project, env, route.projectId!);

        try {
          const handler = webhookCallback(bot, "cloudflare-mod");
          return await handler(request);
        } catch (err) {
          // If grammy throws, send a user-friendly error to the chat
          const errMessage = err instanceof Error ? err.message : "Unknown error";
          await sendTelegram(
            project.botToken,
            project.chatId,
            `Error: ${errMessage}`,
            project.threadId
          );
          return new Response("OK");
        }
      }

      case "github":
        try {
          return await handleGitHub(request, env, route.projectId!);
        } catch (err) {
          // Surface actionable info for debugging but don't leak internals
          const msg = err instanceof Error ? err.message : String(err);
          console.error("GitHub handler error:", err);
          return new Response(`GitHub handler error: ${msg}`, { status: 500 });
        }

      case "session":
        if (!verifyBotSecret(request, env)) return new Response("Unauthorized", { status: 401 });
        return handleSession(request, env, route.projectId!);

      case "dashboard": {
        if (!verifyBotSecret(request, env)) return new Response("Unauthorized", { status: 401 });
        const dashProject = await getProject(env.PROJECTS, route.projectId!, env);
        if (!dashProject) {
          return new Response("Project not found", { status: 404 });
        }
        await sendOrEditDashboard(env, route.projectId!, dashProject);
        return Response.json({ ok: true });
      }

      case "get-sessions": {
        if (!verifyBotSecret(request, env)) return new Response("Unauthorized", { status: 401 });
        const sessions = await getActiveSessions(env.PROJECTS, route.projectId!);
        return Response.json({ sessions });
      }

      case "coolify": {
        // Coolify sends deployment_status webhooks when a preview builds.
        // We extract the preview URL and store it in KV, then DM the team.
        if (!verifyBotSecret(request, env)) return new Response("Unauthorized", { status: 401 });
        try {
          const coolifyBody = (await request.json()) as {
            status?: string;
            preview_url?: string;
            url?: string;
            deployment_url?: string;
            pull_request_number?: number;
            pr_number?: number;
            branch?: string;
          };

          // Coolify webhooks can come in various shapes depending on version.
          // We accept the URL from whichever field is present.
          const rawDeployUrl =
            coolifyBody.preview_url ||
            coolifyBody.deployment_url ||
            coolifyBody.url;
          const prNum =
            coolifyBody.pull_request_number ||
            coolifyBody.pr_number;

          if (!rawDeployUrl || !prNum) {
            return new Response("Missing preview_url or pr_number", { status: 400 });
          }

          // Validate URL scheme to prevent javascript: / data: injection
          const deployUrl = sanitizeUrl(rawDeployUrl);
          if (!deployUrl) {
            return new Response("Invalid preview URL scheme", { status: 400 });
          }

          const coolifyProjectId = route.projectId!;

          // Store the preview URL in KV (7-day TTL)
          await setPreviewUrl(env.PROJECTS, coolifyProjectId, prNum, deployUrl);

          // Resolve the project to get bot token and notify team
          const coolifyProject = await getProject(env.PROJECTS, coolifyProjectId, env);
          if (coolifyProject) {
            // Look up PR title for a nicer notification
            let prTitle = `PR #${prNum}`;
            let prUrl = "";
            if (coolifyProject.githubToken) {
              try {
                const prRes = await githubRequest(
                  "GET",
                  `/repos/${coolifyProject.githubRepo}/pulls/${prNum}`,
                  coolifyProject.githubToken
                );
                if (prRes.ok) {
                  const prData = (await prRes.json()) as { title: string; html_url: string };
                  prTitle = prData.title;
                  prUrl = prData.html_url;
                }
              } catch {
                // Best-effort title lookup
              }
            }

            // DM all team members with preview link and review buttons
            const members = await getTeamMembers(env.PROJECTS);
            for (const member of members) {
              const dnd = await isUserDND(env.PROJECTS, member.telegram_id);
              if (dnd) continue;

              const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
              if (!prefs.dm_chat_id) continue;
              if (!prefs.previews && !prefs.pr_reviews) continue;

              const prUrlLine = prUrl
                ? `\n\u{1F517} <a href="${prUrl}">View PR</a>`
                : "";

              const text =
                `\u{1F310} <b>Preview Ready!</b>\n${"━".repeat(16)}\n\n` +
                `PR #${prNum}: "${escapeHtml(prTitle)}"\n` +
                `\u{1F680} <a href="${deployUrl}">Open Preview</a>${prUrlLine}\n\n` +
                `Please review:`;

              const reviewKb: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> } = {
                inline_keyboard: [
                  [
                    { text: "\u{2705} Approve", callback_data: `review_approve:${prNum}` },
                    { text: "\u{270F}\u{FE0F} Request Changes", callback_data: `review_changes:${prNum}` },
                  ],
                  [
                    { text: "\u{1F310} Preview", url: deployUrl },
                  ],
                ],
              };

              const status = await sendDM(coolifyProject.botToken, prefs.dm_chat_id, text, reviewKb);
              if (status === "blocked") {
                prefs.dm_chat_id = null;
                await saveUserPreferences(env.PROJECTS, member.telegram_id, prefs);
              }
            }

            // Log the deployment event
            await logEvent(
              env.DB,
              coolifyProject.githubRepo,
              "preview.deployed",
              "coolify",
              String(prNum),
              { url: deployUrl }
            );
          }

          return Response.json({ ok: true, stored: `preview:${coolifyProjectId}:${prNum}` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("Coolify handler error:", msg);
          return new Response(`Coolify handler error: ${msg}`, { status: 500 });
        }
      }

      default:
        return new Response("Not Found", { status: 404 });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const hour = new Date(event.scheduledTime).getUTCHours();
    const minute = new Date(event.scheduledTime).getUTCMinutes();
    const dayOfWeek = new Date(event.scheduledTime).getUTCDay();

    // Every 30 min: stale PR check
    await checkStalePRs(env);

    // Mon-Fri 07:00 UTC (09:00 CEST): morning digest
    if (hour === 7 && minute === 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      await sendMorningDigest(env);
    }

    // Mon-Fri 16:00 UTC (18:00 CEST): evening digest (group + private DMs)
    if (hour === 16 && minute === 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      await sendEveningDigest(env);
    }

    // Friday 15:00 UTC (17:00 CEST): weekly report
    if (hour === 15 && minute === 0 && dayOfWeek === 5) {
      await sendWeeklyReport(env);
    }
  },
};

// ---------------------------------------------------------------------------
// Cron handlers — stale PRs, digests, reports
// ---------------------------------------------------------------------------

async function sendToLoginChannel(env: Env, text: string): Promise<void> {
  const projects = await getProjectList(env);
  if (projects.length === 0) return;
  const p = projects[0].config;
  const chatId = p.loginChatId || p.chatId;
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
  };
  if (p.loginThreadId) body.message_thread_id = p.loginThreadId;
  await fetch(`https://api.telegram.org/bot${p.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
}

async function checkStalePRs(env: Env): Promise<void> {
  const projects = await getProjectList(env);
  const now = Date.now();

  for (const { id, config: project } of projects) {
    if (!project.githubToken) continue;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=50`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + project.githubToken } }
      );
      if (!res.ok) continue;

      const prs = await res.json() as Array<{
        number: number; title: string; html_url: string; created_at: string;
        user: { login: string }; requested_reviewers: Array<{ login: string }>; draft: boolean;
      }>;

      const alerts: string[] = [];
      for (const pr of prs) {
        if (pr.draft) continue;
        const ageHours = (now - new Date(pr.created_at).getTime()) / (1000 * 60 * 60);
        if (ageHours > 24 && pr.requested_reviewers.length === 0) {
          alerts.push(`\u{1F6A8} PR #${pr.number} "${pr.title}" by @${pr.user.login} \u{2014} open ${Math.round(ageHours)}h, NO REVIEWER!\n\u{1F517} ${pr.html_url}`);
        } else if (ageHours > 4 && pr.requested_reviewers.length === 0) {
          alerts.push(`\u{26A0}\u{FE0F} PR #${pr.number} "${pr.title}" by @${pr.user.login} \u{2014} open ${Math.round(ageHours)}h, no reviewer\n\u{1F517} ${pr.html_url}`);
        }
      }

      if (alerts.length > 0) {
        const alertKey = `stale-alert:${id}`;
        const lastAlert = await env.PROJECTS.get(alertKey);
        const lastAlertTime = lastAlert ? parseInt(lastAlert, 10) : 0;
        if (now - lastAlertTime > 2 * 60 * 60 * 1000) {
          const body: Record<string, unknown> = {
            chat_id: project.chatId,
            text: `\u{1F6A8} <b>Stale PR Alert</b>\n\n${alerts.join("\n\n")}`,
            parse_mode: "HTML", disable_web_page_preview: true,
          };
          if (project.threadId) body.message_thread_id = project.threadId;
          await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify(body),
          });
          await env.PROJECTS.put(alertKey, String(now), { expirationTtl: 7200 });
        }
      }
    } catch (e) {
      console.error(`[Cron] Stale PR check failed for ${id}:`, e);
    }
  }
}

// ---------------------------------------------------------------------------
// Morning messages — private DM per user + group overview (Issue #62)
// ---------------------------------------------------------------------------

/**
 * Send a private morning DM to a single team member.
 * Shows: yesterday's completed tasks with time, open branches with preview links,
 * today's pending tasks across all projects, and contextual tips.
 */
async function sendPrivateMorningDM(
  env: Env,
  member: TeamMember,
  projects: Array<{ id: string; config: ProjectConfig }>,
  allMembers: TeamMember[]
): Promise<void> {
  const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
  if (!prefs.dm_chat_id) return;

  const dnd = await isUserDND(env.PROJECTS, member.telegram_id);
  if (dnd) return;

  const color = getUserColorByName(allMembers, member.name);
  const lines: string[] = [
    `${color} <b>Good morning, ${escapeHtml(member.name)}!</b>`,
    "\u{2500}".repeat(25),
    "",
  ];

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const tips: string[] = [];
  let totalYesterdayMinutes = 0;

  for (const { id: projectId, config: project } of projects) {
    const token = getGitHubToken(env, project);

    // --- Yesterday's completed tasks (closed issues by this user) ---
    try {
      const closedEvents = await env.DB.prepare(
        `SELECT target, metadata FROM events
         WHERE repo = ? AND actor = ? AND event_type = 'issues.closed'
         AND date(created_at) = ?
         ORDER BY created_at DESC LIMIT 20`
      ).bind(project.githubRepo, member.github, yesterdayStr)
        .all<{ target: string; metadata: string | null }>();

      if (closedEvents.results && closedEvents.results.length > 0) {
        lines.push(`\u{2705} <b>Completed yesterday</b> (${escapeHtml(projectId)}):`);
        for (const ev of closedEvents.results) {
          const issueNum = ev.target ? `#${escapeHtml(ev.target)}` : "";
          let title = "";
          if (ev.metadata) {
            try {
              const meta = JSON.parse(ev.metadata);
              if (meta.title) title = ` ${escapeHtml(String(meta.title))}`;
            } catch { /* best-effort */ }
          }
          lines.push(`  \u{2022} ${issueNum}${title}`);
        }
        lines.push("");
      }
    } catch (e) {
      console.error(`[MorningDM] Events query failed for ${projectId}:`, e);
    }

    // --- Yesterday's tracked time ---
    try {
      const dailyMins = await getDailyHours(env.DB, member.telegram_id, yesterdayStr);
      if (dailyMins > 0) {
        totalYesterdayMinutes += dailyMins;
      }
    } catch { /* best-effort */ }

    // --- Open branches with preview links ---
    if (token) {
      try {
        const branchRes = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=50`,
          { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
        );
        if (branchRes.ok) {
          const prs = await branchRes.json() as Array<{
            number: number; title: string; user: { login: string };
            head: { ref: string }; requested_reviewers: Array<{ login: string }>;
          }>;

          // PRs created by this user
          const myPRs = prs.filter((pr) => pr.user.login === member.github);
          if (myPRs.length > 0) {
            lines.push(`\u{1F500} <b>Your open branches</b> (${escapeHtml(projectId)}):`);
            for (const pr of myPRs) {
              const previewUrl = await getPreviewUrl(env.PROJECTS, projectId, pr.number);
              const previewStr = previewUrl ? ` \u{2014} <a href="${escapeHtml(previewUrl)}">Preview</a>` : "";
              lines.push(`  \u{2022} #${pr.number} ${escapeHtml(pr.title)}${previewStr}`);
              tips.push(`You have an open PR #${pr.number} in ${projectId} — consider merging or requesting review.`);
            }
            lines.push("");
          }

          // PRs where this user is requested as reviewer
          const reviewPRs = prs.filter((pr) =>
            pr.requested_reviewers.some((r) => r.login === member.github)
          );
          if (reviewPRs.length > 0) {
            lines.push(`\u{1F440} <b>Waiting for your review</b> (${escapeHtml(projectId)}):`);
            for (const pr of reviewPRs) {
              lines.push(`  \u{2022} #${pr.number} ${escapeHtml(pr.title)} (@${escapeHtml(pr.user.login)})`);
            }
            lines.push("");
          }
        }
      } catch (e) {
        console.error(`[MorningDM] GitHub PR fetch failed for ${projectId}:`, e);
      }
    }

    // --- Today's pending tasks (open issues assigned to this user) ---
    if (token) {
      try {
        const issuesRes = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/issues?state=open&assignee=${member.github}&per_page=20`,
          { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
        );
        if (issuesRes.ok) {
          const issues = await issuesRes.json() as Array<{
            number: number; title: string; pull_request?: unknown;
          }>;
          // Filter out PRs (GitHub returns PRs in the issues endpoint)
          const realIssues = issues.filter((i) => !i.pull_request);
          if (realIssues.length > 0) {
            lines.push(`\u{1F4CB} <b>Today's tasks</b> (${escapeHtml(projectId)}):`);
            for (const issue of realIssues.slice(0, 10)) {
              lines.push(`  \u{2022} #${issue.number} ${escapeHtml(issue.title)}`);
            }
            if (realIssues.length > 10) {
              lines.push(`  <i>...and ${realIssues.length - 10} more</i>`);
            }
            lines.push("");
          }
        }
      } catch (e) {
        console.error(`[MorningDM] GitHub issues fetch failed for ${projectId}:`, e);
      }
    }

    // --- Check if main has new commits the user should pull ---
    if (token) {
      try {
        const activity = await getActivityData(env.PROJECTS, projectId, member.name);
        if (activity && activity.branch && activity.branch !== "main" && activity.branch !== "master") {
          const compareRes = await fetch(
            `https://api.github.com/repos/${project.githubRepo}/compare/${activity.branch}...main`,
            { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
          );
          if (compareRes.ok) {
            const compare = await compareRes.json() as { ahead_by: number };
            if (compare.ahead_by > 5) {
              tips.push(`main is ${compare.ahead_by} commits ahead of your branch '${activity.branch}' in ${projectId} — consider pulling.`);
            }
          }
        }
      } catch { /* best-effort tip */ }
    }
  }

  // Yesterday's total tracked time (across all projects)
  if (totalYesterdayMinutes > 0) {
    lines.push(`\u{23F1}\u{FE0F} Yesterday's tracked time: <b>${formatDuration(totalYesterdayMinutes)}</b>`);
    lines.push("");
  }

  // Contextual tips
  if (tips.length > 0) {
    lines.push("\u{1F4A1} <b>Tips:</b>");
    for (const tip of tips.slice(0, 3)) {
      lines.push(`  \u{2022} ${escapeHtml(tip)}`);
    }
    lines.push("");
  }

  // If the DM is empty (only header), add an encouraging fallback
  if (lines.length <= 4) {
    lines.push("No pending tasks or branches — clean slate today! \u{1F389}");
  }

  // Determine which bot token to use (first project's token)
  const botToken = projects.length > 0 ? projects[0].config.botToken : "";
  if (!botToken) return;

  await sendDM(botToken, prefs.dm_chat_id, lines.join("\n"));
}

/**
 * Send the group morning message to the login channel.
 * Shows: all projects with category owners, open PRs with preview links,
 * yesterday's team performance summary.
 */
async function sendGroupMorningMessage(env: Env): Promise<void> {
  const projects = await getProjectList(env);
  const members = await getTeamMembers(env.PROJECTS);
  const lines: string[] = [
    "\u{2600}\u{FE0F} <b>Good Morning, Team!</b>",
    "\u{2500}".repeat(25),
    "",
  ];

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  // --- Projects with category owners ---
  for (const { id: projectId, config: project } of projects) {
    lines.push(`\u{1F4C1} <b>${escapeHtml(projectId)}</b>`);

    // Category claims
    try {
      const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
      if (claimsState.claims.length > 0) {
        for (const claim of claimsState.claims) {
          const color = getUserColorByName(members, claim.telegramName);
          const issueCount = claim.assignedIssues.length;
          lines.push(`  ${color} ${escapeHtml(claim.displayName)} \u{2014} ${escapeHtml(claim.telegramName)} (${issueCount} tasks)`);
        }
      } else {
        lines.push("  <i>No categories claimed</i>");
      }
    } catch {
      lines.push("  <i>Could not load categories</i>");
    }

    // Paused categories
    try {
      const paused = await getPausedCategories(env.PROJECTS, projectId);
      if (paused.length > 0) {
        for (const p of paused) {
          lines.push(`  \u{23F8}\u{FE0F} ${escapeHtml(p.displayName)} \u{2014} paused by ${escapeHtml(p.pausedBy)} (${p.completedTasks}/${p.totalTasks})`);
        }
      }
    } catch { /* best-effort */ }

    // Open PRs with preview links
    const token = getGitHubToken(env, project);
    if (token) {
      try {
        const prRes = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=50`,
          { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
        );
        if (prRes.ok) {
          const prs = await prRes.json() as Array<{
            number: number; title: string; user: { login: string };
            requested_reviewers: Array<{ login: string }>;
          }>;
          const needsReview = prs.filter((pr) => pr.requested_reviewers.length > 0);
          if (needsReview.length > 0) {
            lines.push("");
            lines.push(`  \u{1F50D} <b>Waiting for review:</b>`);
            for (const pr of needsReview) {
              const previewUrl = await getPreviewUrl(env.PROJECTS, projectId, pr.number);
              const previewStr = previewUrl ? ` \u{2014} <a href="${escapeHtml(previewUrl)}">Preview</a>` : "";
              const reviewers = pr.requested_reviewers.map((r) => `@${escapeHtml(r.login)}`).join(", ");
              lines.push(`    \u{2022} #${pr.number} ${escapeHtml(pr.title)} \u{2192} ${reviewers}${previewStr}`);
            }
          }
        }
      } catch (e) {
        console.error(`[MorningGroup] GitHub PR fetch failed for ${projectId}:`, e);
      }
    }
    lines.push("");
  }

  // --- Yesterday's team performance ---
  try {
    const stats = await getYesterdayStats(env.DB, yesterdayStr);
    const workHours = await getYesterdayWorkHours(env.DB, yesterdayStr);

    lines.push("\u{1F4CA} <b>Yesterday's Team Performance:</b>");
    lines.push(`  \u{1F4DD} Issues: ${stats.issues_opened} opened, ${stats.issues_closed} closed`);
    lines.push(`  \u{1F500} PRs: ${stats.prs_merged} merged, ${stats.prs_opened} opened`);
    lines.push(`  \u{1F4C8} Total events: ${stats.total_events}`);

    if (workHours.length > 0) {
      lines.push("");
      lines.push("  <b>Work Hours:</b>");
      for (const w of workHours) {
        const color = getUserColorByName(members, w.user_id);
        lines.push(`  ${color} ${escapeHtml(w.user_id)}: ${formatDuration(w.total_minutes)}`);
      }
    }
  } catch (e) {
    console.error("[MorningGroup] Yesterday stats failed:", e);
  }

  await sendToLoginChannel(env, lines.join("\n"));
}

/**
 * Query yesterday's event stats from D1.
 * Similar to getTodayStats but for a specific date.
 */
async function getYesterdayStats(
  db: D1Database,
  dateStr: string
): Promise<{ issues_opened: number; issues_closed: number; prs_merged: number; prs_opened: number; total_events: number }> {
  try {
    const opened = await db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.opened' AND date(created_at) = ?"
    ).bind(dateStr).first<{ c: number }>();

    const closed = await db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.closed' AND date(created_at) = ?"
    ).bind(dateStr).first<{ c: number }>();

    const merged = await db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'pr.merged' AND date(created_at) = ?"
    ).bind(dateStr).first<{ c: number }>();

    const prsOpened = await db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'pr.opened' AND date(created_at) = ?"
    ).bind(dateStr).first<{ c: number }>();

    const total = await db.prepare(
      "SELECT COUNT(*) as c FROM events WHERE date(created_at) = ?"
    ).bind(dateStr).first<{ c: number }>();

    return {
      issues_opened: opened?.c || 0,
      issues_closed: closed?.c || 0,
      prs_merged: merged?.c || 0,
      prs_opened: prsOpened?.c || 0,
      total_events: total?.c || 0,
    };
  } catch {
    return { issues_opened: 0, issues_closed: 0, prs_merged: 0, prs_opened: 0, total_events: 0 };
  }
}

/**
 * Query yesterday's work hours per user from D1 sessions table.
 */
async function getYesterdayWorkHours(
  db: D1Database,
  dateStr: string
): Promise<Array<{ user_id: string; total_minutes: number }>> {
  try {
    const result = await db.prepare(
      `SELECT user_id, SUM(duration_minutes) as total_minutes
       FROM sessions
       WHERE date(started_at) = ?
       GROUP BY user_id ORDER BY total_minutes DESC`
    ).bind(dateStr).all<{ user_id: string; total_minutes: number }>();
    return result.results || [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Morning digest — orchestrator (calls group + private DMs)
// ---------------------------------------------------------------------------

async function sendMorningDigest(env: Env): Promise<void> {
  // 1. Send the group morning message
  try {
    await sendGroupMorningMessage(env);
  } catch (e) {
    console.error("[MorningDigest] Group message failed:", e);
  }

  // 2. Send private morning DMs to all registered members (with dedup)
  try {
    const projects = await getProjectList(env);
    const members = await getTeamMembers(env.PROJECTS);

    for (const member of members) {
      try {
        const dedupKey = `morning_dm:${member.telegram_id}`;
        const alreadySent = await env.PROJECTS.get(dedupKey);
        if (alreadySent) continue; // Already received via session start

        const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
        if (!prefs.dm_chat_id) continue;

        await sendPrivateMorningDM(env, member, projects, members);
        await env.PROJECTS.put(dedupKey, "1", { expirationTtl: 43200 }); // 12h TTL
      } catch (e) {
        console.error(`[MorningDigest] DM failed for ${member.name}:`, e);
      }
    }
  } catch (e) {
    console.error("[MorningDigest] Private DMs failed:", e);
  }
}

async function sendWeeklyReport(env: Env): Promise<void> {
  const members = await getTeamMembers(env.PROJECTS);

  // Get this week's events from D1
  let weekIssuesOpened = 0, weekIssuesClosed = 0, weekPRsMerged = 0, weekTotalEvents = 0;
  const contributorMap = new Map<string, number>();

  try {
    const opened = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.opened' AND created_at > datetime('now', '-7 days')"
    ).first<{ c: number }>();
    weekIssuesOpened = opened?.c || 0;

    const closed = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'issues.closed' AND created_at > datetime('now', '-7 days')"
    ).first<{ c: number }>();
    weekIssuesClosed = closed?.c || 0;

    const merged = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM events WHERE event_type = 'pr.merged' AND created_at > datetime('now', '-7 days')"
    ).first<{ c: number }>();
    weekPRsMerged = merged?.c || 0;

    const total = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM events WHERE created_at > datetime('now', '-7 days')"
    ).first<{ c: number }>();
    weekTotalEvents = total?.c || 0;

    // Top contributors
    const contributors = await env.DB.prepare(
      "SELECT actor, COUNT(*) as actions FROM events WHERE created_at > datetime('now', '-7 days') GROUP BY actor ORDER BY actions DESC LIMIT 5"
    ).all<{ actor: string; actions: number }>();
    if (contributors.results) {
      for (const c of contributors.results) {
        contributorMap.set(c.actor, c.actions);
      }
    }
  } catch {}

  const net = weekIssuesClosed - weekIssuesOpened;
  const netIcon = net > 0 ? "\u{2705}" : net < 0 ? "\u{26A0}\u{FE0F}" : "\u{2796}";

  const lines: string[] = ["\u{1F4C8} <b>Weekly Report</b>", "\u{2500}".repeat(25), ""];
  lines.push(`\u{1F4DD} Issues: ${weekIssuesOpened} opened, ${weekIssuesClosed} closed (${netIcon} ${net >= 0 ? "+" : ""}${net} net)`);
  lines.push(`\u{1F500} PRs merged: ${weekPRsMerged}`);
  lines.push(`\u{1F4CA} Total events: ${weekTotalEvents}`);

  if (contributorMap.size > 0) {
    lines.push("");
    lines.push("<b>Top Contributors:</b>");
    const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}", "4.", "5."];
    let i = 0;
    for (const [actor, actions] of contributorMap) {
      const color = getUserColorByName(members, actor);
      lines.push(`${medals[i] || "\u{2022}"} ${color} ${actor}: ${actions} actions`);
      i++;
    }
  }

  // --- Velocity snapshot: calculate, save, and append comparison (Issue #61) ---
  const projects = await getProjectList(env);
  for (const { id: projectId } of projects) {
    try {
      const snapshot = await calculateVelocitySnapshot(env.DB, projectId, members);
      await saveVelocitySnapshot(env.DB, snapshot);

      // Try to find last week's data for a comparison line
      const lastWeekStart = getWeekStartDate(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      );
      const lastWeek = await getVelocityData(env.DB, projectId, lastWeekStart);

      lines.push("");
      lines.push(`\u{1F4CA} <b>Velocity — ${escapeHtml(projectId)}</b>`);
      lines.push(
        `   Tasks: ${snapshot.tasksCompleted} closed, ${snapshot.tasksOpened} opened`
      );
      lines.push(`   Team hours: ${formatDuration(snapshot.teamHours)}`);

      if (lastWeek) {
        lines.push(
          `   vs last week: tasks ${formatDelta(snapshot.tasksCompleted, lastWeek.tasksCompleted)}, hours ${formatDelta(snapshot.teamHours, lastWeek.teamHours)}`
        );
      }
    } catch {
      // Best-effort — don't break the weekly report
    }
  }

  await sendToLoginChannel(env, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Evening messages — private DM per user + group overview (Issue #63)
// ---------------------------------------------------------------------------

/**
 * Send a private evening DM to a single team member when they wrap up.
 * Shows: today's completed tasks with time, branch status, category claim check,
 * learnings placeholder (for future Issue #64 integration), and encouragement.
 *
 * Dedup: KV key `evening_dm:{telegramId}` with 24h TTL prevents duplicates.
 *
 * @param learnings - Optional array of learning descriptions forwarded from the
 *   session hook. Future Issue #64 will pull these from a D1 table instead.
 */
async function sendPrivateEveningDM(
  env: Env,
  member: TeamMember,
  projects: Array<{ id: string; config: ProjectConfig }>,
  allMembers: TeamMember[],
  learnings?: string[]
): Promise<void> {
  const prefs = await getUserPreferences(env.PROJECTS, member.telegram_id);
  if (!prefs.dm_chat_id) return;

  const dnd = await isUserDND(env.PROJECTS, member.telegram_id);
  if (dnd) return;

  // Dedup — only one evening DM per user per day (24h TTL)
  const dedupKey = `evening_dm:${member.telegram_id}`;
  const alreadySent = await env.PROJECTS.get(dedupKey);
  if (alreadySent) return;

  const color = getUserColorByName(allMembers, member.name);
  const lines: string[] = [
    `${color} <b>Good evening, ${escapeHtml(member.name)}!</b> \u{1F319}`,
    "\u{2500}".repeat(25),
    "",
  ];

  const todayStr = new Date().toISOString().slice(0, 10);
  let totalTodayMinutes = 0;
  let hasActiveClaim = false;

  for (const { id: projectId, config: project } of projects) {
    const token = getGitHubToken(env, project);

    // --- Today's completed tasks (closed issues by this user) ---
    try {
      const closedEvents = await env.DB.prepare(
        `SELECT target, metadata FROM events
         WHERE repo = ? AND actor = ? AND event_type = 'issues.closed'
         AND date(created_at) = date('now')
         ORDER BY created_at DESC LIMIT 20`
      ).bind(project.githubRepo, member.github)
        .all<{ target: string; metadata: string | null }>();

      if (closedEvents.results && closedEvents.results.length > 0) {
        lines.push(`\u{2705} <b>Completed today</b> (${escapeHtml(projectId)}):`);
        for (const ev of closedEvents.results) {
          const issueNum = ev.target ? `#${escapeHtml(ev.target)}` : "";
          let title = "";
          if (ev.metadata) {
            try {
              const meta = JSON.parse(ev.metadata);
              if (meta.title) title = ` ${escapeHtml(String(meta.title))}`;
            } catch { /* best-effort */ }
          }
          lines.push(`  \u{2022} ${issueNum}${title}`);
        }
        lines.push("");
      }
    } catch (e) {
      console.error(`[EveningDM] Events query failed for ${projectId}:`, e);
    }

    // --- Today's tracked time ---
    try {
      const dailyMins = await getDailyHours(env.DB, member.telegram_id, todayStr);
      if (dailyMins > 0) {
        totalTodayMinutes += dailyMins;
      }
    } catch { /* best-effort */ }

    // --- Branch status (open PRs by this user) ---
    if (token) {
      try {
        const branchRes = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=50`,
          { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
        );
        if (branchRes.ok) {
          const prs = await branchRes.json() as Array<{
            number: number; title: string; user: { login: string };
            head: { ref: string }; requested_reviewers: Array<{ login: string }>;
          }>;

          const myPRs = prs.filter((pr) => pr.user.login === member.github);
          if (myPRs.length > 0) {
            lines.push(`\u{1F500} <b>Your open branches</b> (${escapeHtml(projectId)}):`);
            for (const pr of myPRs) {
              const previewUrl = await getPreviewUrl(env.PROJECTS, projectId, pr.number);
              const previewStr = previewUrl ? ` \u{2014} <a href="${escapeHtml(previewUrl)}">Preview</a>` : "";
              const reviewers = pr.requested_reviewers.length > 0
                ? ` (reviewers: ${pr.requested_reviewers.map((r) => `@${escapeHtml(r.login)}`).join(", ")})`
                : " <i>(no reviewer assigned)</i>";
              lines.push(`  \u{2022} #${pr.number} ${escapeHtml(pr.title)}${reviewers}${previewStr}`);
            }
            lines.push("");
          }
        }
      } catch (e) {
        console.error(`[EveningDM] GitHub PR fetch failed for ${projectId}:`, e);
      }
    }

    // --- Category claim check — suggest picking a new category if none active ---
    try {
      const claimsState = await getCategoryClaims(env.PROJECTS, projectId);
      const userClaim = claimsState.claims.find(
        (c) => c.telegramName === member.name || c.githubUsername === member.github
      );
      if (userClaim) {
        hasActiveClaim = true;
      }
    } catch { /* best-effort */ }
  }

  // Today's total tracked time
  if (totalTodayMinutes > 0) {
    lines.push(`\u{23F1}\u{FE0F} Today's tracked time: <b>${formatDuration(totalTodayMinutes)}</b>`);
    lines.push("");
  }

  // Learnings section — accepts forwarded data or shows placeholder
  if (learnings && learnings.length > 0) {
    lines.push("\u{1F4DA} <b>Today's learnings:</b>");
    for (const learning of learnings.slice(0, 5)) {
      lines.push(`  \u{2022} ${escapeHtml(learning)}`);
    }
    lines.push("");
  } else {
    lines.push("\u{1F4DA} <i>No learnings captured today.</i>");
    lines.push("");
  }

  // Category suggestion if user has no active claim
  if (!hasActiveClaim) {
    lines.push("\u{1F4A1} <b>Tip:</b> You don't have an active category \u{2014} consider picking one tomorrow with /grab!");
    lines.push("");
  }

  // Encouragement
  lines.push("\u{1F31F} Great work today \u{2014} rest well and recharge!");

  const botToken = projects.length > 0 ? projects[0].config.botToken : "";
  if (!botToken) return;

  await sendDM(botToken, prefs.dm_chat_id, lines.join("\n"));

  // Set dedup key (24h TTL)
  await env.PROJECTS.put(dedupKey, "1", { expirationTtl: 86400 });
}

/**
 * Send the group evening message to the login channel.
 * Shows: today's completed work, who went offline, open work remaining,
 * preview links waiting for review, and team performance stats.
 *
 * Replaces the simple `sendEveningSummary` with a much richer overview.
 */
async function sendGroupEveningMessage(env: Env): Promise<void> {
  const projects = await getProjectList(env);
  const members = await getTeamMembers(env.PROJECTS);
  const todayStr = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    "\u{1F319} <b>Evening Summary</b>",
    "\u{2500}".repeat(25),
    "",
  ];

  for (const { id: projectId, config: project } of projects) {
    lines.push(`\u{1F4C1} <b>${escapeHtml(projectId)}</b>`);
    const token = getGitHubToken(env, project);

    // --- Who went offline today (sessions that ended today) ---
    try {
      const offlineUsers = await env.DB.prepare(
        `SELECT DISTINCT user_id FROM sessions
         WHERE date(ended_at) = ?
         ORDER BY user_id`
      ).bind(todayStr).all<{ user_id: string }>();

      if (offlineUsers.results && offlineUsers.results.length > 0) {
        const offlineNames = offlineUsers.results.map((u) => {
          const color = getUserColorByName(members, u.user_id);
          return `${color} ${escapeHtml(u.user_id)}`;
        });
        lines.push(`  \u{1F534} Wrapped up: ${offlineNames.join(", ")}`);
      }
    } catch (e) {
      console.error(`[EveningGroup] Offline users query failed for ${projectId}:`, e);
    }

    // --- Today's completed work (closed issues) ---
    try {
      const closedEvents = await env.DB.prepare(
        `SELECT actor, target, metadata FROM events
         WHERE repo = ? AND event_type = 'issues.closed'
         AND date(created_at) = date('now')
         ORDER BY created_at DESC LIMIT 30`
      ).bind(project.githubRepo)
        .all<{ actor: string; target: string; metadata: string | null }>();

      if (closedEvents.results && closedEvents.results.length > 0) {
        lines.push("");
        lines.push(`  \u{2705} <b>Completed today:</b>`);
        for (const ev of closedEvents.results) {
          const color = getUserColorByName(members, ev.actor);
          const issueNum = ev.target ? `#${escapeHtml(ev.target)}` : "";
          let title = "";
          if (ev.metadata) {
            try {
              const meta = JSON.parse(ev.metadata);
              if (meta.title) title = ` ${escapeHtml(String(meta.title))}`;
            } catch { /* best-effort */ }
          }
          lines.push(`    ${color} ${issueNum}${title} (${escapeHtml(ev.actor)})`);
        }
      }
    } catch (e) {
      console.error(`[EveningGroup] Completed work query failed for ${projectId}:`, e);
    }

    // --- Still open: assigned issues ---
    if (token) {
      try {
        const openRes = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/issues?state=open&per_page=50`,
          { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
        );
        if (openRes.ok) {
          const issues = await openRes.json() as Array<{
            number: number; title: string; pull_request?: unknown;
            assignee?: { login: string } | null;
          }>;
          const realIssues = issues.filter((i) => !i.pull_request && i.assignee);
          if (realIssues.length > 0) {
            lines.push("");
            lines.push(`  \u{1F4CB} <b>Still open:</b>`);
            for (const issue of realIssues.slice(0, 10)) {
              const color = getUserColorByName(members, issue.assignee!.login);
              lines.push(`    ${color} #${issue.number} ${escapeHtml(issue.title)} (@${escapeHtml(issue.assignee!.login)})`);
            }
            if (realIssues.length > 10) {
              lines.push(`    <i>...and ${realIssues.length - 10} more</i>`);
            }
          }
        }
      } catch (e) {
        console.error(`[EveningGroup] Open issues fetch failed for ${projectId}:`, e);
      }
    }

    // --- Preview links waiting for review ---
    if (token) {
      try {
        const prRes = await fetch(
          `https://api.github.com/repos/${project.githubRepo}/pulls?state=open&per_page=50`,
          { headers: { "User-Agent": "CortexBot", Authorization: `Bearer ${token}` } }
        );
        if (prRes.ok) {
          const prs = await prRes.json() as Array<{
            number: number; title: string; user: { login: string };
            requested_reviewers: Array<{ login: string }>;
          }>;
          const needsReview = prs.filter((pr) => pr.requested_reviewers.length > 0);
          if (needsReview.length > 0) {
            lines.push("");
            lines.push(`  \u{1F50D} <b>Preview links waiting for review:</b>`);
            for (const pr of needsReview) {
              const previewUrl = await getPreviewUrl(env.PROJECTS, projectId, pr.number);
              const previewStr = previewUrl ? ` \u{2014} <a href="${escapeHtml(previewUrl)}">Preview</a>` : "";
              const reviewers = pr.requested_reviewers.map((r) => `@${escapeHtml(r.login)}`).join(", ");
              lines.push(`    \u{2022} #${pr.number} ${escapeHtml(pr.title)} \u{2192} ${reviewers}${previewStr}`);
            }
          }
        }
      } catch (e) {
        console.error(`[EveningGroup] PR review fetch failed for ${projectId}:`, e);
      }
    }

    lines.push("");
  }

  // --- Today's team performance ---
  try {
    const stats = await getTodayStats(env.DB);
    const workHours = await getWorkHoursToday(env.DB);

    lines.push("\u{1F4CA} <b>Today's Team Performance:</b>");
    lines.push(`  \u{1F4DD} Issues: ${stats.issues_opened} opened, ${stats.issues_closed} closed`);
    lines.push(`  \u{1F500} PRs: ${stats.prs_merged} merged, ${stats.prs_open} opened`);
    lines.push(`  \u{1F4C8} Total events: ${stats.total_events}`);

    if (workHours.length > 0) {
      lines.push("");
      lines.push("  <b>Work Hours:</b>");
      for (const w of workHours) {
        const color = getUserColorByName(members, w.user_id);
        lines.push(`  ${color} ${escapeHtml(w.user_id)}: ${formatDuration(w.total_minutes)}`);
      }
    }
  } catch (e) {
    console.error("[EveningGroup] Today stats failed:", e);
  }

  // --- Learnings placeholder (for future Issue #64 integration) ---
  lines.push("");
  lines.push("\u{1F4DA} <i>Team learnings: coming soon (Issue #64)</i>");

  await sendToLoginChannel(env, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Evening digest — orchestrator (calls group + private DMs)
// ---------------------------------------------------------------------------

/**
 * Send evening notifications: group summary + private DMs to all registered members.
 * Called from the cron scheduler at 16:00 UTC (replacing the old simple sendEveningSummary).
 * Also callable from session end hooks for individual DMs.
 */
async function sendEveningDigest(env: Env): Promise<void> {
  // 1. Send the group evening message
  try {
    await sendGroupEveningMessage(env);
  } catch (e) {
    console.error("[EveningDigest] Group message failed:", e);
  }

  // 2. Send private evening DMs to all registered members (with dedup)
  try {
    const projects = await getProjectList(env);
    const members = await getTeamMembers(env.PROJECTS);

    for (const member of members) {
      try {
        await sendPrivateEveningDM(env, member, projects, members);
      } catch (e) {
        console.error(`[EveningDigest] DM failed for ${member.name}:`, e);
      }
    }
  } catch (e) {
    console.error("[EveningDigest] Private DMs failed:", e);
  }
}
