#!/usr/bin/env node
/**
 * stop-prompts.js — Stop Hook
 *
 * When Claude stops, show useful copy-paste prompts and commands.
 * Uses stdout JSON with systemMessage so Claude Code displays it.
 */

const message = [
  '── Copy a prompt to continue ──',
  '1. Before finishing, verify your work. Run tests, check edge cases, show me proof this works.',
  '2. Knowing everything you know now, scrap this and implement the elegant solution.',
  '3. What did we learn from this task? Save the key insights as learnings.',
  '4. /sanity-check',
  '5. /simplify',
  '──────────────────────────────'
].join('\n');

process.stdout.write(JSON.stringify({ systemMessage: message }));
