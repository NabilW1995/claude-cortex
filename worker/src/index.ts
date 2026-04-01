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

import { Bot, webhookCallback, InlineKeyboard, Keyboard } from "grammy";
import type { Context } from "grammy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  PROJECTS: KVNamespace;
  DB: D1Database;
}

interface ProjectConfig {
  botToken: string;
  chatId: string;
  threadId?: number;
  loginThreadId?: number | null;
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
  githubRepo: string;
  githubToken?: string;
  members: Array<{ name: string; github: string; telegram: string }>;
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
      .text("\u{1F4CA} Dashboard").text("\u{1F465} Active")
      .row()
      .text("\u{1F4CB} Tasks").text("\u{2753} Who")
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
    const githubUsername = ctx.match as string;

    if (!githubUsername) {
      await sendTelegram(
        project.botToken,
        project.chatId,
        "Nutzung: /register <github-username>",
        project.threadId
      );
      return;
    }

    const from = ctx.from;
    if (!from || !from.id) {
      await sendTelegram(
        project.botToken,
        project.chatId,
        "Fehler: Telegram-User konnte nicht erkannt werden.",
        project.threadId
      );
      return;
    }

    const member: TeamMember = {
      telegram_id: from.id,
      telegram_username: from.username || from.first_name || "unknown",
      github: githubUsername.replace(/^@/, ""),
      name: from.first_name || from.username || "unknown",
    };

    await upsertTeamMember(env.PROJECTS, member);

    await sendTelegram(
      project.botToken,
      project.chatId,
      `Registriert: @${member.telegram_username} = ${member.github}`,
      project.threadId
    );
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
  // Reply keyboard button handlers (plain text messages)
  // -------------------------------------------------------------------

  bot.hears("\u{1F4CA} Dashboard", async () => {
    await sendOrEditDashboard(env, projectId, project);
  });

  bot.hears("\u{1F465} Active", async () => {
    await sendActiveInfo(env, project, projectId);
  });

  bot.hears("\u{1F4CB} Tasks", async () => {
    await handleTasksCommand(env, project, projectId);
  });

  bot.hears("\u{2753} Who", async () => {
    await handleWerCommand(env, project, projectId);
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

async function handleGitHub(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const project = await getProject(env.PROJECTS, projectId);
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  const event = request.headers.get("X-GitHub-Event");
  if (event !== "issues") {
    // We only handle issue events — acknowledge others silently
    return new Response("OK");
  }

  let payload: GitHubIssuesPayload;
  try {
    payload = (await request.json()) as GitHubIssuesPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { action, issue, sender } = payload;
  let message: string | null = null;
  let eventType: string | null = null;

  switch (action) {
    case "opened":
      message = `\u{1F4DD} New Issue #${issue.number}: "${issue.title}" by ${sender.login}\n\u{1F517} ${issue.html_url}`;
      eventType = "issues.opened";
      break;

    case "closed":
      message = `\u{2705} Issue #${issue.number} closed: "${issue.title}" by ${sender.login}`;
      eventType = "issues.closed";
      break;

    case "assigned":
      if (issue.assignee) {
        message = `\u{1F464} Issue #${issue.number} assigned to ${issue.assignee.login}`;
        eventType = "issues.assigned";
      }
      break;

    default:
      break;
  }

  if (message) {
    await sendTelegram(project.botToken, project.chatId, message, project.threadId);
  }

  // Log event to D1 for reports
  if (eventType) {
    await logEvent(env.DB, project.githubRepo, eventType, sender.login, String(issue.number));
  }

  return new Response("OK");
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
