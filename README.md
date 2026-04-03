# Claude Cortex

**The collective brain for Claude Code — install once, every project gets smarter.**

```bash
npx cortex-init
```

One command. Your project gets 16 agents, 19 commands, 8 skills, 22 hooks, and a learning system that makes Claude better with every correction.

---

## What It Does

**Cortex turns any project into an Enterprise-grade Claude Code workspace.**

| Feature | What happens |
|---------|-------------|
| **Automatic Pipeline** | Every code task flows through: Coder → Tests → Review → Sanity Check |
| **Learning System** | Claude learns from your corrections. What one person teaches, the whole team knows. |
| **Security Hooks** | Blocks `rm -rf`, force push, exposed secrets — before they happen |
| **RPI Workflow** | Research → Plan → Implement with validation gates for complex features |
| **Drift Detection** | Checks if Claude Code has new features your template doesn't use yet |
| **Smart Permissions** | Auto-allows safe commands, asks for dangerous ones, blocks destructive ones |

## Quick Start

```bash
# Install into any existing project
cd your-project/
npx cortex-init

# Start your day
/start

# Build something
/build-feature

# End your day
/wrap-up
```

## How It Works

```
You say something
  → Claude recognizes the intent
  → Triggers the right skill/agent automatically
  → Pipeline runs (code → test → review → sanity check)
  → You approve at each milestone
  → Done
```

You don't need to memorize commands. Say "check everything" and sanity-check runs. Say "I have an idea" and the build workflow starts. Say "was gibt es neues?" and drift-check runs.

## What's Inside

### 16 Agents

| Category | Agents | Purpose |
|----------|--------|---------|
| Core Pipeline | coder, test-runner, code-review | Automatic quality pipeline |
| Analysis | architect | Deep dive before complex features |
| Fix | error-translator, root-cause-finder | When things break |
| RPI | requirement-parser, product-manager, ux-designer | Structured feature development |
| Drift | 5 parallel agents | Check for new Claude Code features |
| Utility | pr-writer, onboarding | As needed |

### 19 Commands

**Daily:** `/start` `/wrap-up` `/audit` `/learn`
**Build:** `/build-feature` `/rpi-research` `/rpi-plan` `/rpi-implement`
**Quality:** `/health` `/sanity-check` `/metrics` `/drift-check`
**Loops:** `/loop-simplify` `/loop-watch-tests` `/loop-health`
**Setup:** `/new-project` `/onboard` `/template-update` `/changelog`

### 8 Skills (trigger automatically)

| Say this... | Skill triggers |
|------------|---------------|
| "check everything" | sanity-check |
| "build me a page" | frontend-design |
| "new project" | project-discovery |
| "how should this look?" | ui-ux-pro-max |
| "test in browser" | browser-use |
| *(corrections)* | continuous-learning |

### 22 Hooks (run in background)

Security scan, auto-format, guard-bash, backup, learning detection, permission router, stop-prompts, and more. All automatic — you don't configure anything.

## Workflows

### Simple Feature
```
/build-feature → Plan Mode → Choose strategy → Execute
```

### Complex Feature (RPI)
```
/rpi-research → GO/NO-GO → /rpi-plan → 3 agents parallel → /rpi-implement → phase by phase
```

### Critical Feature (Cross-Model)
```
Claude plans → Codex reviews → Claude implements → Codex verifies
```

See [docs/](docs/) for detailed workflow guides.

## Learning System

The unique differentiator. Claude learns from every correction:

```
You correct Claude → Learning saved to SQLite DB
  → Shared with team via Git
  → Loaded in every future session
  → Decays if unused (6 months)
```

Run `/audit` to review and approve learnings. Run `/learn` to search past learnings.

## Update

```bash
npx cortex-init@latest --update
```

Updates template files while preserving your project content (CORTEX markers in CLAUDE.md ensure clean merges).

Auto-publish: When we push a new version, GitHub Actions publishes to npm. Your projects see "Update available" at next `/start`.

## Requirements

- Node.js >= 18
- Claude Code CLI
- Git

## Optional

- Telegram Bot ([setup guide](docs/QUICKSTART-TELEGRAM.md))
- Google Stitch for design (`cp .mcp.json.example .mcp.json`)
- Codex CLI for cross-model review (`npm i -g @openai/codex`)

## Documentation

| Doc | Purpose |
|-----|---------|
| [QUICKSTART-CORTEX.md](docs/QUICKSTART-CORTEX.md) | Installation and first steps |
| [GUIDE-WORKING-WITH-CLAUDE.md](docs/GUIDE-WORKING-WITH-CLAUDE.md) | Team guide — how to work effectively |
| [WORKFLOW-RPI.md](docs/WORKFLOW-RPI.md) | Research → Plan → Implement |
| [WORKFLOW-CROSS-MODEL.md](docs/WORKFLOW-CROSS-MODEL.md) | Claude + Codex together |
| [WORKFLOW-COMPOUNDING-ENGINEERING.md](docs/WORKFLOW-COMPOUNDING-ENGINEERING.md) | Team learning cycle |

## License

MIT
