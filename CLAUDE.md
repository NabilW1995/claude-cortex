# Claude Cortex — Starter Team Template

Shared learning system, hooks, and agents for Claude Code teams.

<!-- CORTEX:TOP_RULES:START -->
## Top Rules

<important>
- MUST: Explain every change in simple, non-technical language (3-5 sentences)
- MUST: Ask before deleting files or removing features
- MUST: Follow the full pipeline: Coder → Test-Runner → Code-Review → Sanity Check
- MUST: Never commit directly to main/master — always use feature branches
- MUST: Before saying "done" — run tests, verify changes work, show proof to the user
- MUST: For multi-step tasks — ask the user after each milestone before continuing
</important>
<!-- CORTEX:TOP_RULES:END -->

<!-- CORTEX:PIPELINE:START -->
## Development Pipeline

```
Plan Mode → core--coder → core--test-runner → core--code-review → sanity-check → Done
```

The pipeline runs automatically. Agents dispatch themselves based on the task.
For complex features: `/rpi-research` → `/rpi-plan` → `/rpi-implement`

Details: @.claude/rules/agent-routing.md
<!-- CORTEX:PIPELINE:END -->

<!-- CORTEX:AGENTS:START -->
## Agents

The pipeline agents (coder, test-runner, code-review) dispatch automatically.
All other agents dispatch when needed. See `.claude/agents/` for full list.

| Category | Agents | When |
|----------|--------|------|
| **Core Pipeline** | coder, test-runner, code-review | Every coding task (automatic) |
| **Analysis** | pre--architect | Before complex features |
| **Fix** | error-translator, root-cause-finder | When errors or bugs occur |
| **RPI** | requirement-parser, product-manager, ux-designer | During /rpi workflow |
| **Drift** | 5 parallel agents | During /drift-check |
| **Utility** | pr-writer, onboarding, daily-start | As needed |
<!-- CORTEX:AGENTS:END -->

<!-- CORTEX:SKILL_ROUTING:START -->
## Skill Routing

Skills trigger automatically based on what you say. No need to memorize commands.

| You say... | What happens |
|---|---|
| "Build feature X" / "Ich hab eine Idee" | → /build-feature (Plan → Strategy → Execute) |
| "Check everything" / "Passt alles?" | → sanity-check |
| "New project" / "Neues Projekt" | → project-discovery → scaffolding |
| Design / Colors / UI | → frontend-design + ui-ux-pro-max |
| Error / Bug | → error-translator + root-cause-finder |
| "Test in browser" / "Screenshot" | → browser-use |
<!-- CORTEX:SKILL_ROUTING:END -->

## Tech Stack

<!-- Auto-detected by install.js from package.json. This is a placeholder. -->
<!-- The installer replaces this with the actual project stack. -->
| Layer | Technology |
|-------|-----------|
| Runtime | (auto-detected) |
| Language | (auto-detected) |
| Testing | (auto-detected) |

<!-- CORTEX:COMMANDS:START -->
## Commands

**Daily:** `/start` · `/wrap-up` · `/audit` · `/learn`
**Build:** `/build-feature` · `/rpi-research` · `/rpi-plan` · `/rpi-implement`
**Quality:** `/health` · `/sanity-check` · `/metrics` · `/drift-check`
**Loops:** `/loop-simplify` · `/loop-watch-tests` · `/loop-health`
**Setup:** `/new-project` · `/onboard` · `/template-update` · `/changelog`
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
@docs/GUIDE-WORKING-WITH-CLAUDE.md — Team guide for effective AI collaboration
<!-- CORTEX:REFERENCES:END -->
