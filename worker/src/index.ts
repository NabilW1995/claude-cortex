/**
 * Cortex Team Bot — Cloudflare Worker
 *
 * Central hub connecting Telegram, GitHub, and Claude sessions.
 * Handles bot commands via webhook, GitHub events, and session tracking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  PROJECTS: KVNamespace;
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

interface TelegramUpdate {
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number; first_name?: string; username?: string };
    message?: { chat: { id: number }; message_thread_id?: number };
  };
  message?: {
    text?: string;
    chat: { id: number };
    message_thread_id?: number;
    from?: { id?: number; first_name?: string; username?: string };
  };
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
// Telegram helpers
// ---------------------------------------------------------------------------

/**
 * Send a plain-text message to the project's Telegram chat/topic.
 * Uses plain text (no parse_mode) to avoid encoding issues.
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
  await kv.put(`${projectId}:sessions`, JSON.stringify(sessions));
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
// Route: POST /telegram/:projectId
// ---------------------------------------------------------------------------

/**
 * Strip the @BotName suffix from a command, e.g. "/tasks@ClaudeCortexBot" -> "/tasks"
 */
function stripBotSuffix(command: string): string {
  return command.replace(/@\S+/, "");
}

async function handleTelegram(
  request: Request,
  env: Env,
  projectId: string
): Promise<Response> {
  const project = await getProject(env.PROJECTS, projectId);
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // -----------------------------------------------------------------------
  // Handle callback queries (inline button presses on the dashboard)
  // -----------------------------------------------------------------------
  if (update.callback_query) {
    const cbData = update.callback_query.data;
    const cbId = update.callback_query.id;

    // Answer the callback to remove loading state on the button
    await fetch(
      `https://api.telegram.org/bot${project.botToken}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cbId }),
      }
    );

    if (cbData === "refresh") {
      await sendOrEditDashboard(env, projectId, project);
      return new Response("OK");
    }

    if (cbData === "claim") {
      const fromUser =
        update.callback_query.from?.first_name || "Unknown";
      await sendTelegram(
        project.botToken,
        project.chatId,
        `${fromUser}: To claim tasks, use /grab #1 #2 #3`,
        project.threadId
      );
      return new Response("OK");
    }

    if (cbData === "done") {
      const fromUser =
        update.callback_query.from?.first_name || "Unknown";
      await sendTelegram(
        project.botToken,
        project.chatId,
        `${fromUser}: To mark tasks done, use /done #1`,
        project.threadId
      );
      return new Response("OK");
    }

    return new Response("OK");
  }

  // -----------------------------------------------------------------------
  // Handle text messages / commands
  // -----------------------------------------------------------------------
  const message = update.message;
  const text = message?.text?.trim();
  if (!text) {
    // Not a text message — ignore silently
    return new Response("OK");
  }

  // Parse the command (first word) and arguments (rest)
  const parts = text.split(/\s+/);
  const rawCommand = parts[0].toLowerCase();
  const command = stripBotSuffix(rawCommand);
  const args = parts.slice(1).join(" ");

  try {
    // /dashboard — send or refresh the live dashboard
    if (command === "/dashboard") {
      await sendOrEditDashboard(env, projectId, project);
      return new Response("OK");
    }

    // /grab #1 #2 #3 — claim tasks for yourself
    const grabMatch = text.match(/^\/grab(?:@\w+)?\s+(.+)/);
    if (grabMatch) {
      await handleGrabCommand(env, project, projectId, grabMatch[1], message!);
      return new Response("OK");
    }

    switch (command) {
      case "/tasks":
        await handleTasksCommand(project);
        break;

      case "/wer":
        await handleWerCommand(env, project, projectId);
        break;

      case "/new":
        await handleNewCommand(project, args);
        break;

      case "/assign":
        await handleAssignCommand(project, args);
        break;

      case "/done":
        await handleDoneCommand(project, args);
        break;

      case "/register":
        await handleRegisterCommand(env, project, args, update);
        break;

      default:
        // Unknown command — ignore silently
        break;
    }
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "Unknown error";
    await sendTelegram(
      project.botToken,
      project.chatId,
      `Error: ${errMessage}`,
      project.threadId
    );
  }

  return new Response("OK");
}

/**
 * /grab #1 #2 #3 — Claim GitHub issues for the sender.
 * Updates the dashboard state and optionally assigns on GitHub.
 */
async function handleGrabCommand(
  env: Env,
  project: ProjectConfig,
  projectId: string,
  argsText: string,
  message: NonNullable<TelegramUpdate["message"]>
): Promise<void> {
  const taskNumbers =
    argsText.match(/#?(\d+)/g)?.map((n) => parseInt(n.replace("#", ""), 10)) ||
    [];

  if (taskNumbers.length === 0) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Usage: /grab #1 #2 #3",
      project.threadId
    );
    return;
  }

  const fromUser = message.from?.first_name || "Unknown";
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
}

/**
 * /tasks — List open GitHub issues for the project.
 */
async function handleTasksCommand(project: ProjectConfig): Promise<void> {
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

/**
 * /register <github-username> — Register the sender as a team member.
 * Stores their telegram_id, telegram_username, and github username
 * in the central team-members registry in KV.
 */
async function handleRegisterCommand(
  env: Env,
  project: ProjectConfig,
  githubUsername: string,
  update: TelegramUpdate
): Promise<void> {
  if (!githubUsername) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      "Nutzung: /register <github-username>",
      project.threadId
    );
    return;
  }

  const from = update.message?.from;
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

  switch (action) {
    case "opened":
      message = `Neuer Task: #${issue.number} ${issue.title} (von ${sender.login})`;
      break;

    case "closed":
      message = `Task erledigt: #${issue.number} ${issue.title} (von ${sender.login})`;
      break;

    case "assigned":
      if (issue.assignee) {
        message = `Task #${issue.number} zugewiesen an ${issue.assignee.login}`;
      }
      break;

    default:
      // Other issue actions (edited, labeled, etc.) — ignore
      break;
  }

  if (message) {
    await sendTelegram(
      project.botToken,
      project.chatId,
      message,
      project.threadId
    );
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
    // Add session if user is not already tracked
    const alreadyActive = sessions.some((s) => s.user === update.user);
    if (!alreadyActive) {
      sessions.push({
        user: update.user,
        since: new Date().toISOString(),
      });
      await setActiveSessions(env.PROJECTS, projectId, sessions);
    }

    // Send to Login topic (short message) if configured
    if (project.loginThreadId) {
      await sendTelegram(
        project.botToken,
        project.chatId,
        `${update.user} ist online -- arbeitet an ${projectId}`,
        project.loginThreadId
      );
    }

    // Send to project topic (full message)
    await sendTelegram(
      project.botToken,
      project.chatId,
      `${update.user} hat eine Session gestartet.`,
      project.threadId
    );

    // Refresh the live dashboard to show the new online user
    await sendOrEditDashboard(env, projectId, project);
  } else if (update.type === "end") {
    // Remove user from active sessions
    const filtered = sessions.filter((s) => s.user !== update.user);
    await setActiveSessions(env.PROJECTS, projectId, filtered);

    // Clear the user's tasks from dashboard state
    const dashState = await getDashboardState(env.PROJECTS, projectId);
    dashState.activeSessions = dashState.activeSessions.filter(
      (s) => s.user !== update.user
    );
    await saveDashboardState(env.PROJECTS, projectId, dashState);

    // Send to Login topic (short message) if configured
    if (project.loginThreadId) {
      await sendTelegram(
        project.botToken,
        project.chatId,
        `${update.user} hat die Session beendet (${projectId})`,
        project.loginThreadId
      );
    }

    // Send to project topic (full message)
    await sendTelegram(
      project.botToken,
      project.chatId,
      `${update.user} hat die Session beendet.`,
      project.threadId
    );

    // Refresh the live dashboard to remove the offline user
    await sendOrEditDashboard(env, projectId, project);
  } else {
    return new Response("Invalid session type", { status: 400 });
  }

  return new Response("OK");
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
// Router
// ---------------------------------------------------------------------------

/**
 * Simple path-based router.
 * Matches: GET /, POST /telegram/:id, POST /github/:id,
 *          POST /session/:id, POST /register, POST /register-member
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

  // Match /:handler/:projectId patterns
  const match = pathname.match(
    /^\/(telegram|github|session|dashboard)\/([a-zA-Z0-9_-]+)\/?$/
  );
  if (match && method === "POST") {
    return { handler: match[1], projectId: match[2] };
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

      case "telegram":
        return handleTelegram(request, env, route.projectId!);

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
