# Claude Cortex — Starter Team Template

Shared learning system, hooks, and agents for Claude Code teams.

<!-- CORTEX:TOP_RULES:START -->
## Top Rules

<important>
- MUST: Explain every change in simple, non-technical language (3-5 sentences)
- MUST: Ask before deleting files or removing features
- MUST: Follow the full pipeline: Coder → Test-Runner → Code-Review → Sanity Check
- MUST: Never commit directly to main/master — always use feature branches
- MUST: Before saying "done" or "fertig" — run tests, verify changes work, show proof to the user
- MUST: For multi-step tasks — ask the user after each milestone before continuing
</important>
<!-- CORTEX:TOP_RULES:END -->

<!-- CORTEX:PIPELINE:START -->
## Development Pipeline

Every coding task follows this flow. No exceptions.

```
1. Plan Mode        → Discuss requirements, design, get approval
2. core--coder      → Write code + basic tests, commit
3. core--test-runner → Run ALL tests, find edge cases
4. core--code-review → Fresh eyes on quality + security
5. sanity-check     → Does everything fit together?
6. Done             → Merge
```

Details: @.claude/rules/agent-routing.md
<!-- CORTEX:PIPELINE:END -->

<!-- CORTEX:AGENTS:START -->
## Agents (17)

| Agent | Purpose |
|-------|---------|
| **core--coder** | Writes code + tests. Dispatch for tasks >10 lines. |
| **core--test-runner** | Tests everything. MANDATORY after every coder task. |
| **core--code-review** | Reviews code quality. MANDATORY after test-runner. |
| **pre--architect** | Deep analysis before complex features. Runs in worktree. |
| **fix--error-translator** | Translates errors into simple explanations + fixes. |
| **fix--root-cause-finder** | Finds the root cause of bugs, not just symptoms. |
| **start--onboarding** | One-time codebase scan for new projects. |
| **start--daily** | Morning routine — `claude --agent=daily-start` |
| **util--pr-writer** | Writes PR descriptions from git diff. |
| **util--drift-agents** | Drift check: new agent frontmatter fields. |
| **util--drift-skills** | Drift check: new skill fields + bundled skills. |
| **util--drift-commands** | Drift check: new command fields + built-in commands. |
| **util--drift-settings** | Drift check: new settings, hook events, env vars. |
| **util--drift-features** | Drift check: new Claude Code features/concepts. |
| **rpi--requirement-parser** | RPI: Parses feature requests into structured requirements. |
| **rpi--product-manager** | RPI: Writes user stories, PRDs, acceptance criteria. |
| **rpi--ux-designer** | RPI: Creates UI flows, wireframes, UX designs. |
<!-- CORTEX:AGENTS:END -->

<!-- CORTEX:SKILL_ROUTING:START -->
## Skill Routing

| User says... | Action |
|---|---|
| "Build feature X", code task | → Plan Mode → core--coder pipeline |
| UI/Design/Website | → Design flow (@.claude/rules/design-flow.md) |
| "New project" | → project-discovery → scaffolding |
| "Colors/fonts/style?" | → ui-ux-pro-max skill |
| Error/Bug | → fix--error-translator + fix--root-cause-finder |
| "Check everything" | → sanity-check skill |
<!-- CORTEX:SKILL_ROUTING:END -->

## Tech Stack

<!-- Update this when installing Cortex into a new project -->
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (>=18) |
| Language | TypeScript / JavaScript |
| Database | SQLite (sql.js) for learnings, Cloudflare D1 for bot analytics |
| Bot Framework | grammy (Telegram), Cloudflare Workers |
| Bot Hosting | Cloudflare Workers + KV + D1 |
| Testing | Vitest / Jest |
| Linting | ESLint / Biome |
| Version Control | Git + GitHub |
| CI/CD | GitHub Actions (planned), Coolify on Hetzner (planned) |
| Design | Google Stitch, Tailwind CSS |

<!-- CORTEX:COMMANDS:START -->
## Commands (18)

| Command | Purpose |
|---------|---------|
| `/start` | Morning routine — load context, show open tasks |
| `/wrap-up` | End of day — save learnings, prepare for tomorrow |
| `/health` | Verify Cortex is correctly installed and working |
| `/changelog` | Generate changelog from git history |
| `/audit` | Review and approve pending learnings |
| `/learn` | Search past learnings |
| `/onboard` | First-time codebase scan |
| `/new-project` | Start a new project from scratch |
| `/metrics` | Code metrics — LOC, complexity, coverage, deps |
| `/template-update` | Update Cortex to latest version |
| `/drift-check` | Check for new Claude Code features we don't use yet |
| `/build-feature` | Main entry point for building anything (Plan → Choose strategy → Execute) |
| `/loop-simplify` | Recurring code cleanup every 30 min |
| `/loop-watch-tests` | Recurring test runner every 10 min |
| `/loop-health` | Recurring health check every hour |
| `/rpi-research` | RPI Phase 1: Research feasibility → GO/NO-GO verdict |
| `/rpi-plan` | RPI Phase 2: Plan with parallel agents → pm.md, ux.md, eng.md |
| `/rpi-implement` | RPI Phase 3: Phase-by-phase implementation with test-gates |
<!-- CORTEX:COMMANDS:END -->

<!-- CORTEX:COMMUNICATION:START -->
## Communication

- Explain EVERY code change: what changed + why, in simple language
- Use analogies for technical concepts
- Ask before making assumptions
- Warn before breaking changes — wait for explicit approval
<!-- CORTEX:COMMUNICATION:END -->

<!-- CORTEX:GIT:START -->
## Git

- Branch naming: feature/description, fix/description
- Commit messages: <type>: <description> (feat, fix, refactor, docs, test, chore)
- MUST: Review `git diff` before committing — check for hardcoded values and secrets
- MUST: Checkpoint commit before large refactors
<!-- CORTEX:GIT:END -->

<!-- CORTEX:REFERENCES:START -->
## Reference Rules

@.claude/rules/agent-routing.md — Development pipeline and agent dispatch rules
@.claude/rules/design-flow.md — Design workflow (Stitch vs local)
@.claude/rules/code-quality.md — Code quality standards
@.claude/rules/security.md — Security + input sanitization
@.claude/rules/git-workflow.md — Git best practices
@.claude/rules/web-development.md — Frontend + backend patterns
@.claude/rules/testing.md — Testing pyramid
@.claude/rules/learning-system.md — Learning system (correction detection, SQLite DB)
@.claude/rules/non-programmer.md — Communication rules for non-programmers
@.claude/rules/accessibility.md — Accessibility standards
@.claude/rules/browser-use.md — Browser Use CLI commands
@docs/GUIDE-WORKING-WITH-CLAUDE.md — Team guide for effective AI collaboration (Boris Best Practices)
<!-- CORTEX:REFERENCES:END -->
