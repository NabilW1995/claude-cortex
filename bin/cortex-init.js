#!/usr/bin/env node
/**
 * cortex-init — One-command Cortex installation and update
 *
 * Usage:
 *   npx cortex-init              Install into current directory
 *   npx cortex-init my-app       Install into ./my-app
 *   npx cortex-init --update     Update existing installation
 *   npx cortex-init --version    Show version
 *   npx cortex-init --help       Show help
 *
 * How it works:
 *   The npm package itself contains all template files (agents, hooks, rules, skills).
 *   On install: copies template files into your project and merges CLAUDE.md + settings.json.
 *   On update: overwrites template-owned files, merges shared files, preserves your content.
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// The npm package root IS the template source — no git clone needed
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const PKG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf-8'));

// Parse arguments
const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('-'));
const positional = args.filter(a => !a.startsWith('-'));

const showHelp = flags.includes('--help') || flags.includes('-h');
const showVersion = flags.includes('--version') || flags.includes('-v');
const doUpdate = flags.includes('--update') || flags.includes('-u');

// --help
if (showHelp) {
  console.log(`
  Claude Cortex v${PKG.version}

  Usage:
    npx cortex-init              Install into current directory
    npx cortex-init <dir>        Install into specified directory
    npx cortex-init --update     Update existing Cortex installation
    npx cortex-init --version    Show version
    npx cortex-init --help       Show this help

  What it does:
    Install: Copies agents, hooks, rules, and skills into your project.
             Merges CLAUDE.md and settings.json intelligently.
    Update:  Overwrites template files, merges shared files,
             preserves your project-specific content.

  After install, open Claude Code and run /start
`);
  process.exit(0);
}

// --version
if (showVersion) {
  console.log(PKG.version);
  process.exit(0);
}

const targetDir = positional[0] || '.';
const absTarget = path.resolve(targetDir);

console.log('');
console.log(`  Claude Cortex v${PKG.version}`);
console.log('  =========================');
console.log('');

// Check target exists
if (!fs.existsSync(absTarget)) {
  console.error(`  Target directory not found: ${absTarget}`);
  process.exit(1);
}

try {
  if (doUpdate) {
    // UPDATE PATH
    console.log(`  Updating Cortex in: ${absTarget}\n`);
    const { updateFromLocal } = require('../scripts/template/update.js');
    updateFromLocal(PACKAGE_ROOT, absTarget);
  } else {
    // INSTALL PATH
    console.log(`  Installing Cortex into: ${absTarget}\n`);
    const { install } = require('../scripts/template/install.js');
    install(absTarget);
  }

  // Post-install: npm install + db:init
  if (fs.existsSync(path.join(absTarget, 'package.json'))) {
    console.log('  Installing dependencies...');
    execSync('npm install', { cwd: absTarget, stdio: 'inherit' });

    try {
      execSync('npm run db:init', { cwd: absTarget, stdio: 'inherit' });
    } catch {
      // db:init might fail if sql.js isn't ready yet — that's OK
    }
  }

  console.log('');
  console.log('  Done! Open Claude Code and run /start');
  console.log('');
} catch (e) {
  console.error(`  ${doUpdate ? 'Update' : 'Installation'} failed: ${e.message}`);
  process.exit(1);
}
