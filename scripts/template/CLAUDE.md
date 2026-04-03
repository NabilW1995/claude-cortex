# Template Install/Update System

Scripts for installing and updating Claude Cortex in projects via `npx cortex-init`.

## Key Files
- `install.js` — Main install logic. Copies template files, merges CLAUDE.md and settings.json
- `update.js` — Update logic. `update()` uses gh CLI, `updateFromLocal()` uses local files
- `merge-claude-md.js` — CORTEX marker-based merge (template sections vs project content)
- `merge-settings.js` — Deep merge for settings (union arrays, template env wins)
- `sync-check.js` — Checks npm registry for new versions (30-min cache)

## CORTEX Marker System
Template sections in CLAUDE.md are wrapped in markers:
`<!-- CORTEX:SECTION_NAME:START -->` and `<!-- CORTEX:SECTION_NAME:END -->`
During updates, only marked sections are replaced — project content stays untouched.

## Ownership Model (.claude-template.json)
- `templateOwned`: directories fully managed by template (rules, agents, commands, skills, hooks, db)
- `projectOwned`: files the project controls (CLAUDE.local.md, knowledge-base, .mcp.json)
- `mergeFiles`: files that get smart-merged (CLAUDE.md, settings.json, team-learnings.json)

## Rules
- NEVER change merge logic without running the tests in __tests__/
- `getAllFiles()` is exported from install.js — used by updateFromLocal()
- The postinstall guard in package.json prevents db:init from running during npx download
- install.js resolves TEMPLATE_DIR as path.resolve(__dirname, '..', '..') — the npm package root
