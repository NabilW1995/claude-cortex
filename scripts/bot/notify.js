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
 * Returns { token, chatId, threadId, loginThreadId } or null if token/chatId are missing.
 */
function loadBotConfig(projectDir) {
  try {
    const envPath = path.join(projectDir, '.env');
    const vars = parseEnvFile(envPath);

    const token = vars.TELEGRAM_BOT_TOKEN || '';
    const chatId = vars.TELEGRAM_CHAT_ID || '';
    const threadId = vars.TELEGRAM_THREAD_ID || '';
    const loginThreadId = vars.TELEGRAM_LOGIN_THREAD_ID || '';

    // Both token and chatId are required
    if (!token || !chatId) return null;

    return {
      token,
      chatId,
      threadId: threadId || null,
      loginThreadId: loginThreadId || null
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
      parse_mode: 'HTML'
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

  // --- Login topic: short message ---
  if (config.loginThreadId) {
    const loginText = `<b>${escapeHtml(user)}</b> is online -- working on <b>${escapeHtml(projectName)}</b>`;
    try {
      await sendTelegram(config.token, config.chatId, loginText, config.loginThreadId);
      console.error('[Notify] Login topic message sent');
    } catch (e) {
      console.error(`[Notify] Login topic failed: ${e.message}`);
    }
  }

  // --- Project topic: full message with open tasks ---
  const lines = [];
  lines.push(`<b>${escapeHtml(user)}</b> is online -- working on <b>${escapeHtml(projectName)}</b>`);

  // Try to load open GitHub issues
  const { issues, error } = getOpenIssues(projectDir);

  if (issues.length > 0) {
    // Group issues by label
    const grouped = {};
    const unlabeled = [];

    for (const issue of issues) {
      const labelNames = (issue.labels || []).map(l => l.name);
      if (labelNames.length === 0) {
        unlabeled.push(issue);
      } else {
        for (const label of labelNames) {
          if (!grouped[label]) grouped[label] = [];
          grouped[label].push(issue);
        }
      }
    }

    lines.push('');
    lines.push(`Open Tasks (${issues.length}):`);

    // Show grouped by label with counts
    const labelKeys = Object.keys(grouped).sort();
    for (const label of labelKeys) {
      const labelIssues = grouped[label];
      lines.push('');
      lines.push(`<b>${escapeHtml(label)}</b> (${labelIssues.length}):`);
      for (const issue of labelIssues) {
        const assigneeNames = (issue.assignees || []).map(a => a.login).join(', ');
        const assigneeLabel = assigneeNames ? assigneeNames : 'open';
        lines.push(`- #${issue.number} ${escapeHtml(issue.title)} [${escapeHtml(assigneeLabel)}]`);
      }
    }

    // Show unlabeled issues if any
    if (unlabeled.length > 0) {
      lines.push('');
      lines.push(`<b>other</b> (${unlabeled.length}):`);
      for (const issue of unlabeled) {
        const assigneeNames = (issue.assignees || []).map(a => a.login).join(', ');
        const assigneeLabel = assigneeNames ? assigneeNames : 'open';
        lines.push(`- #${issue.number} ${escapeHtml(issue.title)} [${escapeHtml(assigneeLabel)}]`);
      }
    }
  } else if (error) {
    lines.push('');
    lines.push(`(${error})`);
  }

  const projectText = lines.join('\n');

  try {
    await sendTelegram(config.token, config.chatId, projectText, config.threadId);
    console.error('[Notify] Session start message sent');
  } catch (e) {
    console.error(`[Notify] Session start failed: ${e.message}`);
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

  // --- Login topic: short message ---
  if (config.loginThreadId) {
    const loginText = `<b>${escapeHtml(user)}</b> has ended the session (<b>${escapeHtml(projectName)}</b>)`;
    try {
      await sendTelegram(config.token, config.chatId, loginText, config.loginThreadId);
      console.error('[Notify] Login topic end message sent');
    } catch (e) {
      console.error(`[Notify] Login topic end failed: ${e.message}`);
    }
  }

  // --- Project topic: full message with stats + commits ---
  const lines = [];
  lines.push(`<b>${escapeHtml(user)}</b> has ended the session (<b>${escapeHtml(projectName)}</b>)`);

  // Session stats (if available)
  if (stats && (stats.prompts_count || stats.corrections_count)) {
    lines.push(`- Prompts: ${stats.prompts_count || 0}`);
    lines.push(`- Corrections: ${stats.corrections_count || 0}`);
  }

  // Recent commits
  const commits = getRecentCommits(projectDir);
  if (commits) {
    lines.push('');
    lines.push('Recent Commits:');
    // Limit to 5 lines and escape HTML in commit messages
    const commitLines = commits.split('\n').slice(0, 5);
    for (const commitLine of commitLines) {
      lines.push(escapeHtml(commitLine));
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

      default:
        console.error('Usage:');
        console.error('  node notify.js session-start   Send session start notification');
        console.error('  node notify.js session-end     Send session end notification');
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
  parseEnvFile,
  escapeHtml,
  getRecentCommits,
  getOpenIssues
};
