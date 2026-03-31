#!/usr/bin/env node
/**
 * Claude Cortex — Install Script
 *
 * Usage: node scripts/template/install.js [target-path]
 * If no target-path given, installs into current directory.
 *
 * Flow:
 * 1. Safety check (don't install into home dir, root, etc.)
 * 2. Check if already installed (.claude-template.json exists)
 * 3. Scan target for existing .claude/ content (agents, commands, hooks)
 *    -> Log interesting finds for potential template adoption
 * 4. Copy template-owned directories (rules, agents, commands, skills, hooks, db)
 *    -> If target file already exists: SKIP (don't overwrite existing project files on first install)
 *    -> Only copy files that don't exist yet
 * 5. Merge CLAUDE.md:
 *    -> If exists: use mergeCLAUDEmd() to add Cortex sections while preserving project content
 *    -> If doesn't exist: copy template CLAUDE.md as-is
 * 6. Merge settings.json:
 *    -> If exists: use mergeSettings() to add Cortex hooks/permissions while preserving project settings
 *    -> If doesn't exist: copy template settings.json as-is
 * 7. Copy .mcp.json.example (never .mcp.json itself -- contains secrets)
 * 8. Copy .env.example
 * 9. Append Cortex entries to .gitignore (if not already present)
 * 10. Create .claude-template.json in target with current version
 * 11. Copy scripts/db/ for SQLite learning system
 * 12. Copy package.json dependencies needed (sql.js) -- merge with existing package.json if present
 * 13. Print summary of what was done
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Get template source directory (where this script lives = ../../)
const TEMPLATE_DIR = path.resolve(__dirname, '..', '..');

/**
 * Recursively get all files in a directory.
 * @param {string} dir - Directory path
 * @returns {string[]} Array of absolute file paths
 */
function getAllFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Normalize a path for comparison (resolve + lowercase on Windows).
 * @param {string} p - Path to normalize
 * @returns {string}
 */
function normPath(p) {
  const resolved = path.resolve(p);
  // On Windows, paths are case-insensitive
  if (process.platform === 'win32') {
    return resolved.toLowerCase();
  }
  return resolved;
}

/**
 * Install Claude Cortex into a target directory.
 * @param {string} [targetDir='.'] - Target directory path
 */
function install(targetDir) {
  targetDir = path.resolve(targetDir || '.');

  // 1. Safety check — don't install into dangerous system directories
  const dangerous = [
    os.homedir(),
    '/',
    'C:\\',
    'C:\\Users',
    '/root',
    '/home',
  ];
  const normalizedTarget = normPath(targetDir);
  for (const d of dangerous) {
    if (normPath(d) === normalizedTarget) {
      console.error('ERROR: Cannot install into system directory:', targetDir);
      process.exit(1);
    }
  }

  // 2. Check if already installed
  const manifestPath = path.join(targetDir, '.claude-template.json');
  if (fs.existsSync(manifestPath)) {
    console.error('Claude Cortex is already installed in this project.');
    console.error('Use "node scripts/template/update.js" to update.');
    process.exit(1);
  }

  console.log(`\nInstalling Claude Cortex into: ${targetDir}\n`);

  // 3. Scan for existing content
  const scanDirs = ['.claude/agents', '.claude/commands', '.claude/rules', 'scripts/hooks'];
  for (const dir of scanDirs) {
    const fullDir = path.join(targetDir, dir);
    if (fs.existsSync(fullDir)) {
      const files = fs.readdirSync(fullDir).filter(
        (f) => f.endsWith('.md') || f.endsWith('.js') || f.endsWith('.sh')
      );
      if (files.length > 0) {
        console.log(`  Found existing ${dir}/: ${files.join(', ')}`);
      }
    }
  }

  // 4. Copy template-owned directories
  const templateOwned = [
    '.claude/rules',
    '.claude/agents',
    '.claude/commands',
    '.claude/skills',
    'scripts/hooks',
    'scripts/db',
  ];

  let copiedCount = 0;
  let skippedCount = 0;
  for (const dir of templateOwned) {
    const srcDir = path.join(TEMPLATE_DIR, dir);
    const destDir = path.join(targetDir, dir);
    if (!fs.existsSync(srcDir)) continue;

    // Create directory structure
    fs.mkdirSync(destDir, { recursive: true });

    // Copy files (skip existing on first install)
    const files = getAllFiles(srcDir);
    for (const file of files) {
      const relativePath = path.relative(srcDir, file);
      const destFile = path.join(destDir, relativePath);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });

      if (fs.existsSync(destFile)) {
        skippedCount++;
      } else {
        fs.copyFileSync(file, destFile);
        copiedCount++;
      }
    }
  }
  console.log(`  Copied ${copiedCount} template files (${skippedCount} existing skipped)`);

  // 5. Merge CLAUDE.md
  const { mergeCLAUDEmd } = require('./merge-claude-md');
  const templateCLAUDEPath = path.join(TEMPLATE_DIR, 'CLAUDE.md');
  const targetCLAUDEPath = path.join(targetDir, 'CLAUDE.md');

  if (fs.existsSync(templateCLAUDEPath)) {
    const templateCLAUDE = fs.readFileSync(templateCLAUDEPath, 'utf-8');
    if (fs.existsSync(targetCLAUDEPath)) {
      const currentContent = fs.readFileSync(targetCLAUDEPath, 'utf-8');
      const merged = mergeCLAUDEmd(currentContent, templateCLAUDE);
      fs.writeFileSync(targetCLAUDEPath, merged);
      console.log('  CLAUDE.md merged (Cortex sections added, project content preserved)');
    } else {
      fs.copyFileSync(templateCLAUDEPath, targetCLAUDEPath);
      console.log('  CLAUDE.md created from template');
    }
  }

  // 6. Merge settings.json
  const { mergeSettings } = require('./merge-settings');
  const templateSettingsPath = path.join(TEMPLATE_DIR, '.claude/settings.json');
  const targetSettingsPath = path.join(targetDir, '.claude/settings.json');

  fs.mkdirSync(path.join(targetDir, '.claude'), { recursive: true });
  if (fs.existsSync(templateSettingsPath)) {
    const templateSettings = JSON.parse(fs.readFileSync(templateSettingsPath, 'utf-8'));
    if (fs.existsSync(targetSettingsPath)) {
      const currentSettings = JSON.parse(fs.readFileSync(targetSettingsPath, 'utf-8'));
      const merged = mergeSettings(currentSettings, templateSettings);
      fs.writeFileSync(targetSettingsPath, JSON.stringify(merged, null, 2) + '\n');
      console.log('  settings.json merged (hooks + permissions added)');
    } else {
      fs.writeFileSync(targetSettingsPath, JSON.stringify(templateSettings, null, 2) + '\n');
      console.log('  settings.json created from template');
    }
  }

  // 7. Copy .mcp.json.example
  const mcpExample = path.join(TEMPLATE_DIR, '.mcp.json.example');
  if (fs.existsSync(mcpExample)) {
    const destMcp = path.join(targetDir, '.mcp.json.example');
    if (!fs.existsSync(destMcp)) {
      fs.copyFileSync(mcpExample, destMcp);
      console.log('  .mcp.json.example copied (fill in your API keys)');
    }
  }

  // 8. Copy .env.example
  const envExample = path.join(TEMPLATE_DIR, '.env.example');
  if (fs.existsSync(envExample)) {
    const destEnv = path.join(targetDir, '.env.example');
    if (!fs.existsSync(destEnv)) {
      fs.copyFileSync(envExample, destEnv);
      console.log('  .env.example copied');
    }
  }

  // 9. Append to .gitignore
  const gitignorePath = path.join(targetDir, '.gitignore');
  const cortexIgnore = [
    '',
    '# Claude Cortex',
    'CLAUDE.local.md',
    '.claude/settings.local.json',
    '.claude/logs/',
    '.claude/backups/',
    '.mcp.json',
    '*.db',
    '*.sqlite',
    '',
  ].join('\n');

  if (fs.existsSync(gitignorePath)) {
    const current = fs.readFileSync(gitignorePath, 'utf-8');
    if (!current.includes('# Claude Cortex')) {
      fs.appendFileSync(gitignorePath, cortexIgnore);
      console.log('  .gitignore updated with Cortex entries');
    }
  } else {
    fs.writeFileSync(gitignorePath, cortexIgnore.trimStart());
    console.log('  .gitignore created');
  }

  // 10. Create .claude-template.json manifest
  const templateManifest = JSON.parse(
    fs.readFileSync(path.join(TEMPLATE_DIR, '.claude-template.json'), 'utf-8')
  );
  const manifest = {
    name: 'claude-cortex',
    version: templateManifest.version,
    repo: 'NabilW1995/claude-cortex',
    installedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    lastSyncCheck: null,
    templateOwned: [
      '.claude/rules/',
      '.claude/agents/',
      '.claude/commands/',
      '.claude/skills/',
      'scripts/hooks/',
      'scripts/db/',
    ],
    projectOwned: [
      'CLAUDE.local.md',
      '.claude/knowledge-base.md',
      '.claude/knowledge-nominations.md',
      '.claude/settings.local.json',
      '.mcp.json',
    ],
    mergeFiles: [
      'CLAUDE.md',
      '.claude/settings.json',
      '.claude/team-learnings.json',
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('  .claude-template.json created (version tracking)');

  // 11. Create empty knowledge files if they don't exist
  const knowledgeFiles = {
    '.claude/knowledge-base.md': [
      '# Knowledge Base -- Confirmed Rules',
      '',
      '> Only auditor-reviewed learnings end up here.',
      '',
      '## Hard Rules',
      '(none yet)',
      '',
      '## Patterns',
      '(none yet)',
      '',
      '## Known Failure Modes',
      '(none yet)',
      '',
    ].join('\n'),
    '.claude/knowledge-nominations.md': [
      '# Knowledge Nominations -- Queue',
      '',
      '> New learnings land here. Review with `/audit`.',
      '',
      '## Pending',
      '(none)',
      '',
      '## Recently Approved',
      '(none)',
      '',
      '## Recently Rejected',
      '(none)',
      '',
    ].join('\n'),
    '.claude/team-learnings.json': JSON.stringify(
      {
        version: 1,
        description:
          'Shared team learnings -- auto-synced via git commits. DO NOT edit manually.',
        learnings: [],
      },
      null,
      2
    ) + '\n',
  };
  for (const [file, content] of Object.entries(knowledgeFiles)) {
    const destFile = path.join(targetDir, file);
    if (!fs.existsSync(destFile)) {
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.writeFileSync(destFile, content);
    }
  }

  // 12. Merge package.json (add sql.js dependency + cortex scripts)
  const targetPkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(targetPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf-8'));
    pkg.dependencies = pkg.dependencies || {};
    let pkgChanged = false;
    if (!pkg.dependencies['sql.js']) {
      pkg.dependencies['sql.js'] = '^1.11.0';
      pkgChanged = true;
      console.log('  Added sql.js dependency to package.json');
    }
    // Add cortex scripts
    pkg.scripts = pkg.scripts || {};
    const cortexScripts = {
      'db:init': 'node scripts/db/init-db.js',
      'db:reset': 'node scripts/db/init-db.js --reset',
      'cortex:update': 'node scripts/template/update.js',
      'cortex:version':
        'node -e "console.log(require(\\"./.claude-template.json\\").version)"',
    };
    for (const [key, val] of Object.entries(cortexScripts)) {
      if (!pkg.scripts[key]) {
        pkg.scripts[key] = val;
        pkgChanged = true;
      }
    }
    if (pkgChanged) {
      fs.writeFileSync(targetPkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  }

  // Summary
  console.log(`\nClaude Cortex v${manifest.version} installed successfully!\n`);
  console.log('Next steps:');
  console.log('  1. Run: npm install');
  console.log('  2. Copy .mcp.json.example to .mcp.json and add your API keys');
  console.log('  3. Run: npm run db:init');
  console.log('  4. Start a new Claude Code session\n');
}

// CLI entry point
if (require.main === module) {
  const targetPath = process.argv[2] || '.';
  install(targetPath);
}

module.exports = { install };
