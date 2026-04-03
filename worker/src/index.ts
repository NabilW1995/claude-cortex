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
): Promise<Map<string, Array<{ number: number; title: string; html_url: string }>>> {
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

  const grouped = new Map<string, Array<{ number: number; title: string; html_url: string }>>();

  for (const issue of realIssues) {
    for (const label of issue.labels) {
      if (label.name.startsWith(prefix)) {
        const existing = grouped.get(label.name) || [];
        existing.push({ number: issue.number, title: issue.title, html_url: issue.html_url });
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
    pull_request?: unknown;
  }>;

  // Filter out pull requests (GitHub API returns PRs as issues too)
  const realIssues = issues.filter((i) => !i.pull_request);

  if (realIssues.length === 0) {
    return `\u{1F4CB} <b>${projectId}</b> \u{2014} Board\n\u{2501}`.repeat(0) +
      `\u{1F4CB} <b>${projectId}</b> \u{2014} Board\n\u{2501}${"\u{2501}".repeat(15)}\n\nNo open issues.`;
  }

  const assigned = realIssues.filter((i) => i.assignee);
  const unassigned = realIssues.filter((i) => !i.assignee);

  const lines: string[] = [
    `\u{1F4CB} <b>${projectId}</b> \u{2014} Board`,
    "\u{2501}".repeat(16),
  ];

  if (unassigned.length > 0) {
    lines.push(`\nOpen (${unassigned.length}):`);
    for (const issue of unassigned.slice(0, 15)) {
      lines.push(`\u{2022} #${issue.number} ${issue.title} [open]`);
    }
    if (unassigned.length > 15) {
      lines.push(`  ... and ${unassigned.length - 15} more`);
    }
  }

  if (assigned.length > 0) {
    lines.push(`\nIn Progress (${assigned.length}):`);
    for (const issue of assigned.slice(0, 15)) {
      lines.push(
        `\u{2022} #${issue.number} ${issue.title} [${issue.assignee!.login}]`
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
    pull_request?: unknown;
  }>;

  // Filter out pull requests
  const myIssues = issues.filter((i) => !i.pull_request);

  const lines: string[] = [
    `\u{1F4CC} <b>Your Tasks, ${callerFirstName}</b>`,
    "\u{2501}".repeat(16),
  ];

  if (myIssues.length === 0) {
    lines.push("\nNo tasks assigned to you.");
    lines.push("Use /grab #1 #2 to claim some!");
  } else {
    lines.push(`\nAssigned to you (${myIssues.length}):`);
    for (const issue of myIssues) {
      lines.push(`\u{2022} #${issue.number} ${issue.title}`);
    }
  }

  return lines.join("\n");
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

  if (categories.size === 0) {
    await ctx.editMessageText(
      "\u{1F4C2} No categories found.\n\nAdd labels with the <code>area:</code> prefix to your GitHub issues to create categories.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Build category picker buttons
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  const sortedCategories = [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Mark already-claimed categories
  const row: Array<{ text: string; callback_data: string }> = [];
  for (const [label, issues] of sortedCategories) {
    const displayName = label.replace("area:", "");
    const claimer = claimsState.claims.find((c) => c.category === label);
    const claimerText = claimer ? ` \u{1F512}${claimer.telegramName}` : "";

    row.push({
      text: `${displayName} (${issues.length})${claimerText}`,
      callback_data: claimer ? "cat_cancel" : `cat_pick:${label}`,
    });

    // Two buttons per row
    if (row.length === 2) {
      buttons.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) buttons.push([...row]);

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

  // Fetch issues for this category
  const categories = await fetchOpenIssuesByCategory(project);
  const issues = categories.get(label) || [];

  if (issues.length === 0) {
    await ctx.editMessageText(
      `\u{1F4C2} No open issues with label <code>${escapeHtml(label)}</code>.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const displayName = label.replace("area:", "");
  const issueList = issues
    .slice(0, 10)
    .map((i) => `\u{2022} #${i.number} ${escapeHtml(i.title)}`)
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

  // Update the message in the group
  const successText =
    `\u{2705} <b>${safeDisplayName}</b> \u{2192} ${safeFirstName}\n\n` +
    `${result.success.length} issues assigned` +
    (result.failed.length > 0 ? `, ${result.failed.length} failed` : "") +
    ".";

  await ctx.editMessageText(successText, { parse_mode: "HTML" });

  // Send DM with full task list + links
  const prefs = await getUserPreferences(env.PROJECTS, telegramId);
  if (prefs.dm_chat_id) {
    const dmIssueList = issues
      .filter((i) => result.success.includes(i.number))
      .map((i) => `\u{2022} <a href="${i.html_url}">#${i.number} ${escapeHtml(i.title)}</a>`)
      .join("\n");

    const dmStatus = await sendDM(
      project.botToken,
      prefs.dm_chat_id,
      `\u{1F4C2} <b>Category Assigned: ${safeDisplayName}</b>\n\n` +
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

  // /start, /menu — activate the reply keyboard with quick actions
  bot.command(["start", "menu"], async (ctx: Context) => {
    const keyboard = new Keyboard()
      .text("\u{1F4CA} Dashboard").text("\u{1F465} Active").text("\u{1F4CC} My Tasks")
      .row()
      .text("\u{1F4CB} Board").text("\u{1F500} PRs").text("\u{1F440} Review")
      .row()
      .text("\u{1F525} Urgent").text("\u{1F4C8} Report")
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
  // Reply keyboard button handlers (plain text messages)
  // -------------------------------------------------------------------

  bot.hears("\u{1F4CA} Dashboard", async () => {
    await sendOrEditDashboard(env, projectId, project);
  });

  bot.hears("\u{1F465} Active", async () => {
    await sendActiveInfo(env, project, projectId);
  });

  bot.hears("\u{1F4CC} My Tasks", async (ctx) => {
    const text = await handleProjectMyTasks(project, env, ctx.from?.id || 0, ctx.from?.first_name || "Unknown");
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.hears("\u{1F4CB} Board", async () => {
    const text = await handleProjectBoard(project, projectId);
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.hears("\u{1F500} PRs", async () => {
    const text = await handleProjectPRs(project, projectId);
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.hears("\u{1F440} Review", async () => {
    // Same logic as project_reviews callback
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
          lines.push(`\u{2022} #${pr.number} ${pr.title} (@${pr.user.login}, ${age}h)`);
        }
      }
      if (pendingReview.length > 0) { lines.push(""); lines.push("\u{23F3} <b>Waiting for review:</b>");
        for (const pr of pendingReview) { lines.push(`\u{2022} #${pr.number} ${pr.title} \u{2192} ${pr.requested_reviewers.map(r => r.login).join(", ")}`); }
      }
      if (needsReview.length === 0 && pendingReview.length === 0) lines.push("\u{2705} All PRs reviewed!");
      const body: Record<string, unknown> = { chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true };
      if (project.threadId) body.message_thread_id = project.threadId;
      await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    } catch { await sendTelegram(project.botToken, project.chatId, "\u{1F440} Could not load review queue.", project.threadId); }
  });

  bot.hears("\u{1F525} Urgent", async () => {
    // Same logic as project_urgent callback
    const githubToken = getGitHubToken(env, project);
    if (!githubToken) { await sendTelegram(project.botToken, project.chatId, "\u{1F525} No GitHub token.", project.threadId); return; }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/issues?state=open&labels=urgent,blocked,critical&per_page=20`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + githubToken } }
      );
      if (!res.ok) throw new Error("API");
      const issues = await res.json() as Array<{ number: number; title: string; html_url: string; labels: Array<{ name: string }>; assignee: { login: string } | null }>;
      const lines: string[] = ["\u{1F525} <b>Urgent & Blocked</b>", ""];
      if (issues.length === 0) { lines.push("\u{2705} No urgent or blocked issues!"); }
      else { for (const issue of issues) { const labels = issue.labels.map(l => l.name).join(", "); const assignee = issue.assignee ? issue.assignee.login : "unassigned"; lines.push(`\u{2022} #${issue.number} ${issue.title} [${labels}] \u{2192} ${assignee}`); } }
      const body: Record<string, unknown> = { chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true };
      if (project.threadId) body.message_thread_id = project.threadId;
      await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    } catch { await sendTelegram(project.botToken, project.chatId, "\u{1F525} Could not load urgent issues.", project.threadId); }
  });

  bot.hears("\u{1F4C8} Report", async () => {
    // Same logic as project_weekly callback
    const githubToken = getGitHubToken(env, project);
    const lines: string[] = ["\u{1F4C8} <b>Weekly Report</b>", ""];
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
    if (githubToken) {
      try {
        const res = await fetch(`https://api.github.com/repos/${project.githubRepo}/pulls?state=closed&sort=updated&direction=desc&per_page=10`,
          { headers: { "User-Agent": "CortexBot", Authorization: "token " + githubToken } });
        if (res.ok) {
          const prs = await res.json() as Array<{ number: number; title: string; merged_at: string | null; user: { login: string } }>;
          const merged = prs.filter(pr => pr.merged_at);
          if (merged.length > 0) { lines.push("<b>Merged PRs:</b>"); for (const pr of merged.slice(0, 5)) lines.push(`\u{2022} #${pr.number} ${pr.title} (@${pr.user.login})`); }
        }
      } catch {}
    }
    try {
      const hours = await getWorkHoursToday(env.DB);
      if (hours.length > 0) { lines.push(""); lines.push("<b>Work Hours (today):</b>");
        const members = await getTeamMembers(env.PROJECTS);
        for (const w of hours) { const color = getUserColorByName(members, w.user_id); const h = Math.floor(w.total_minutes / 60); const m = w.total_minutes % 60; lines.push(`${color} ${w.user_id}: ${h}h ${m}m`); }
      }
    } catch {}
    const body: Record<string, unknown> = { chat_id: project.chatId, text: lines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true };
    if (project.threadId) body.message_thread_id = project.threadId;
    await fetch(`https://api.telegram.org/bot${project.botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
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

    case "closed":
      message = `\u{2705} Issue #${issue.number} closed by @${sender.login}`;
      eventType = "issues.closed";
      break;

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

  return null;
}

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

    // Mon-Fri 16:00 UTC (18:00 CEST): evening summary
    if (hour === 16 && minute === 0 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      await sendEveningSummary(env);
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

async function sendMorningDigest(env: Env): Promise<void> {
  const projects = await getProjectList(env);
  const members = await getTeamMembers(env.PROJECTS);
  const lines: string[] = ["\u{2600}\u{FE0F} <b>Morning Digest</b>", "\u{2500}".repeat(25), ""];

  // Who is online
  let anyOnline = false;
  for (const { id, config: _ } of projects) {
    const sessions = await getActiveSessions(env.PROJECTS, id);
    for (const s of sessions) {
      anyOnline = true;
      const color = getUserColorByName(members, s.user);
      lines.push(`${color} ${s.user} \u{2014} ${id} (since ${s.since})`);
    }
  }
  if (!anyOnline) lines.push("Nobody online yet.");

  // Open tasks per project
  lines.push("");
  lines.push("<b>Open Tasks:</b>");
  for (const { id, config: project } of projects) {
    if (!project.githubToken) continue;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/issues?state=open&per_page=100`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + project.githubToken } }
      );
      if (res.ok) {
        const issues = await res.json() as Array<{ number: number }>;
        lines.push(`\u{2022} ${id}: ${issues.length} open`);
      }
    } catch {}
  }

  // Open PRs
  lines.push("");
  lines.push("<b>Open PRs:</b>");
  let anyPR = false;
  for (const { id, config: project } of projects) {
    if (!project.githubToken) continue;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${project.githubRepo}/pulls?state=open`,
        { headers: { "User-Agent": "CortexBot", Authorization: "token " + project.githubToken } }
      );
      if (res.ok) {
        const prs = await res.json() as Array<{ number: number; title: string; user: { login: string } }>;
        for (const pr of prs) {
          anyPR = true;
          lines.push(`\u{2022} ${id} #${pr.number}: ${pr.title} (@${pr.user.login})`);
        }
      }
    } catch {}
  }
  if (!anyPR) lines.push("No open PRs.");

  await sendToLoginChannel(env, lines.join("\n"));
}

async function sendEveningSummary(env: Env): Promise<void> {
  const stats = await getTodayStats(env.DB);
  const workHours = await getWorkHoursToday(env.DB);
  const members = await getTeamMembers(env.PROJECTS);

  const lines: string[] = ["\u{1F319} <b>Evening Summary</b>", "\u{2500}".repeat(25), ""];
  lines.push(`\u{1F4DD} Issues: ${stats.issues_opened} opened, ${stats.issues_closed} closed`);
  lines.push(`\u{1F500} PRs: ${stats.prs_merged} merged, ${stats.prs_open} opened`);
  lines.push(`\u{1F4CA} Total events: ${stats.total_events}`);

  if (workHours.length > 0) {
    lines.push("");
    lines.push("<b>Work Hours:</b>");
    for (const w of workHours) {
      const color = getUserColorByName(members, w.user_id);
      const hours = Math.floor(w.total_minutes / 60);
      const mins = w.total_minutes % 60;
      lines.push(`${color} ${w.user_id}: ${hours}h ${mins}m`);
    }
  }

  await sendToLoginChannel(env, lines.join("\n"));
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

  await sendToLoginChannel(env, lines.join("\n"));
}
