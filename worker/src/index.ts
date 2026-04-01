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
  type: "start" | "end";
  user: string;
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
  projectId: string
): Promise<ProjectConfig | null> {
  const raw = await kv.get(projectId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProjectConfig;
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

  // -------------------------------------------------------------------
  // Callback query handlers (inline button presses on the dashboard)
  // -------------------------------------------------------------------

  bot.callbackQuery("refresh", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await sendOrEditDashboard(env, projectId, project);
  });

  bot.callbackQuery("active", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await sendActiveInfo(env, project, projectId);
  });

  bot.callbackQuery("claim", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const fromUser = ctx.from?.first_name || "Unknown";
    await sendTelegram(
      project.botToken,
      project.chatId,
      `${fromUser}: To claim tasks, use /grab #1 #2 #3`,
      project.threadId
    );
  });

  bot.callbackQuery("done", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F4CA} Daily summary coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_hours", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{23F1} Work hours tracking coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_tasks", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F4CB} Aggregated task view coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_blockers", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    const chatId = project.loginChatId || project.chatId;
    await sendTelegram(
      project.botToken,
      chatId,
      "\u{1F525} Blocker detection coming soon.",
      project.loginThreadId ?? undefined
    );
  });

  bot.callbackQuery("login_prs", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
    const text = await handleProjectBoard(project, projectId);
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.callbackQuery("project_mytasks", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
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
    await ctx.answerCallbackQuery();
    const text = await handleProjectPRs(project, projectId);
    await sendTelegram(project.botToken, project.chatId, text, project.threadId);
  });

  bot.callbackQuery("project_reviews", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await sendTelegram(
      project.botToken,
      project.chatId,
      "\u{1F440} Review queue coming soon.",
      project.threadId
    );
  });

  bot.callbackQuery("project_urgent", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await sendTelegram(
      project.botToken,
      project.chatId,
      "\u{1F525} Priority filter coming soon.",
      project.threadId
    );
  });

  bot.callbackQuery("project_milestone", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await sendTelegram(
      project.botToken,
      project.chatId,
      "\u{1F3AF} Milestone tracking coming soon.",
      project.threadId
    );
  });

  bot.callbackQuery("project_weekly", async (ctx: Context) => {
    await ctx.answerCallbackQuery();
    await sendTelegram(
      project.botToken,
      project.chatId,
      "\u{1F4C8} Weekly report coming soon.",
      project.threadId
    );
  });

  // -------------------------------------------------------------------
  // New group member detection — auto-greet and prompt for registration
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
    await sendTelegram(project.botToken, project.chatId,
      "\u{1F440} Review queue coming soon.\n\nUse /tasks to see open issues for now.", project.threadId);
  });

  bot.hears("\u{1F525} Urgent", async () => {
    await sendTelegram(project.botToken, project.chatId,
      "\u{1F525} Priority filter coming soon.\n\nUse /tasks to see all open issues for now.", project.threadId);
  });

  bot.hears("\u{1F4C8} Report", async () => {
    await sendTelegram(project.botToken, project.chatId,
      "\u{1F4C8} Weekly report coming soon.\n\nComing in Phase 4.", project.threadId);
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

    if (tasks.length > 0) {
      lines.push(
        `   \u{1F4CB} Working on: ${tasks.map((t) => "#" + t).join(", ")}`
      );
    }

    // Show GitHub link if available
    const member = members.find(
      (m) => m.name === s.user || m.github === s.user
    );
    if (member) {
      lines.push(`   \u{1F517} GitHub: ${member.github}`);
    }
  }

  await sendTelegram(
    project.botToken,
    project.chatId,
    lines.join("\n"),
    project.threadId
  );
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

    case "assigned":
      if (issue.assignee) {
        message = `\u{1F464} Issue #${issue.number} assigned to @${issue.assignee.login}`;
        eventType = "issues.assigned";
      }
      break;

    case "labeled": {
      // Only notify for high-signal labels — ignore the rest to reduce noise
      const labelName = payload.label?.name?.toLowerCase() || "";
      const importantLabels = ["urgent", "blocked"];
      if (importantLabels.includes(labelName)) {
        message = `\u{1F3F7} Issue #${issue.number} labeled: ${payload.label!.name}`;
        eventType = "issues.labeled";
      } else {
        // Still log to D1 for reports, but don't send a Telegram message
        eventType = "issues.labeled";
      }
      break;
    }

    default:
      break;
  }

  if (message) {
    await sendTelegram(project.botToken, project.chatId, message, project.threadId);
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
  _projectId: string
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
        `\u{1F500} New PR #${pr.number}: "${pr.title}" by @${sender.login}\n` +
        `\u{1F4CA} ${pr.changed_files} files | +${pr.additions}/-${pr.deletions} | ${pr.head.ref} \u{2192} ${pr.base.ref}\n` +
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
          `\u{1F389} PR #${pr.number} merged! "${pr.title}" \u{2192} ${pr.base.ref}\n` +
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
    await sendTelegram(project.botToken, project.chatId, message, project.threadId);
  }

  // Log ALL events to D1 for reports (even filtered/draft ones)
  if (eventType) {
    await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(pr.number));
  }

  return new Response("OK");
}

/**
 * Handle GitHub "pull_request_review" events.
 * Sends Telegram notifications for approved and changes_requested reviews.
 * Plain "commented" reviews are ignored to reduce noise.
 */
async function handleGitHubReview(
  rawBody: string,
  project: ProjectConfig,
  env: Env,
  _projectId: string
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
        message = `\u{2705} @${review.user.login} approved PR #${pr.number}`;
        eventType = "review.approved";
        break;

      case "changes_requested":
        message = `\u{274C} @${review.user.login} requested changes on PR #${pr.number}`;
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
    await sendTelegram(project.botToken, project.chatId, message, project.threadId);
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
    const message =
      `\u{1F680} ${commits.length} new commit${commits.length === 1 ? "" : "s"} on ${branch} by @${pusher.name}`;
    await sendTelegram(project.botToken, project.chatId, message, project.threadId);
  }

  // Log ALL push events to D1 (even non-main branches) for reports
  await logEvent(env.DB, project.githubRepo, eventType, pusher.name, branch, {
    commit_count: commits.length,
  });

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
  const project = await getProject(env.PROJECTS, projectId);
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
  const project = await getProject(env.PROJECTS, projectId);
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
    // Remove old entry if exists, then add fresh (refreshes time + TTL)
    const filtered = sessions.filter((s) => s.user !== update.user);
    filtered.push({
      user: update.user,
      since: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }),
    });
    await setActiveSessions(env.PROJECTS, projectId, filtered);
    // Log session start to D1 for work hours tracking
    await logSessionStart(env.DB, update.user, projectId);
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
        return handleRegister(request, env);

      case "register-member":
        return handleRegisterMember(request, env);

      case "telegram": {
        // grammy handles the Telegram webhook — create a bot per project
        const project = await getProject(env.PROJECTS, route.projectId!);
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
        return handleGitHub(request, env, route.projectId!);

      case "session":
        return handleSession(request, env, route.projectId!);

      case "dashboard": {
        const dashProject = await getProject(env.PROJECTS, route.projectId!);
        if (!dashProject) {
          return new Response("Project not found", { status: 404 });
        }
        await sendOrEditDashboard(env, route.projectId!, dashProject);
        return Response.json({ ok: true });
      }

      case "get-sessions": {
        const sessions = await getActiveSessions(env.PROJECTS, route.projectId!);
        return Response.json({ sessions });
      }

      default:
        return new Response("Not Found", { status: 404 });
    }
  },
};
