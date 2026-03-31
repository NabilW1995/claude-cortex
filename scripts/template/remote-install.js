#!/usr/bin/env node
/**
 * Claude Cortex — Remote Install
 *
 * Run from your project directory:
 *   npx degit NabilW1995/claude-cortex .cortex-temp && node .cortex-temp/scripts/template/install.js . && rm -rf .cortex-temp
 *
 * Or if you have the repo cloned:
 *   node /path/to/claude-cortex/scripts/template/install.js .
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const targetDir = process.argv[2] || process.cwd();
const tempDir = path.join(targetDir, '.cortex-temp');

try {
  console.log('\n🧠 Claude Cortex — Remote Install\n');

  // 1. Clone repo to temp dir
  console.log('  Downloading Claude Cortex from GitHub...');

  // Try degit first (fast, no git history), fall back to git clone
  try {
    execSync(`npx degit NabilW1995/claude-cortex "${tempDir}" --force`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    });
  } catch {
    // Fallback: shallow git clone
    execSync(`git clone --depth 1 https://github.com/NabilW1995/claude-cortex.git "${tempDir}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    });
  }

  // 2. Run install script
  console.log('  Installing into current project...\n');
  execSync(`node "${path.join(tempDir, 'scripts/template/install.js')}" "${targetDir}"`, {
    stdio: 'inherit'
  });

  // 3. Cleanup temp dir
  fs.rmSync(tempDir, { recursive: true, force: true });

} catch (e) {
  // Cleanup on error
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  console.error('\n❌ Installation failed:', e.message);
  process.exit(1);
}
