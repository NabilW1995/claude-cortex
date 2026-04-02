#!/usr/bin/env node
/**
 * cortex-init — One-command Cortex installation
 *
 * Usage:
 *   npx cortex-init          (install into current directory)
 *   npx cortex-init my-app   (install into ./my-app)
 *
 * What it does:
 *   1. Clones the Cortex template (shallow)
 *   2. Runs install.js to merge into target project
 *   3. Cleans up the clone
 *   4. Runs npm install + db:init
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const targetDir = process.argv[2] || '.';
const absTarget = path.resolve(targetDir);
const tempDir = path.join(absTarget, '.cortex-temp');
const repo = 'https://github.com/NabilW1995/claude-cortex.git';

console.log('');
console.log('  Claude Cortex — Installer');
console.log('  =========================');
console.log('');

// Check target exists
if (!fs.existsSync(absTarget)) {
  console.error(`  Target directory not found: ${absTarget}`);
  process.exit(1);
}

try {
  // Step 1: Clone
  console.log('  1/4 Downloading Cortex...');
  execSync(`git clone --depth 1 ${repo} "${tempDir}"`, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Step 2: Install
  console.log('  2/4 Installing...');
  execSync(`node "${path.join(tempDir, 'scripts/template/install.js')}" "${absTarget}"`, {
    stdio: 'inherit',
  });

  // Step 3: Cleanup
  console.log('  3/4 Cleaning up...');
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Step 4: npm install + db:init
  console.log('  4/4 Installing dependencies...');
  execSync('npm install', { cwd: absTarget, stdio: 'inherit' });

  try {
    execSync('npm run db:init', { cwd: absTarget, stdio: 'inherit' });
  } catch {
    // db:init might fail if no sql.js yet — that's OK
  }

  console.log('');
  console.log('  Done! Open Claude Code and run /start');
  console.log('');
} catch (e) {
  console.error(`  Installation failed: ${e.message}`);
  // Cleanup on failure
  if (fs.existsSync(tempDir)) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(1);
}
