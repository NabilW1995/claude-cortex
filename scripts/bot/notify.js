#!/usr/bin/env node
/**
 * Telegram Notify Module for Cortex Team Bot
 *
 * Sends session start/end notifications to a Telegram group/forum.
 * Uses only Node.js built-in modules (no external dependencies).
 * All errors are handled silently — Telegram is optional, never blocks the session.
 *
 * CLI usage:
 *   node notify.js session-start
 *   node notify.js session-end
 *
 * Environment (from .env in project root):
 *   TELEGRAM_BOT_TOKEN  — Bot API token from @BotFather
 *   TELEGRAM_CHAT_ID    — Target chat/group ID
 *   TELEGRAM_THREAD_ID  — (optional) Forum topic thread ID
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config Loading
// ---------------------------------------------------------------------------

/**
 * Parse a .env file into an object of key-value pairs.
 * Handles optional quoting (single/double) and ignores comments/empty lines.
 */
function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const content = fs.readFileSync(filePath, 'utf-8');
  const vars = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

/**
 * Load Telegram bot configuration from the project's .env file.
 * Returns config object or null if token/chatId are missing.
 *
 * Supports two structures:
 *   - Separate groups: TELEGRAM_LOGIN_CHAT_ID (login channel) + TELEGRAM_CHAT_ID (project group)
 *   - Forum topics: TELEGRAM_CHAT_ID + TELEGRAM_THREAD_ID + TELEGRAM_LOGIN_THREAD_ID (legacy)
 */
function loadBotConfig(projectDir) {
  try {
    const envPath = path.join(projectDir, '.env');
    const vars = parseEnvFile(envPath);

    const token = vars.TELEGRAM_BOT_TOKEN || '';
    const chatId = vars.TELEGRAM_CHAT_ID || '';
    const threadId = vars.TELEGRAM_THREAD_ID || '';
    const loginChatId = vars.TELEGRAM_LOGIN_CHAT_ID || '';
    const loginThreadId = vars.TELEGRAM_LOGIN_THREAD_ID || '';
    const workerUrl = vars.CORTEX_WORKER_URL || '';
    const projectId = vars.CORTEX_PROJECT_ID || '';

    // Both token and chatId are required
    if (!token || !chatId) return null;

    return {
      token,
      chatId,
      threadId: threadId || null,
      loginChatId: loginChatId || null,
      loginThreadId: loginThreadId || null,
      workerUrl: workerUrl || null,
      projectId: projectId || null
    };
  } catch {
    return null;
  }
}

/**
 * Load team configuration from team.json in the project root.
 * Returns the parsed object, or { members: [] } if the file is missing or invalid.
 */
function loadTeamConfig(projectDir) {
  try {
    const teamPath = path.join(projectDir, 'team.json');
    if (!fs.existsSync(teamPath)) return { members: [] };

    const content = fs.readFileSync(teamPath, 'utf-8');
    const parsed = JSON.parse(content);

    // Ensure members array exists
    if (!Array.isArray(parsed.members)) {
      parsed.members = [];
    }

    return parsed;
  } catch {
    return { members: [] };
  }
}

// ---------------------------------------------------------------------------
// Git Helpers
// ---------------------------------------------------------------------------

/**
 * Get the current git user name.
 * Falls back to USER or USERNAME environment variables.
 */
function getCurrentUser() {
  try {
    const name = execSync('git config user.name', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    if (name) return name;
  } catch {
    // git config failed — fall through to env vars
  }

  return process.env.USER || process.env.USERNAME || 'Unknown';
}

/**
 * Get recent git commits from the last N hours.
 * Returns a formatted string or empty string if none found.
 */
function getRecentCommits(projectDir, hours = 8, limit = 5) {
  try {
    const output = execSync(
      `git log --oneline -${limit} --since="${hours} hours ago"`,
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return output || '';
  } catch {
    return '';
  }
}

/**
 * Get open GitHub issues using the gh CLI.
 * Returns { issues: [...], error: null } on success,
 * or { issues: [], error: "message" } on failure.
 */
function getOpenIssues(projectDir, limit = 100) {
  try {
    const output = execSync(
      `gh issue list --state open --limit ${limit} --json number,title,assignees,labels`,
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 }
    ).trim();

    if (!output) return { issues: [], error: null };

    const issues = JSON.parse(output);
    return { issues, error: null };
  } catch (e) {
    // gh not installed, not authenticated, or no GitHub remote
    const msg = e.message || '';
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
      return { issues: [], error: 'gh CLI is not installed' };
    }
    return { issues: [], error: 'Could not load GitHub Issues' };
  }
}

/**
 * Get the GitHub repo URL (e.g. "https://github.com/user/repo").
 * Returns empty string if not a GitHub repo.
 */
function getGitHubRepoUrl(projectDir) {
  try {
    const remote = execSync('git remote get-url origin',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // Convert SSH or HTTPS to web URL
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (match) return `https://github.com/${match[1]}`;
    return '';
  } catch { return ''; }
}

/**
 * Parse recent git commits (last 8 hours) and categorize them by type.
 * Each entry has { msg, hash } so we can link to GitHub.
 */
function getCategorizedCommits(projectDir) {
  try {
    const output = execSync(
      'git log --oneline --since="8 hours ago"',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output) return { features: [], fixes: [], other: [] };

    const features = [];
    const fixes = [];
    const other = [];

    for (const line of output.split('\n')) {
      const hash = line.substring(0, 7);
      const msg = line.substring(8).trim();
      if (msg.startsWith('feat:') || msg.startsWith('feat(')) {
        features.push({ msg: msg.replace(/^feat(\([^)]*\))?:\s*/, ''), hash });
      } else if (msg.startsWith('fix:') || msg.startsWith('fix(')) {
        fixes.push({ msg: msg.replace(/^fix(\([^)]*\))?:\s*/, ''), hash });
      } else if (!msg.startsWith('chore:') && !msg.startsWith('Merge')) {
        other.push({ msg, hash });
      }
    }
    return { features, fixes, other };
  } catch { return { features: [], fixes: [], other: [] }; }
}

/**
 * Get current branch name and how far ahead it is of main/master.
 * Returns { branch, isMain, commitsAhead }.
 */
function getBranchInfo(projectDir) {
  try {
    const branch = execSync('git branch --show-current',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const isMain = ['main', 'master'].includes(branch);

    let commitsAhead = 0;
    if (!isMain) {
      try {
        // Detect whether the repo uses "main" or "master"
        const mainBranch = execSync('git rev-parse --verify main 2>/dev/null || git rev-parse --verify master 2>/dev/null',
          { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() ? 'main' : 'master';
        const ahead = execSync(`git rev-list --count ${mainBranch}..HEAD`,
          { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        commitsAhead = parseInt(ahead) || 0;
      } catch {}
    }

    return { branch, isMain, commitsAhead };
  } catch { return { branch: 'unknown', isMain: false, commitsAhead: 0 }; }
}

/**
 * Notify the Worker of a session event (start/end) and optionally fetch active sessions.
 * Returns active sessions array or empty array on failure.
 */
function workerRequest(workerUrl, projectId, method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, workerUrl);
    const data = body ? JSON.stringify(body) : null;
    const mod = url.protocol === 'https:' ? https : require('http');

    const req = mod.request(url, {
      method: method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let result = '';
      res.on('data', c => result += c);
      res.on('end', () => {
        try { resolve(JSON.parse(result)); } catch { resolve(null); }
      });
    });
    req.on('error', (e) => { console.error(`[Worker] Request error: ${e.message}`); resolve(null); });
    req.setTimeout(8000, () => { req.destroy(); console.error('[Worker] Request timed out'); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Register session start with the Worker and fetch who else is active.
 * Returns array of { user, since } for active sessions.
 */
async function workerSessionStart(config, user) {
  if (!config.workerUrl || !config.projectId) {
    console.error('[Worker] No workerUrl or projectId configured, skipping');
    return [];
  }
  // Register this session with the Worker
  console.error(`[Worker] Registering session start for ${user} at ${config.workerUrl}/session/${config.projectId}`);
  const regResult = await workerRequest(config.workerUrl, config.projectId, 'POST',
    `/session/${config.projectId}`, { type: 'start', user, message: '' });
  console.error(`[Worker] Session register result: ${JSON.stringify(regResult)}`);
  // Fetch all active sessions
  const data = await workerRequest(config.workerUrl, config.projectId, 'GET',
    `/sessions/${config.projectId}`, null);
  if (data && Array.isArray(data.sessions)) {
    return data.sessions.filter(s => s.user !== user); // exclude self
  }
  return [];
}

/**
 * Register session end with the Worker.
 */
async function workerSessionEnd(config, user) {
  if (!config.workerUrl || !config.projectId) return;
  await workerRequest(config.workerUrl, config.projectId, 'POST',
    `/session/${config.projectId}`, { type: 'end', user, message: '' });
}

/**
 * Get branches that have not been merged into main/master.
 * Returns an array of branch name strings (excluding remote-only branches).
 */
function getPendingBranches(projectDir) {
  try {
    const output = execSync(
      'git branch --no-merged main 2>/dev/null || git branch --no-merged master 2>/dev/null',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (!output) return [];

    return output.split('\n')
      .map(b => b.replace(/^\*?\s+/, '').trim())
      .filter(b => b && !b.startsWith('remotes/'));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Telegram API
// ---------------------------------------------------------------------------

/**
 * Send a message to Telegram via the Bot API.
 * Uses Node.js built-in https module — no external dependencies.
 *
 * @param {string} token    - Bot API token
 * @param {string} chatId   - Target chat ID
 * @param {string} text     - Message text (supports Telegram HTML parse_mode)
 * @param {string|null} threadId - Optional forum topic thread ID
 * @returns {Promise<object>} Telegram API response
 */
function sendTelegram(token, chatId, text, threadId) {
  return new Promise((resolve, reject) => {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };

    // Include thread ID for forum topics (supergroup threads)
    if (threadId) {
      payload.message_thread_id = parseInt(threadId, 10);
    }

    const body = JSON.stringify(payload);

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf-8')
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) {
            resolve(parsed);
          } else {
            reject(new Error(`Telegram API error: ${parsed.description || 'unknown'}`));
          }
        } catch {
          reject(new Error('Failed to parse Telegram response'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Telegram request failed: ${err.message}`));
    });

    // Timeout after 10 seconds — don't block the session
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Telegram request timed out'));
    });

    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Session Notifications
// ---------------------------------------------------------------------------

/**
 * Send a "session started" notification to Telegram.
 * Sends TWO messages when loginThreadId is configured:
 *   1. Login topic: short "{user} ist online" message
 *   2. Project topic: full message with open tasks
 * If loginThreadId is not set, only the project topic message is sent.
 */
async function notifySessionStart(projectDir) {
  const config = loadBotConfig(projectDir);
  if (!config) return; // Telegram not configured — silent skip

  const user = getCurrentUser();
  const projectName = path.basename(projectDir);

  // --- Login channel/topic: short message ---
  const loginChatId = config.loginChatId || config.chatId;
  const loginThreadId = config.loginChatId ? null : config.loginThreadId;
  if (config.loginChatId || config.loginThreadId) {
    const loginText = `\uD83D\uDFE2 <b>${escapeHtml(user)}</b> is online \u2014 working on <b>${escapeHtml(projectName)}</b>`;
    try {
      await sendTelegram(config.token, loginChatId, loginText, loginThreadId);
      console.error('[Notify] Login message sent');
    } catch (e) {
      console.error(`[Notify] Login message failed: ${e.message}`);
    }
  }

  // --- Register session with Worker + trigger live dashboard ---
  await workerSessionStart(config, user);

  // Trigger the Worker to send/update the live dashboard (with buttons)
  if (config.workerUrl && config.projectId) {
    try {
      await workerRequest(config.workerUrl, config.projectId, 'POST',
        `/dashboard/${config.projectId}`, {});
      console.error('[Notify] Dashboard updated');
    } catch (e) {
      console.error(`[Notify] Dashboard update failed: ${e.message}`);
    }
  } else {
    // Fallback: send plain text if Worker not configured
    const lines = [];
    lines.push(`\uD83D\uDC4B <b>${escapeHtml(user)}</b> is online \u2014 working on <b>${escapeHtml(projectName)}</b>`);
    const { issues, error } = getOpenIssues(projectDir);
    if (issues.length > 0) {
      lines.push('');
      lines.push(`\uD83D\uDCCB <b>Open Tasks</b> (${issues.length}):`);
      for (const issue of issues) {
        const assigneeNames = (issue.assignees || []).map(a => a.login).join(', ');
        const assigneeLabel = assigneeNames ? assigneeNames : 'open';
        lines.push(`\u2022 #${issue.number} ${escapeHtml(issue.title)} [${escapeHtml(assigneeLabel)}]`);
      }
    } else if (error) {
      lines.push(`\n(${error})`);
    }
    try {
      await sendTelegram(config.token, config.chatId, lines.join('\n'), config.threadId);
      console.error('[Notify] Session start message sent (fallback)');
    } catch (e) {
      console.error(`[Notify] Session start failed: ${e.message}`);
    }
  }
}

/**
 * Send a "session ended" notification to Telegram.
 * Sends TWO messages when loginThreadId is configured:
 *   1. Login topic: short "{user} hat die Session beendet" message
 *   2. Project topic: full message with stats + commits
 * If loginThreadId is not set, only the project topic message is sent.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} stats      - Optional session stats { prompts_count, corrections_count }
 */
async function notifySessionEnd(projectDir, stats) {
  const config = loadBotConfig(projectDir);
  if (!config) return; // Telegram not configured — silent skip

  const user = getCurrentUser();
  const projectName = path.basename(projectDir);

  // No "ended" message to Login channel — sessions auto-expire via TTL.
  // Context compressions trigger session-end hooks falsely, so we skip this.
  // This prevents context compressions from falsely showing users as offline.
  // Just update the dashboard.
  if (config.workerUrl && config.projectId) {
    try {
      await workerRequest(config.workerUrl, config.projectId, 'POST',
        `/dashboard/${config.projectId}`, {});
    } catch {}
  }

  // --- Project group/topic: session summary message ---
  const repoUrl = getGitHubRepoUrl(projectDir);
  const lines = [];
  lines.push(`\u2705 <b>${escapeHtml(user)}</b> has ended the session (<b>${escapeHtml(projectName)}</b>)`);

  // Session stats (if available)
  if (stats && (stats.prompts_count || stats.corrections_count)) {
    lines.push('');
    const prompts = stats.prompts_count || 0;
    const corrections = stats.corrections_count || 0;
    lines.push(`\uD83D\uDCCA <b>Stats:</b> ${prompts} prompts | ${corrections} corrections`);
  }

  // Categorized commits from the last 8 hours
  const { features, fixes, other } = getCategorizedCommits(projectDir);

  // Format commit entry (no commit links — they 404 on unpushed branches)
  const fmtCommit = (entry) => `\u2022 ${escapeHtml(entry.msg)}`;

  if (features.length > 0) {
    lines.push('');
    lines.push(`\uD83D\uDE80 <b>Features added:</b>`);
    for (const f of features) lines.push(fmtCommit(f));
  }

  if (fixes.length > 0) {
    lines.push('');
    lines.push(`\uD83D\uDD27 <b>Fixes:</b>`);
    for (const f of fixes) lines.push(fmtCommit(f));
  }

  if (other.length > 0) {
    lines.push('');
    lines.push(`\uD83D\uDCDD <b>Other changes:</b>`);
    for (const o of other) lines.push(fmtCommit(o));
  }

  // Branch status
  const branchInfo = getBranchInfo(projectDir);
  if (branchInfo.branch !== 'unknown') {
    lines.push('');
    if (branchInfo.isMain) {
      lines.push(`\uD83C\uDF3F <b>Branch:</b> ${escapeHtml(branchInfo.branch)} \u2014 merged`);
    } else {
      const aheadText = branchInfo.commitsAhead > 0
        ? `${branchInfo.commitsAhead} commits ahead, ` : '';
      const branchLink = repoUrl ? `<a href="${repoUrl}/tree/${branchInfo.branch}">${escapeHtml(branchInfo.branch)}</a>` : escapeHtml(branchInfo.branch);
      lines.push(`\uD83D\uDCCB <b>Branch:</b> ${branchLink} (${aheadText}not merged)`);
    }
  }

  const projectText = lines.join('\n');

  try {
    await sendTelegram(config.token, config.chatId, projectText, config.threadId);
    console.error('[Notify] Session end message sent');
  } catch (e) {
    console.error(`[Notify] Session end failed: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat (keeps session alive + sends activity data to Worker)
// ---------------------------------------------------------------------------

/**
 * Send a heartbeat to the Worker to keep the session alive.
 * Includes activity data (current branch, recently changed files, last commit)
 * so the /active display can show what each team member is working on.
 *
 * Throttled to once every 15 minutes via a timestamp file to avoid
 * spamming the Worker on every tool use.
 *
 * @param {string} projectDir - Project root directory
 */
async function sendHeartbeat(projectDir) {
  const config = loadBotConfig(projectDir);
  if (!config || !config.workerUrl || !config.projectId) return;

  // Throttle: only send every 15 minutes
  const throttleFile = path.join(projectDir, '.claude', 'logs', '.heartbeat-ts');
  try {
    if (fs.existsSync(throttleFile)) {
      const lastTs = parseInt(fs.readFileSync(throttleFile, 'utf-8').trim(), 10);
      if (Date.now() - lastTs < 15 * 60 * 1000) return; // Skip if <15min since last
    }
  } catch {}

  const user = getCurrentUser();
  const projectName = path.basename(projectDir);

  // Gather activity data
  let branch = 'unknown';
  try {
    branch = execSync('git branch --show-current',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {}

  let lastFiles = [];
  try {
    const files = execSync('git diff --name-only HEAD 2>/dev/null || git diff --name-only --cached 2>/dev/null',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (files) lastFiles = files.split('\n').slice(0, 5);
  } catch {}

  let lastCommit = '';
  try {
    lastCommit = execSync('git log --oneline -1',
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().substring(8);
  } catch {}

  // Send heartbeat to Worker
  try {
    await workerRequest(config.workerUrl, config.projectId, 'POST',
      `/session/${config.projectId}`, {
        type: 'heartbeat',
        user,
        branch,
        lastFiles,
        lastCommit,
        project: projectName
      });
    console.error('[Notify] Heartbeat sent');
  } catch (e) {
    console.error(`[Notify] Heartbeat failed: ${e.message}`);
  }

  // Update throttle timestamp
  try {
    const dir = path.dirname(throttleFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(throttleFile, String(Date.now()));
  } catch {}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape special characters for Telegram HTML parse_mode.
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || '';
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  (async () => {
    switch (command) {
      case 'session-start':
        await notifySessionStart(projectDir);
        break;

      case 'session-end': {
        // Try to read session stats from the learning DB
        let stats = null;
        try {
          const { getDb, queryOne } = require('../db/store');
          const db = await getDb();
          const sessionIdFile = path.join(projectDir, '.claude', 'logs', '.session-id');
          if (fs.existsSync(sessionIdFile)) {
            const sessionId = fs.readFileSync(sessionIdFile, 'utf-8').trim();
            stats = queryOne(db, 'SELECT * FROM sessions WHERE id = ?', [sessionId]);
          }
          db.close();
        } catch {
          // DB not available — stats will be null, that's fine
        }
        await notifySessionEnd(projectDir, stats);
        break;
      }

      case 'heartbeat':
        await sendHeartbeat(projectDir);
        break;

      default:
        console.error('Usage:');
        console.error('  node notify.js session-start   Send session start notification');
        console.error('  node notify.js session-end     Send session end notification');
        console.error('  node notify.js heartbeat       Send heartbeat to keep session alive');
        break;
    }
  })().catch((e) => {
    // Silent fail — Telegram should never block the session
    console.error(`[Notify] Error: ${e.message}`);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  loadBotConfig,
  loadTeamConfig,
  getCurrentUser,
  sendTelegram,
  notifySessionStart,
  notifySessionEnd,
  sendHeartbeat,
  parseEnvFile,
  escapeHtml,
  getRecentCommits,
  getOpenIssues,
  getCategorizedCommits,
  getBranchInfo,
  getPendingBranches
};
