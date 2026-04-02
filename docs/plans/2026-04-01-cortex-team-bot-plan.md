# Cortex Team Bot — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Telegram-Bot der bei Session-Start/Ende automatisch offene Tasks und Status ins richtige Projekt-Topic postet, plus Telegram-Befehle via Cloudflare Worker.

**Architecture:** Phase 1 baut die lokale Integration (notify.js + Hook-Erweiterungen) — der Bot postet direkt via Telegram API. Phase 2 baut den zentralen Cloudflare Worker fuer Telegram-Befehle und GitHub-Webhooks. Phase 1 funktioniert sofort ohne Worker.

**Tech Stack:** Node.js, Telegram Bot API, Cloudflare Workers (TypeScript), GitHub REST API, Cloudflare KV

**Getestete Telegram-Config:**
- Bot: @ClaudeCortexBot
- Chat-ID: -1003891712197
- Topic "Team Template": message_thread_id = 9

---

## Phase 1: Lokale Bot-Integration (funktioniert sofort)

### Task 1: Notify-Modul erstellen

**Files:**
- Create: `scripts/bot/notify.js`

**Step 1: Erstelle `scripts/bot/` Verzeichnis und `notify.js`**

```javascript
#!/usr/bin/env node
const https = require('https');
const path = require('path');
const fs = require('fs');

/**
 * Sends a message to a Telegram chat/topic.
 * Reads config from .env in the project directory.
 */
function loadBotConfig(projectDir) {
  const envPath = path.join(projectDir, '.env');
  if (!fs.existsSync(envPath)) return null;

  const env = fs.readFileSync(envPath, 'utf-8');
  const get = (key) => {
    const match = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  };

  const token = get('TELEGRAM_BOT_TOKEN');
  const chatId = get('TELEGRAM_CHAT_ID');
  const threadId = get('TELEGRAM_THREAD_ID');

  if (!token || !chatId) return null;
  return { token, chatId, threadId: threadId ? parseInt(threadId) : null };
}

function loadTeamConfig(projectDir) {
  const teamPath = path.join(projectDir, 'team.json');
  if (!fs.existsSync(teamPath)) return { members: [] };
  return JSON.parse(fs.readFileSync(teamPath, 'utf-8'));
}

function getCurrentUser() {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf-8' }).trim();
  } catch {
    return process.env.USER || process.env.USERNAME || 'Unknown';
  }
}

function sendTelegram(token, chatId, text, threadId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text: text,
      ...(threadId ? { message_thread_id: threadId } : {}),
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (parsed.ok) resolve(parsed.result);
        else reject(new Error(parsed.description));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function notifySessionStart(projectDir) {
  const config = loadBotConfig(projectDir);
  if (!config) return;

  const projectName = path.basename(projectDir);
  const user = getCurrentUser();

  // Fetch open GitHub issues if gh is available
  let tasks = '';
  try {
    const { execSync } = require('child_process');
    const issues = execSync(
      'gh issue list --state open --limit 10 --json number,title,assignees 2>/dev/null',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const parsed = JSON.parse(issues);
    if (parsed.length > 0) {
      tasks = '\n\nOffene Tasks (' + parsed.length + '):\n' +
        parsed.map(i => {
          const assignee = i.assignees && i.assignees.length > 0
            ? '[' + i.assignees[0].login + ']'
            : '[offen]';
          return '- #' + i.number + ' ' + i.title + ' ' + assignee;
        }).join('\n');
    } else {
      tasks = '\n\nKeine offenen Tasks.';
    }
  } catch {
    tasks = '\n\n(GitHub Issues konnten nicht geladen werden)';
  }

  const message = user + ' ist online -- arbeitet an ' + projectName + tasks;

  try {
    await sendTelegram(config.token, config.chatId, message, config.threadId);
  } catch (e) {
    console.error('[Bot] Telegram-Nachricht fehlgeschlagen: ' + e.message);
  }
}

async function notifySessionEnd(projectDir, stats) {
  const config = loadBotConfig(projectDir);
  if (!config) return;

  const projectName = path.basename(projectDir);
  const user = getCurrentUser();

  let message = user + ' hat die Session beendet (' + projectName + ')';
  if (stats && stats.prompts_count) {
    message += '\n- Prompts: ' + stats.prompts_count;
    if (stats.corrections_count > 0) {
      message += '\n- Korrekturen: ' + stats.corrections_count;
    }
  }

  // Check what was done via git
  try {
    const { execSync } = require('child_process');
    const diff = execSync(
      'git log --oneline -5 --since="8 hours ago" 2>/dev/null',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (diff) {
      message += '\n\nLetzte Commits:\n' + diff;
    }
  } catch {}

  try {
    await sendTelegram(config.token, config.chatId, message, config.threadId);
  } catch (e) {
    console.error('[Bot] Telegram-Nachricht fehlgeschlagen: ' + e.message);
  }
}

// Export for use in hooks
module.exports = { sendTelegram, loadBotConfig, loadTeamConfig, getCurrentUser, notifySessionStart, notifySessionEnd };

// CLI usage: node notify.js session-start|session-end
if (require.main === module) {
  const action = process.argv[2];
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (action === 'session-start') {
    notifySessionStart(projectDir).catch(e => console.error(e.message));
  } else if (action === 'session-end') {
    notifySessionEnd(projectDir).catch(e => console.error(e.message));
  } else {
    console.error('Usage: node notify.js session-start|session-end');
  }
}
```

**Step 2: Teste manuell**

Run: `node scripts/bot/notify.js session-start`
Expected: Nachricht im "Team Template" Topic in Telegram

**Step 3: Commit**

```bash
git add scripts/bot/notify.js
git commit -m "feat: add Telegram notify module for session updates"
```

---

### Task 2: Config-Dateien erstellen

**Files:**
- Create: `team.json`
- Modify: `.env.example`

**Step 1: Erstelle `team.json` im Projekt-Root**

```json
{
  "members": [
    {
      "name": "Nabil",
      "github": "NabilW1995",
      "telegram": "@nabil_weikaemper",
      "telegram_id": 6696347227
    }
  ]
}
```

**Step 2: Erweitere `.env.example`**

Fuege am Ende hinzu:

```
# Telegram Bot (Cortex Team Bot)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_THREAD_ID=
```

**Step 3: Commit**

```bash
git add team.json .env.example
git commit -m "feat: add team.json and Telegram env vars"
```

---

### Task 3: Session-Start Hook erweitern

**Files:**
- Modify: `scripts/hooks/session-start.js:57` (vor `db.close()`)

**Step 1: Fuege Telegram-Notification in session-start.js ein**

Nach Zeile 57 (`fs.writeFileSync(...)`) und vor `db.close()`, fuege ein:

```javascript
    // Notify Telegram
    try {
      const { notifySessionStart } = require('../bot/notify');
      await notifySessionStart(projectDir);
    } catch (e) {
      // Silent fail — Telegram is optional
    }
```

**Step 2: Teste Session-Start**

Run: `node scripts/hooks/session-start.js`
Expected: Learning-DB Ausgabe + Telegram-Nachricht im "Team Template" Topic

**Step 3: Commit**

```bash
git add scripts/hooks/session-start.js
git commit -m "feat: post open tasks to Telegram on session start"
```

---

### Task 4: Session-End Hook erweitern

**Files:**
- Modify: `scripts/hooks/session-end.js:27` (nach Session-Statistik)

**Step 1: Fuege Telegram-Notification in session-end.js ein**

Nach Zeile 27 (nach dem Statistik-Block), vor `db.close()`, fuege ein:

```javascript
      // Notify Telegram
      try {
        const { notifySessionEnd } = require('../bot/notify');
        const stats = session || {};
        await notifySessionEnd(projectDir, stats);
      } catch (e) {
        // Silent fail — Telegram is optional
      }
```

**Step 2: Teste Session-End**

Run: `node scripts/hooks/session-end.js`
Expected: Session-End Ausgabe + Telegram-Nachricht

**Step 3: Commit**

```bash
git add scripts/hooks/session-end.js
git commit -m "feat: post session summary to Telegram on session end"
```

---

## Phase 2: Cloudflare Worker (Telegram-Befehle + GitHub-Webhooks)

### Task 5: Cloudflare Worker Projekt erstellen

**Files:**
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`
- Create: `worker/src/telegram.ts`
- Create: `worker/src/github.ts`
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`

**Step 1: Erstelle Worker-Verzeichnis und Config**

`worker/wrangler.toml`:
```toml
name = "cortex-team-bot"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "PROJECTS"
id = "TBD_AFTER_KV_CREATION"
```

`worker/package.json`:
```json
{
  "name": "cortex-team-bot-worker",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^3.0.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types"]
  }
}
```

**Step 2: Implementiere Worker Entry Point**

`worker/src/index.ts`:
```typescript
export interface Env {
  PROJECTS: KVNamespace;
}

interface ProjectConfig {
  botToken: string;
  chatId: string;
  threadId?: number;
  githubRepo: string;
  githubToken?: string;
  members: Array<{ name: string; github: string; telegram: string }>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/') {
      return new Response('Cortex Team Bot Worker is running');
    }

    // Telegram webhook: POST /telegram/:projectId
    if (url.pathname.startsWith('/telegram/') && request.method === 'POST') {
      const projectId = url.pathname.split('/')[2];
      return handleTelegram(request, env, projectId);
    }

    // GitHub webhook: POST /github/:projectId
    if (url.pathname.startsWith('/github/') && request.method === 'POST') {
      const projectId = url.pathname.split('/')[2];
      return handleGitHub(request, env, projectId);
    }

    // Session update: POST /session/:projectId
    if (url.pathname.startsWith('/session/') && request.method === 'POST') {
      const projectId = url.pathname.split('/')[2];
      return handleSession(request, env, projectId);
    }

    // Register project: POST /register
    if (url.pathname === '/register' && request.method === 'POST') {
      return handleRegister(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function getProject(env: Env, projectId: string): Promise<ProjectConfig | null> {
  const data = await env.PROJECTS.get(projectId);
  return data ? JSON.parse(data) : null;
}

async function sendTelegram(token: string, chatId: string, text: string, threadId?: number): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (threadId) body.message_thread_id = threadId;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
}

async function handleTelegram(request: Request, env: Env, projectId: string): Promise<Response> {
  const project = await getProject(env, projectId);
  if (!project) return new Response('Project not found', { status: 404 });

  const update = await request.json() as Record<string, any>;
  const message = update.message;
  if (!message || !message.text) return new Response('OK');

  const text = message.text.trim();

  // /tasks — show open GitHub issues
  if (text === '/tasks' || text === '/tasks@ClaudeCortexBot') {
    const issues = await fetchGitHubIssues(project);
    const response = issues.length > 0
      ? 'Offene Tasks (' + issues.length + '):\n' +
        issues.map((i: any) => '- #' + i.number + ' ' + i.title +
          (i.assignees?.length ? ' [' + i.assignees[0].login + ']' : ' [offen]')).join('\n')
      : 'Keine offenen Tasks.';
    await sendTelegram(project.botToken, project.chatId, response, project.threadId);
  }

  // /wer — who is working on what
  if (text === '/wer' || text === '/wer@ClaudeCortexBot') {
    const sessions = await env.PROJECTS.get(projectId + ':sessions');
    const active = sessions ? JSON.parse(sessions) : [];
    const response = active.length > 0
      ? 'Aktive Sessions:\n' + active.map((s: any) => '- ' + s.user + ' (seit ' + s.since + ')').join('\n')
      : 'Niemand arbeitet gerade an diesem Projekt.';
    await sendTelegram(project.botToken, project.chatId, response, project.threadId);
  }

  // /new <title> — create GitHub issue
  if (text.startsWith('/new ') || text.startsWith('/new@ClaudeCortexBot ')) {
    const title = text.replace(/^\/new(@ClaudeCortexBot)?\s+/, '');
    const issue = await createGitHubIssue(project, title);
    if (issue) {
      await sendTelegram(project.botToken, project.chatId,
        'Issue #' + issue.number + ' erstellt: ' + title, project.threadId);
    }
  }

  // /done #N — close issue + notify reviewer
  const doneMatch = text.match(/^\/done(?:@ClaudeCortexBot)?\s+#?(\d+)/);
  if (doneMatch) {
    const issueNumber = parseInt(doneMatch[1]);
    await closeGitHubIssue(project, issueNumber);
    await sendTelegram(project.botToken, project.chatId,
      'Issue #' + issueNumber + ' erledigt! Ready for Review.', project.threadId);
  }

  return new Response('OK');
}

async function handleGitHub(request: Request, env: Env, projectId: string): Promise<Response> {
  const project = await getProject(env, projectId);
  if (!project) return new Response('Project not found', { status: 404 });

  const event = request.headers.get('X-GitHub-Event');
  const payload = await request.json() as Record<string, any>;

  if (event === 'issues') {
    const action = payload.action;
    const issue = payload.issue;
    const actor = payload.sender?.login || 'Jemand';

    if (action === 'opened') {
      await sendTelegram(project.botToken, project.chatId,
        'Neuer Task: #' + issue.number + ' ' + issue.title + ' (von ' + actor + ')', project.threadId);
    } else if (action === 'closed') {
      await sendTelegram(project.botToken, project.chatId,
        'Task erledigt: #' + issue.number + ' ' + issue.title + ' (von ' + actor + ')', project.threadId);
    } else if (action === 'assigned') {
      const assignee = issue.assignee?.login || '?';
      await sendTelegram(project.botToken, project.chatId,
        'Task #' + issue.number + ' zugewiesen an ' + assignee, project.threadId);
    }
  }

  return new Response('OK');
}

async function handleSession(request: Request, env: Env, projectId: string): Promise<Response> {
  const project = await getProject(env, projectId);
  if (!project) return new Response('Project not found', { status: 404 });

  const data = await request.json() as Record<string, any>;

  if (data.type === 'start') {
    // Track active session
    const sessionsData = await env.PROJECTS.get(projectId + ':sessions');
    const sessions = sessionsData ? JSON.parse(sessionsData) : [];
    sessions.push({ user: data.user, since: new Date().toLocaleTimeString('de-DE') });
    await env.PROJECTS.put(projectId + ':sessions', JSON.stringify(sessions));

    await sendTelegram(project.botToken, project.chatId, data.message, project.threadId);
  } else if (data.type === 'end') {
    // Remove active session
    const sessionsData = await env.PROJECTS.get(projectId + ':sessions');
    const sessions = sessionsData ? JSON.parse(sessionsData) : [];
    const updated = sessions.filter((s: any) => s.user !== data.user);
    await env.PROJECTS.put(projectId + ':sessions', JSON.stringify(updated));

    await sendTelegram(project.botToken, project.chatId, data.message, project.threadId);
  }

  return new Response('OK');
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const data = await request.json() as Record<string, any>;
  const projectId = data.projectId;
  if (!projectId) return new Response('Missing projectId', { status: 400 });

  await env.PROJECTS.put(projectId, JSON.stringify({
    botToken: data.botToken,
    chatId: data.chatId,
    threadId: data.threadId,
    githubRepo: data.githubRepo,
    githubToken: data.githubToken,
    members: data.members || [],
  }));

  return Response.json({ ok: true, projectId });
}

async function fetchGitHubIssues(project: ProjectConfig): Promise<any[]> {
  const headers: Record<string, string> = { 'User-Agent': 'CortexBot' };
  if (project.githubToken) headers.Authorization = 'token ' + project.githubToken;

  const res = await fetch(
    'https://api.github.com/repos/' + project.githubRepo + '/issues?state=open&per_page=15',
    { headers }
  );
  return res.ok ? await res.json() as any[] : [];
}

async function createGitHubIssue(project: ProjectConfig, title: string): Promise<any> {
  if (!project.githubToken) return null;
  const res = await fetch(
    'https://api.github.com/repos/' + project.githubRepo + '/issues',
    {
      method: 'POST',
      headers: {
        'User-Agent': 'CortexBot',
        Authorization: 'token ' + project.githubToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title }),
    }
  );
  return res.ok ? await res.json() : null;
}

async function closeGitHubIssue(project: ProjectConfig, number: number): Promise<void> {
  if (!project.githubToken) return;
  await fetch(
    'https://api.github.com/repos/' + project.githubRepo + '/issues/' + number,
    {
      method: 'PATCH',
      headers: {
        'User-Agent': 'CortexBot',
        Authorization: 'token ' + project.githubToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: 'closed' }),
    }
  );
}
```

**Step 3: Commit**

```bash
git add worker/
git commit -m "feat: add Cloudflare Worker for Telegram commands and GitHub webhooks"
```

---

### Task 6: Worker deployen

**Step 1: Cloudflare CLI installieren (falls noetig)**

Run: `npm install -g wrangler`

**Step 2: Cloudflare Login**

Run: `wrangler login`

**Step 3: KV Namespace erstellen**

Run: `cd worker && wrangler kv namespace create PROJECTS`

Kopiere die ausgegebene ID in `wrangler.toml` bei `id = "TBD_AFTER_KV_CREATION"`

**Step 4: Deployen**

Run: `cd worker && npm install && wrangler deploy`

Notiere die Worker-URL (z.B. `https://cortex-team-bot.ACCOUNT.workers.dev`)

**Step 5: Projekt beim Worker registrieren**

```bash
curl -X POST https://cortex-team-bot.ACCOUNT.workers.dev/register \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "team-template",
    "botToken": "BOT_TOKEN_HERE",
    "chatId": "-1003891712197",
    "threadId": 9,
    "githubRepo": "NabilW1995/claude-cortex",
    "members": [{"name":"Nabil","github":"NabilW1995","telegram":"@nabil_weikaemper"}]
  }'
```

**Step 6: Telegram Webhook setzen**

```bash
curl "https://api.telegram.org/botBOT_TOKEN/setWebhook?url=https://cortex-team-bot.ACCOUNT.workers.dev/telegram/team-template"
```

**Step 7: GitHub Webhook einrichten**

```bash
gh webhook create --repo NabilW1995/claude-cortex \
  --events issues \
  --url "https://cortex-team-bot.ACCOUNT.workers.dev/github/team-template"
```

**Step 8: Commit**

```bash
git add worker/wrangler.toml
git commit -m "feat: deploy Cloudflare Worker and configure webhooks"
```

---

### Task 7: Setup-Bot Skill erstellen

**Files:**
- Create: `.claude/skills/setup-bot/SKILL.md`

Dieser Skill automatisiert Tasks 5-6 fuer neue Projekte: fragt nach Bot-Token, erstellt Topic, registriert beim Worker, richtet Webhooks ein.

Details werden nach Phase 1 ausgearbeitet.

---

## Reihenfolge

```
Task 1: notify.js erstellen          ← Kern-Modul
Task 2: team.json + .env.example     ← Config
Task 3: session-start.js erweitern   ← Auto-Post bei Session-Start
Task 4: session-end.js erweitern     ← Auto-Post bei Session-Ende
--- Phase 1 fertig (funktioniert ohne Worker) ---
Task 5: Cloudflare Worker bauen      ← Telegram-Befehle + GitHub-Webhooks
Task 6: Worker deployen              ← Live schalten
Task 7: Setup-Bot Skill              ← Einfache Einrichtung
```
