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

// CLI
if (require.main === module) {
  update().catch(e => {
    console.error('Update failed:', e.message);
    process.exit(1);
  });
}

module.exports = { update };
