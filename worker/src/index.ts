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

interface TelegramUpdate {
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

  const text = update.message?.text?.trim();
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
    const message =
      err instanceof Error ? err.message : "Unknown error";
    await sendTelegram(
      project.botToken,
      project.chatId,
      `Error: ${message}`,
      project.threadId
    );
  }

  return new Response("OK");
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
  } else if (update.type === "end") {
    // Remove user from active sessions
    const filtered = sessions.filter((s) => s.user !== update.user);
    await setActiveSessions(env.PROJECTS, projectId, filtered);

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

  // Match /:handler/:projectId patterns
  const match = pathname.match(
    /^\/(telegram|github|session)\/([a-zA-Z0-9_-]+)\/?$/
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

      default:
        return new Response("Not Found", { status: 404 });
    }
  },
};
