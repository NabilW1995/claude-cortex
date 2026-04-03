#!/usr/bin/env node
/**
 * Claude Cortex — Update Script
 *
 * Usage: node scripts/template/update.js
 * Or via: /template-update command
 * Or via: npm run cortex:update
 *
 * Requires: gh CLI authenticated with GitHub
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

async function update() {
  // 1. Read manifest
  const manifestPath = path.join(PROJECT_DIR, '.claude-template.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('No .claude-template.json found. Install Cortex first.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const repo = manifest.repo;

  console.log(`\nClaude Cortex Update — current version: ${manifest.version}\n`);

  // 2. Check for gh CLI
  try {
    execSync('gh auth status', { stdio: 'pipe' });
  } catch {
    console.error('GitHub CLI (gh) not authenticated. Run: gh auth login');
    process.exit(1);
  }

  // 3. Get latest release/tag info from GitHub
  let latestVersion = manifest.version;
  try {
    const releaseInfo = execSync(`gh api repos/${repo}/releases/latest --jq .tag_name`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (releaseInfo) latestVersion = releaseInfo.replace(/^v/, '');
  } catch {
    // No releases yet — fall back to checking latest commit
    try {
      const latestSha = execSync(`gh api repos/${repo}/commits/HEAD --jq .sha`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      console.log(`  No releases found — checking latest commit: ${latestSha.slice(0, 7)}`);
    } catch (e) {
      console.error(`Cannot reach GitHub repo: ${repo}`);
      process.exit(1);
    }
  }

  // 4. Download and update template-owned files
  const templateOwned = manifest.templateOwned || [];
  let updatedFiles = 0;
  let newFiles = 0;

  for (const dir of templateOwned) {
    // List files in this directory from the repo
    try {
      const filesJson = execSync(
        `gh api repos/${repo}/contents/${dir} --jq "[.[] | {name: .name, path: .path, download_url: .download_url, sha: .sha}]"`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const files = JSON.parse(filesJson);

      for (const file of files) {
        if (!file.download_url) continue; // skip subdirectories for now

        const localPath = path.join(PROJECT_DIR, file.path);
        const localDir = path.dirname(localPath);

        // Download file content
        let remoteContent;
        try {
          remoteContent = execSync(`gh api repos/${repo}/contents/${file.path} --jq .content`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
          remoteContent = Buffer.from(remoteContent, 'base64').toString('utf-8');
        } catch {
          continue;
        }

        fs.mkdirSync(localDir, { recursive: true });

        if (fs.existsSync(localPath)) {
          const localContent = fs.readFileSync(localPath, 'utf-8');
          if (localContent !== remoteContent) {
            fs.writeFileSync(localPath, remoteContent);
            updatedFiles++;
            console.log(`  ~ Updated: ${file.path}`);
          }
        } else {
          fs.writeFileSync(localPath, remoteContent);
          newFiles++;
          console.log(`  + New: ${file.path}`);
        }
      }
    } catch (e) {
      // Directory might not exist in repo or be nested — skip gracefully
      continue;
    }
  }

  // 5. Merge CLAUDE.md
  const mergeFiles = manifest.mergeFiles || [];
  if (mergeFiles.includes('CLAUDE.md')) {
    try {
      const remoteClaude = execSync(`gh api repos/${repo}/contents/CLAUDE.md --jq .content`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const templateContent = Buffer.from(remoteClaude, 'base64').toString('utf-8');
      const localClaude = path.join(PROJECT_DIR, 'CLAUDE.md');

      if (fs.existsSync(localClaude)) {
        const { mergeCLAUDEmd } = require('./merge-claude-md');
        const currentContent = fs.readFileSync(localClaude, 'utf-8');
        const merged = mergeCLAUDEmd(currentContent, templateContent);
        if (merged !== currentContent) {
          fs.writeFileSync(localClaude, merged);
          console.log('  CLAUDE.md sections updated');
        }
      }
    } catch { /* CLAUDE.md fetch failed — skip */ }
  }

  // 6. Merge settings.json
  if (mergeFiles.includes('.claude/settings.json')) {
    try {
      const remoteSettings = execSync(`gh api repos/${repo}/contents/.claude/settings.json --jq .content`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const templateSettings = JSON.parse(Buffer.from(remoteSettings, 'base64').toString('utf-8'));
      const localSettingsPath = path.join(PROJECT_DIR, '.claude/settings.json');

      if (fs.existsSync(localSettingsPath)) {
        const { mergeSettings } = require('./merge-settings');
        const currentSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
        const merged = mergeSettings(currentSettings, templateSettings);
        const mergedStr = JSON.stringify(merged, null, 2) + '\n';
        const currentStr = fs.readFileSync(localSettingsPath, 'utf-8');
        if (mergedStr !== currentStr) {
          fs.writeFileSync(localSettingsPath, mergedStr);
          console.log('  settings.json merged');
        }
      }
    } catch { /* settings fetch failed — skip */ }
  }

  // 7. Sync team-learnings.json (bidirectional)
  if (mergeFiles.includes('.claude/team-learnings.json')) {
    try {
      const remoteJson = execSync(`gh api repos/${repo}/contents/.claude/team-learnings.json --jq .content`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      const remoteData = JSON.parse(Buffer.from(remoteJson, 'base64').toString('utf-8'));
      const localPath = path.join(PROJECT_DIR, '.claude/team-learnings.json');

      if (fs.existsSync(localPath)) {
        const localData = JSON.parse(fs.readFileSync(localPath, 'utf-8'));

        // Merge: union by fingerprint
        const allFingerprints = new Set();
        const merged = [];

        for (const learning of [...localData.learnings, ...remoteData.learnings]) {
          if (!allFingerprints.has(learning.fingerprint)) {
            allFingerprints.add(learning.fingerprint);
            merged.push(learning);
          }
        }

        // Sort by confidence
        merged.sort((a, b) => b.confidence - a.confidence);

        const newFromRemote = merged.length - localData.learnings.length;
        if (newFromRemote > 0) {
          console.log(`  ${newFromRemote} new learnings synced from template`);
        }

        localData.learnings = merged;
        fs.writeFileSync(localPath, JSON.stringify(localData, null, 2) + '\n');
      }
    } catch { /* team-learnings fetch failed — skip */ }
  }

  // 8. Sync knowledge-base.md from template
  try {
    const remoteKB = execSync(`gh api repos/${repo}/contents/.claude/knowledge-base.md --jq .content`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const templateKB = Buffer.from(remoteKB, 'base64').toString('utf-8');
    const localKBPath = path.join(PROJECT_DIR, '.claude/knowledge-base.md');

    if (fs.existsSync(localKBPath)) {
      const localKB = fs.readFileSync(localKBPath, 'utf-8');
      // Simple merge: if template has entries the local doesn't, append them
      // Use [Source:] tags to identify entries
      const templateEntries = templateKB.match(/### .+\n[\s\S]*?\[Source:.*?\]/g) || [];
      const localEntries = localKB.match(/### .+\n[\s\S]*?\[Source:.*?\]/g) || [];
      const localSources = new Set(localEntries.map(e => e.match(/\[Source:.*?\]/)?.[0]).filter(Boolean));

      let kbUpdated = false;
      let updatedKB = localKB;
      for (const entry of templateEntries) {
        const source = entry.match(/\[Source:.*?\]/)?.[0];
        if (source && !localSources.has(source)) {
          // Find the right section and append
          const category = entry.startsWith('### Security') ? 'Hard Rules' :
                          entry.startsWith('### Workflow') ? 'Hard Rules' :
                          'Patterns';
          const sectionMarker = `## ${category}`;
          const idx = updatedKB.indexOf(sectionMarker);
          if (idx > -1) {
            const insertAt = updatedKB.indexOf('\n', idx) + 1;
            updatedKB = updatedKB.slice(0, insertAt) + '\n' + entry + '\n' + updatedKB.slice(insertAt);
            kbUpdated = true;
          }
        }
      }

      if (kbUpdated) {
        fs.writeFileSync(localKBPath, updatedKB);
        console.log('  knowledge-base.md synced with new entries');
      }
    }
  } catch { /* knowledge-base fetch failed — skip */ }

  // 9. Update manifest
  manifest.lastUpdated = new Date().toISOString();
  manifest.version = latestVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // 10. Summary
  console.log(`\nUpdate complete!`);
  console.log(`   Files updated: ${updatedFiles}`);
  console.log(`   Files added: ${newFiles}`);
  console.log(`   Version: ${manifest.version}\n`);
}

/**
 * Update Cortex from a local template directory (used by npx cortex-init --update).
 * Same merge logic as update(), but reads files from disk instead of GitHub API.
 *
 * @param {string} templateDir - Path to the template source (the npm package root)
 * @param {string} projectDir - Path to the target project
 */
async function updateFromLocal(templateDir, projectDir) {
  projectDir = path.resolve(projectDir);
  templateDir = path.resolve(templateDir);

  // 1. Read project manifest
  const manifestPath = path.join(projectDir, '.claude-template.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('No .claude-template.json found. Install Cortex first: npx cortex-init');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // 2. Read template version
  const templateManifestPath = path.join(templateDir, '.claude-template.json');
  if (!fs.existsSync(templateManifestPath)) {
    console.error('Template source not found at:', templateDir);
    process.exit(1);
  }
  const templateManifest = JSON.parse(fs.readFileSync(templateManifestPath, 'utf-8'));
  const latestVersion = templateManifest.version;

  console.log(`\nClaude Cortex Update — ${manifest.version} → ${latestVersion}\n`);

  // 3. Update template-owned files
  const { getAllFiles } = require('./install');
  const templateOwned = manifest.templateOwned || [];
  let updatedFiles = 0;
  let newFiles = 0;

  for (const dir of templateOwned) {
    const srcDir = path.join(templateDir, dir);
    const destDir = path.join(projectDir, dir);
    if (!fs.existsSync(srcDir)) continue;

    const files = getAllFiles(srcDir);
    for (const file of files) {
      const relativePath = path.relative(srcDir, file);
      const destFile = path.join(destDir, relativePath);

      const remoteContent = fs.readFileSync(file, 'utf-8');

      fs.mkdirSync(path.dirname(destFile), { recursive: true });

      if (fs.existsSync(destFile)) {
        const localContent = fs.readFileSync(destFile, 'utf-8');
        if (localContent !== remoteContent) {
          fs.writeFileSync(destFile, remoteContent);
          updatedFiles++;
          console.log(`  ~ Updated: ${dir}${relativePath}`);
        }
      } else {
        fs.writeFileSync(destFile, remoteContent);
        newFiles++;
        console.log(`  + New: ${dir}${relativePath}`);
      }
    }
  }

  // 4. Merge CLAUDE.md
  const mergeFiles = manifest.mergeFiles || [];
  if (mergeFiles.includes('CLAUDE.md')) {
    const templateCLAUDE = path.join(templateDir, 'CLAUDE.md');
    const localCLAUDE = path.join(projectDir, 'CLAUDE.md');

    if (fs.existsSync(templateCLAUDE) && fs.existsSync(localCLAUDE)) {
      const { mergeCLAUDEmd } = require('./merge-claude-md');
      const templateContent = fs.readFileSync(templateCLAUDE, 'utf-8');
      const currentContent = fs.readFileSync(localCLAUDE, 'utf-8');
      const merged = mergeCLAUDEmd(currentContent, templateContent);
      if (merged !== currentContent) {
        fs.writeFileSync(localCLAUDE, merged);
        console.log('  CLAUDE.md sections updated');
      }
    }
  }

  // 5. Merge settings.json
  if (mergeFiles.includes('.claude/settings.json')) {
    const templateSettingsPath = path.join(templateDir, '.claude/settings.json');
    const localSettingsPath = path.join(projectDir, '.claude/settings.json');

    if (fs.existsSync(templateSettingsPath) && fs.existsSync(localSettingsPath)) {
      const { mergeSettings } = require('./merge-settings');
      const templateSettings = JSON.parse(fs.readFileSync(templateSettingsPath, 'utf-8'));
      const currentSettings = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
      const merged = mergeSettings(currentSettings, templateSettings);
      const mergedStr = JSON.stringify(merged, null, 2) + '\n';
      const currentStr = fs.readFileSync(localSettingsPath, 'utf-8');
      if (mergedStr !== currentStr) {
        fs.writeFileSync(localSettingsPath, mergedStr);
        console.log('  settings.json merged');
      }
    }
  }

  // 6. Sync team-learnings.json (bidirectional)
  if (mergeFiles.includes('.claude/team-learnings.json')) {
    const templateTLPath = path.join(templateDir, '.claude/team-learnings.json');
    const localTLPath = path.join(projectDir, '.claude/team-learnings.json');

    if (fs.existsSync(templateTLPath) && fs.existsSync(localTLPath)) {
      try {
        const remoteData = JSON.parse(fs.readFileSync(templateTLPath, 'utf-8'));
        const localData = JSON.parse(fs.readFileSync(localTLPath, 'utf-8'));

        const allFingerprints = new Set();
        const merged = [];

        for (const learning of [...localData.learnings, ...remoteData.learnings]) {
          if (!allFingerprints.has(learning.fingerprint)) {
            allFingerprints.add(learning.fingerprint);
            merged.push(learning);
          }
        }

        merged.sort((a, b) => b.confidence - a.confidence);

        const newFromRemote = merged.length - localData.learnings.length;
        if (newFromRemote > 0) {
          console.log(`  ${newFromRemote} new learnings synced from template`);
        }

        localData.learnings = merged;
        fs.writeFileSync(localTLPath, JSON.stringify(localData, null, 2) + '\n');
      } catch { /* team-learnings parse failed — skip */ }
    }
  }

  // 7. Sync knowledge-base.md
  const templateKBPath = path.join(templateDir, '.claude/knowledge-base.md');
  const localKBPath = path.join(projectDir, '.claude/knowledge-base.md');

  if (fs.existsSync(templateKBPath) && fs.existsSync(localKBPath)) {
    try {
      const templateKB = fs.readFileSync(templateKBPath, 'utf-8');
      const localKB = fs.readFileSync(localKBPath, 'utf-8');

      const templateEntries = templateKB.match(/### .+\n[\s\S]*?\[Source:.*?\]/g) || [];
      const localEntries = localKB.match(/### .+\n[\s\S]*?\[Source:.*?\]/g) || [];
      const localSources = new Set(localEntries.map(e => e.match(/\[Source:.*?\]/)?.[0]).filter(Boolean));

      let kbUpdated = false;
      let updatedKB = localKB;
      for (const entry of templateEntries) {
        const source = entry.match(/\[Source:.*?\]/)?.[0];
        if (source && !localSources.has(source)) {
          const category = entry.startsWith('### Security') ? 'Hard Rules' :
                          entry.startsWith('### Workflow') ? 'Hard Rules' :
                          'Patterns';
          const sectionMarker = `## ${category}`;
          const idx = updatedKB.indexOf(sectionMarker);
          if (idx > -1) {
            const insertAt = updatedKB.indexOf('\n', idx) + 1;
            updatedKB = updatedKB.slice(0, insertAt) + '\n' + entry + '\n' + updatedKB.slice(insertAt);
            kbUpdated = true;
          }
        }
      }

      if (kbUpdated) {
        fs.writeFileSync(localKBPath, updatedKB);
        console.log('  knowledge-base.md synced with new entries');
      }
    } catch { /* knowledge-base parse failed — skip */ }
  }

  // 8. Update manifest
  manifest.lastUpdated = new Date().toISOString();
  manifest.version = latestVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // 9. Summary
  console.log(`\nUpdate complete!`);
  console.log(`   Files updated: ${updatedFiles}`);
  console.log(`   Files added: ${newFiles}`);
  console.log(`   Version: ${manifest.version}\n`);
}

// CLI
if (require.main === module) {
  update().catch(e => {
    console.error('Update failed:', e.message);
    process.exit(1);
  });
}

module.exports = { update, updateFromLocal };
