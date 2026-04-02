#!/usr/bin/env node
/**
 * Heartbeat hook — sends a ping to the Worker every 15 minutes.
 * Includes activity data (branch, files, last commit).
 * Throttled internally — safe to call on every tool use.
 */
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

(async () => {
  try {
    const { sendHeartbeat } = require('../bot/notify');
    await sendHeartbeat(projectDir);
  } catch {
    // Silent fail — heartbeat is optional
  }
})();
