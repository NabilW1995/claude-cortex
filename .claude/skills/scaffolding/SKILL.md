---
name: scaffolding
description: >
  Set up a new project based on discovery interview results, install Claude Cortex, and prepare
  everything for development. Use this skill after project-discovery completes and the user
  approves the tech stack, or when the user says "Erstelle das Projekt", "Set it up",
  "Projekt aufsetzen", "Initialize the project", "Scaffold it". Also use when the user has
  a clear tech stack in mind and wants to jump straight to setup without a full discovery interview.
---

# Project Scaffolding Skill

## Purpose

Turn a project brief into a fully working, ready-to-develop project. This includes creating the codebase, installing dependencies, setting up Cortex (agents, hooks, learnings), configuring deployment, and making sure everything actually runs.

## Input

Read the project brief from `.claude/project-brief.json` (created by the project-discovery skill). If it doesn't exist, ask the user for the minimum information needed:
- Project name
- Framework (Next.js, Vite, etc.)
- Key features (auth, database, payments)

## The Scaffolding Process

### Step 1: Create Project with CLI Tool

Use the right tool for the job:

| Framework | Command | Notes |
|-----------|---------|-------|
| Next.js | `npx create-next-app@latest [name] --typescript --tailwind --eslint --app --src-dir` | Empfohlen für Full-Stack |
| Vite + React | `npm create vite@latest [name] -- --template react-ts` | Für SPAs |
| Vite + Vue | `npm create vite@latest [name] -- --template vue-ts` | Vue-Alternative |
| Vite + Svelte | `npm create vite@latest [name] -- --template svelte-ts` | Svelte-Alternative |
| Nuxt | `npx nuxi init [name]` | Vue Full-Stack |
| SvelteKit | `npm create svelte@latest [name]` | Svelte Full-Stack |
| Astro | `npm create astro@latest [name]` | Content-Sites |
| Expo (React Native) | `npx create-expo-app [name] --template tabs` | Mobile Apps |
| Express API | Manuelles Scaffold (siehe unten) | Reines Backend |
| FastAPI | Manuelles Scaffold (siehe unten) | Python Backend |
| Django | `django-admin startproject [name]` | Python Full-Stack |

After creation, `cd` into the project directory.

### Step 2: Install Dependencies

Based on the project brief, install what's needed — and nothing more:

**Auth (wenn gewählt):**
| Option | Package | Warum |
|--------|---------|-------|
| NextAuth.js | `next-auth` | Gut für Next.js, viele Provider |
| Better Auth | `better-auth` | Modern, TypeScript-first |
| Clerk | `@clerk/nextjs` | Hosted, schnellster Start |
| Lucia | `lucia` | Leichtgewichtig, flexibel |

**Datenbank (wenn gewählt):**
| Option | Packages | Warum |
|--------|----------|-------|
| PostgreSQL + Prisma | `prisma @prisma/client` | Beliebtestes ORM, gute DX |
| PostgreSQL + Drizzle | `drizzle-orm drizzle-kit` | Leichter, SQL-näher |
| SQLite + Drizzle | `drizzle-orm better-sqlite3` | Für kleine Projekte, kein Server nötig |
| MongoDB | `mongoose` | Für dokumentenbasierte Daten |

**UI (wenn gewählt):**
| Option | Setup | Warum |
|--------|-------|-------|
| shadcn/ui | `npx shadcn-ui@latest init` | Flexibel, anpassbar, empfohlen |
| Tailwind CSS | Meist schon dabei | Utility-first, schnell |
| Material UI | `@mui/material @emotion/react` | Google Design |

**Testing:**
| Tool | Package | Für |
|------|---------|-----|
| Vitest | `vitest @vitest/coverage-v8` | Unit + Integration |
| Browser Use CLI | Globale Installation | E2E Tests + visuelles Review |

**Payments (wenn gewählt):**
- `stripe @stripe/stripe-js` für Frontend + Backend

**Email (wenn gewählt):**
- `resend` (empfohlen) oder `nodemailer`

### Step 3: Create Project Structure

Create directories that match the framework:

```
[project-name]/
├── src/
│   ├── app/              # Next.js App Router / Pages
│   ├── components/       # UI Komponenten
│   ├── lib/              # Utility Functions
│   ├── hooks/            # Custom Hooks (React)
│   ├── types/            # TypeScript Types
│   └── styles/           # CSS / Tailwind
├── tests/
│   ├── unit/             # Unit Tests
│   ├── integration/      # API Tests
│   └── e2e/              # Browser Use E2E Tests
├── public/               # Statische Assets
├── docs/                 # Projekt-Dokumentation
│   └── plans/            # Implementierungspläne
├── .env.example          # Umgebungsvariablen (ohne echte Werte)
└── .env.local            # Echte Werte (gitignored)
```

### Step 4: Install Claude Cortex

This is where our template system gets installed into the new project:

```bash
git clone --depth 1 https://github.com/NabilW1995/claude-cortex.git .cortex-temp && node .cortex-temp/scripts/template/install.js . && rm -rf .cortex-temp
```

This adds:
- `.claude/rules/` — 11 rules (security, testing, design-flow, etc.)
- `.claude/agents/` — 8 agents (core--coder, core--test-runner, core--code-review, etc.)
- `.claude/commands/` — 7 commands (/start, /audit, /learn, etc.)
- `scripts/hooks/` — Auto-lint, auto-test, security scan, heartbeat, etc.
- `scripts/db/` — SQLite learning database
- `scripts/bot/` — Telegram bot notifications
- Smart merge of CLAUDE.md and settings.json

After install, run:
```bash
npm install          # sql.js dependency
npm run db:init      # Initialize learning database
```

### Step 5: Update CLAUDE.md

Fill in the real project info:

1. **Project name and description** at the top
2. **Tech Stack table** — update with actual technologies chosen:
```markdown
## Tech Stack
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (>=18) |
| Framework | [Next.js / Vite+React / SvelteKit / etc.] |
| Language | TypeScript |
| Database | [PostgreSQL+Prisma / SQLite+Drizzle / etc.] |
| Auth | [NextAuth / Clerk / Better Auth / none] |
| UI | [shadcn/ui / Tailwind / Material UI] |
| Testing | Vitest |
| Hosting | [Vercel / Netlify / Coolify on Hetzner] |
```
3. **Commands** — actual dev/build/test/lint commands

Also update `.claude-template.json` with the project name.

### Step 6: Git Setup

```bash
git init
git add -A
git commit -m "feat: initial project setup with Claude Cortex"
```

If the user wanted a GitHub repo:
```bash
gh repo create [name] --public/--private --source . --push
```

### Step 7: Deployment Setup (wenn gewählt)

| Platform | Command | Preview-Links |
|----------|---------|---------------|
| Vercel | `npx vercel` | Automatisch bei jedem Push |
| Netlify | `npx netlify-cli deploy` | Per CLI oder Git-Integration |
| Railway | `railway init && railway up` | Gut für Backend + DB |

### Step 8: Verify Everything Works

Run these checks:

```bash
npm run dev          # Startet das Projekt?
npm run build        # Baut es fehlerfrei?
npm run lint         # Keine Lint-Fehler?
```

Visual check with Browser Use:
```bash
browser-use open http://localhost:3000
browser-use screenshot project-setup.png
```

### Step 9: Handoff to User

Present a clear summary:

```
## Projekt ist fertig!

**Name:** [Projektname]
**Tech-Stack:** [Framework + DB + Auth + Hosting]
**Starten:** `npm run dev` → http://localhost:3000

### Was wurde erstellt
[Ordner-Übersicht mit Erklärung]

### Claude Cortex installed
- 8 agents ready (core--coder, core--test-runner, core--code-review, etc.)
- Learning DB active — learns from every conversation
- Auto hooks: lint, tests, security scan after every edit
- /start for day start, /wrap-up for day end, /audit for learnings

### Nächste Schritte
1. Design erstellen (Stitch oder lokal — sag "Bau mir die Startseite")
2. Erste Features implementieren
3. Preview-Link: [URL]

### Wichtige Commands
| Command | Was es macht |
|---------|-------------|
| `npm run dev` | Dev-Server starten |
| `/start` | Tagesbeginn-Ritual |
| `/audit` | Learnings reviewen |
| `/template-update` | Cortex aktualisieren |
```

## MCP Setup (wenn Stitch gewählt)

If the user chose Google Stitch for design, set up the MCP connection:

1. Copy `.mcp.json.example` to `.mcp.json`
2. Ask user for their Stitch API key
3. Fill in the key

## Rules

- Use native CLI tools whenever possible — don't reinvent what `create-next-app` already does
- Always validate that the scaffold actually works (`npm run dev` + `npm run build`)
- Install Cortex AFTER the framework scaffold — so the merge logic works correctly
- Update CLAUDE.md with the real project info — don't leave placeholders
- Explain everything in simple language — the user may not know what "scaffold" means
- Don't install packages the user didn't ask for — follow the minimal principle
- Always use latest stable versions — check with `npm view [package] version` if unsure
- Run env-validator after setup to confirm everything is correctly configured
