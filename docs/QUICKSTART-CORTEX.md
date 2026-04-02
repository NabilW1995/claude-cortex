# Claude Cortex — Quickstart Guide

> Shared learning system, hooks, and agents for Claude Code teams.

---

## 1. Install Cortex into an existing project

Open a terminal in your project folder:

```bash
git clone --depth 1 https://github.com/NabilW1995/claude-cortex.git .cortex-temp && node .cortex-temp/scripts/template/install.js . && rm -rf .cortex-temp
```

Then:
```bash
npm install                    # sql.js for the learning database
npm run db:init                # Initialize learning database
```

Optional — Google Stitch for design:
```bash
cp .mcp.json.example .mcp.json    # Copy MCP config, add your Stitch API key
```

---

## 2. What happens automatically

After installation, these hooks run in the background on every Claude Code session:

| When | What happens |
|------|-------------|
| **Session start** | Load learnings, check .env, send Telegram notification |
| **Every prompt** | Detect corrections, search relevant learnings |
| **Before Bash** | Block dangerous commands (rm -rf, force push, secrets) |
| **After Write/Edit** | Auto-lint, security scan, run related tests |
| **On error** | Log and categorize failures |
| **Before compaction** | Save session state |
| **Session end** | Export learnings, send Telegram summary |

**You don't need to do anything.** It just works.

---

## 3. Development Pipeline

Every coding task follows this flow automatically:

```
1. Plan Mode        → Discuss requirements, get approval
2. core--coder      → Write code + tests, commit
3. core--test-runner → Run ALL tests, find edge cases
4. core--code-review → Fresh eyes on quality + security
5. sanity-check     → Does everything fit together?
6. Done             → Merge
```

### Agents (8)

| Agent | Purpose |
|-------|---------|
| **core--coder** | Writes code + tests |
| **core--test-runner** | Tests everything (mandatory after coder) |
| **core--code-review** | Reviews quality (mandatory after test-runner) |
| **pre--architect** | Deep analysis before complex features |
| **fix--error-translator** | Translates errors into simple language |
| **fix--root-cause-finder** | Finds bug root causes |
| **start--onboarding** | One-time codebase scan |
| **util--pr-writer** | Writes PR descriptions |

---

## 4. Daily workflow

### Morning
```
/start          → Load yesterday's context, show open tasks
```

### During work
```
Plan Mode       → Discuss what to build, then agents handle it
/audit          → Review and approve learnings
```

### Evening
```
/wrap-up        → Save learnings, prepare for tomorrow
```

### As needed
```
/onboard        → First time in a new codebase
/new-project    → Start a new project from scratch
/template-update → Update Cortex to latest version
/learn          → Search past learnings
```

---

## 5. Learning System

The system learns from every conversation. Your only job:

**Step 1: Correct when something is wrong**
- "No, that should be blue, not red"
- "That doesn't work"
- "Wrong, I wanted it different"

**Step 2: Confirm when it works**
- "Perfect, exactly like that"
- "Works now"

Claude extracts the learning, saves it to the database, and asks:
"Should this become a permanent rule?"

### How learnings flow

| What | When | How |
|------|------|-----|
| Save to DB | After your confirmation | SQLite database |
| Share with team | On session end | Git push of team-learnings.json |
| Load relevant ones | On every prompt | Hook searches the DB |
| Import from teammates | On session start | Git pull of team-learnings.json |
| Decay unused ones | After 6 months | Confidence decay |

---

## 6. Update Cortex

```bash
npm run cortex:update
```
Or in chat: `/template-update`

What happens:
1. Fetches latest version from GitHub
2. Downloads new rules, hooks, agents
3. Smartly merges CLAUDE.md (your project sections stay)
4. Smartly merges settings.json (your hooks stay)
5. Imports new team learnings

---

## 7. Start a new project

```
/new-project
```

Claude interviews you:
1. What do you want to build?
2. Which features? (auth, database, payments)
3. Design approach? (Stitch or local)
4. Tech stack recommendation
5. Project is scaffolded with Cortex pre-installed
6. CLAUDE.md Tech Stack is auto-filled

---

## 8. Telegram Bot (optional)

Connect your project to a Telegram group for team coordination.
See `docs/QUICKSTART-TELEGRAM.md` for setup.

Features: Live dashboard, session tracking, /tasks, /active, /grab, stale PR alerts.

---

## 9. File Overview

```
Your Project/
├── CLAUDE.md                     ← Project rules + tech stack
├── CLAUDE.local.md               ← Personal overrides (gitignored)
├── .claude/
│   ├── agents/ (8)               ← Specialized AI agents
│   ├── commands/ (7)             ← Slash commands (/start, /audit, etc.)
│   ├── skills/ (7)               ← Skills (design, scaffolding, learning, etc.)
│   ├── rules/ (11)               ← Rules (security, git, testing, etc.)
│   ├── settings.json             ← Hooks + permissions
│   ├── knowledge-base.md         ← Approved rules
│   ├── knowledge-nominations.md  ← Pending learnings
│   ├── team-learnings.json       ← Team sync via git
│   └── memory.md                 ← Current session state
├── scripts/
│   ├── hooks/                    ← Automatic quality + security checks
│   ├── bot/                      ← Telegram bot notifications
│   ├── db/                       ← SQLite learning database
│   └── template/                 ← Install/update/merge scripts
├── worker/                       ← Telegram bot Cloudflare Worker
└── docs/                         ← Quickstarts, design docs, diagrams
```

---

## 10. FAQ

**"Does Cortex overwrite my existing files?"**
No. The install script merges intelligently. Your CLAUDE.md, settings.json, and agents are preserved.

**"Does it work on Windows?"**
Yes. All hooks use Windows-compatible commands. `PYTHONIOENCODING=utf-8` is set for Browser Use.

**"Do I need Stitch?"**
No. You can design locally with `frontend-design` + `ui-ux-pro-max` skills.

**"What does it cost?"**
Cortex is free (open source). You only need a Claude Code subscription.
