# Cortex Team Bot v2 — Complete System Design

> **Purpose:** Complete specification for a Telegram-based team coordination system
> that tracks GitHub projects, shows team presence via Claude Code hooks,
> and provides on-demand information via inline buttons.

## Status: Draft — Pending Approval

---

## 1. Architecture

```
Claude Code Hooks ──┐
GitHub Webhooks ────┼── Cloudflare Worker ── Telegram
Coolify Webhooks ───┤   ├── KV Store          ├── Login & Info (Channel)
Cron Triggers ──────┘   ├── D1 SQLite         ├── Project A (Group + Bot)
                        └── grammy (Bot FW)    ├── Project B (Group + Bot)
                                               └── Project C (Group + Bot)
```

### Tech Stack

| Component | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Language | TypeScript |
| State (fast) | Cloudflare KV (sessions, user mapping, dashboard state, message threading) |
| State (history) | Cloudflare D1 SQLite (event log, session history, analytics) |
| Telegram | grammy (Telegram Bot Framework, CF Workers compatible) |
| GitHub | GitHub Webhooks + Octokit (for API calls) |
| Presence | Claude Code Hooks -> HTTP POST to Worker |
| Scheduling | Cloudflare Cron Triggers (digests, stale detection) |
| Deployments | Coolify Webhooks (Hetzner) |

### Bot Instances

- **1 Login/Status Bot** -> Central channel for team presence and daily overview
- **1 Bot per GitHub repo** -> Project-specific group for issues, PRs, activity

All bots run as routes within a single Cloudflare Worker.

---

## 2. Login & Info Channel — Team Cockpit

### 2.1 Automatic Push Messages

| Event | Message | Trigger |
|---|---|---|
| Session Start | `[green] Nabil is online -- working on project-a` | Claude Hook |
| Session Timeout (>8h no end) | `[warn] Nabil -- session open 8h without end signal` | Cron (30min) |
| Morning Digest (Mon-Fri 09:00) | Daily overview: who has what open, PRs pending, blockers | Cron |
| Evening Summary (18:00) | What was done today, what remains open | Cron |

Note: No "ended session" messages -- sessions auto-expire via KV TTL (2 hours).
Session-start refreshes the TTL. This prevents context compressions from generating false offline events.

### 2.2 Inline Buttons — Login Channel

Pinned control message:

```
[Who is on?]  [Today]
[Work Hours]  [All Tasks]
[Blockers]    [Open PRs]
```

**Button Actions:**

- **Who is on?** -- Live status of all team members (online/away/offline with color coding)
- **Today** -- Daily summary across ALL projects (issues opened/closed, PRs, team activity)
- **Work Hours** -- Session times per person with bar chart visualization
- **All Tasks** -- Aggregated open issues across all repos with urgency counts
- **Blockers** -- Everything blocking progress (stale PRs, blocked issues, merge conflicts)
- **Open PRs** -- Cross-repo PR overview with review status

### 2.3 Team Status Message Format

```
Team Status -- 02.04.2026

Online:
[yellow] Nabil -- Claude Cortex (since 14:15)
[blue] Sarah -- Passcraft (since 13:40)

Away:
[purple] Max -- last seen 12:00 (Prestige: auth flow)
[white] Lisa -- not seen today (last: 01.04, Passcraft #12)

Today:
* 4 issues opened, 5 closed
* 2 PRs merged, 4 open, 1 needs review (warning)
* 1 deploy successful (Passcraft -> live)

Activity:
* Nabil: 4 commits, 2 PRs merged
* Sarah: 3 issues closed, 1 review

Attention:
* PR #42 waiting for review >4h (no reviewer)
* Issue #18 labeled: blocked
* CI failed on Prestige
```

### 2.4 Projects Overview

```
All Projects:
* Claude Cortex: 12 open, 3 urgent, 1 PR waiting
* Passcraft: 8 open, 0 urgent, 2 PRs merged today
* Prestige: 5 open, 1 blocked, CI failing
```

---

## 3. Project Groups — Per Repo

### 3.1 GitHub Webhook Events (Push Notifications)

**Events that trigger immediate notifications:**

| GitHub Event | Message |
|---|---|
| issues.opened | `New Issue #34: "Login broken" by @nabil` |
| issues.closed | `Issue #34 closed by @sarah` |
| issues.assigned | `Issue #34 assigned to @max` |
| issues.labeled (urgent/blocked only) | `Issue #34 -> Label: "urgent"` |
| pull_request.opened | `New PR #42: "Auth refactor" by @nabil (12 files, +340/-120)` |
| pull_request.ready_for_review | `PR #42 is ready for review!` |
| pull_request.closed (merged) | `PR #42 merged! "Auth refactor" -> main` |
| pull_request.closed (not merged) | `PR #42 closed without merge` |
| pull_request_review.submitted | `@sarah approved PR #42` or `@sarah requested changes` |
| pull_request_review.requested | `@nabil needs review from @lisa on PR #42` |
| push (to main) | `3 new commits on main by @nabil` |
| workflow_run.completed (failed) | `CI failed for PR #42 -- Job: tests` |
| issues.milestoned | `Issue #34 -> Milestone "v2.1"` |

**Noise Filter (NOT pushed, available on-demand only):**
- Label changes on non-critical labels (e.g. "documentation")
- Issue comments (too much noise)
- Branch creation/deletion
- Draft PR updates
- Successful CI runs (only failures are pushed)

**Webhook Batching:**
- Incoming webhooks batched in 5-second window
- If >3 events of same type in 5 sec -> batch message:
  `@nabil labeled 12 issues with "sprint-5"`

### 3.2 Message Threading

All events related to the same PR/Issue are replied to the original message:
- First message about PR #42 = main message (store message_id in KV)
- All follow-up events = Telegram reply to that message
- Result: each PR/Issue has its own thread

KV key: `msg:project-a:pr:42 -> { telegram_message_id: 1234, chat_id: -100xxx }`

### 3.3 Inline Buttons — Project Groups

Pinned control message:

```
[Board]       [My Tasks]     [Open PRs]
[Needs Review] [Urgent]      [Milestone]
[Weekly Report]
```

**Button Actions:**

- **Board** -- Sprint/board view with columns (To Do / In Progress / In Review / Done)
- **My Tasks** -- PERSONALIZED: only shows tasks assigned to the Telegram user who pressed
- **Open PRs** -- All open PRs with CI status, review status, merge conflicts
- **Needs Review** -- PRs waiting for review with [Assign me] quick action button
- **Urgent** -- Priority/blocked filter showing critical items
- **Milestone** -- Current milestone progress with deadline and risk assessment
- **Weekly Report** -- Past week stats, contributors, velocity trend

### 3.4 Contextual Inline Buttons (under push notifications)

| Context | Button | Action |
|---|---|---|
| PR without reviewer | [I'll review this] | Assign caller as GitHub reviewer |
| PR approved, no conflicts | [Merge] | Trigger squash-merge |
| Unassigned issue | [I'll take this] | Assign caller to issue |
| Any PR/Issue message | [Open on GitHub] | Deep link |

### 3.5 Live Dashboard

One editable dashboard message per project (pinned):
- Shows online users with color coding
- Open tasks grouped by label with claimed indicators
- Auto-updates on session start/end and task claiming
- Inline buttons: Refresh, Active, Claim Tasks, Done

---

## 4. Presence System (Claude Code Hooks)

### 4.1 Session Events

**Session-Start Hook** sends POST to Worker:
```json
{
  "type": "start",
  "user": "Nabil",
  "project": "claude-cortex"
}
```

### 4.2 Heartbeat System

Claude Code hook sends ping every 15 minutes:
```json
{
  "type": "heartbeat",
  "user": "Nabil",
  "project": "claude-cortex"
}
```
- Refreshes session TTL in KV
- Updates "last seen" timestamp

### 4.3 Session Timeout Detection (Cron)

- Every 30 min: check open sessions
- Session >8h without heartbeat -> Warning in login channel
- Session >12h -> Mark as "forgotten", auto-close

### 4.4 TTL-Based Sessions

Sessions stored in KV with expirationTtl (2 hours).
Session-start and heartbeat refresh the TTL.
No explicit "end" removal needed -- prevents context compressions from falsely showing users offline.

---

## 5. Smart Alerts (Cron-Based)

| Alert | Interval | Action |
|---|---|---|
| Stale PR | every 2h | PR >4h without reviewer -> alert in project group |
| Stale PR escalation | every 2h | PR >24h without review -> mention all team members |
| Changes Requested stale | every 2h | PR with changes requested + no new commits 24h -> reminder to author |
| Merge Conflicts | on push to main | Check all open PRs for mergability via GitHub API |
| CI Failed | immediate | GitHub webhook -> alert |
| Session Timeout | every 30min | >8h -> warning, >12h -> auto-close |
| Daily Report | 18:00 | Daily summary -> login channel |
| Weekly Report | Friday 17:00 | Weekly report -> login channel |
| Morning Digest | 09:00 Mon-Fri | Overview for the day -> login channel |

---

## 6. Deploy Tracking (Coolify/Hetzner)

Coolify webhook -> Worker -> Telegram:

```
Deploy successful -- Passcraft
Preview: https://preview.passcraft.com
Live: https://passcraft.com
Changes: PR #5, #7 (Fix login, Add cart)
```

or

```
Deploy failed -- Passcraft
Error: Build failed at step 3
Logs: https://coolify.example.com/...
```

---

## 7. Review Flow (Semi-Automatic)

```
PR created
  -> Bot posts in project group with [I'll review this] button
  -> Someone clicks button -> Bot assigns reviewer on GitHub
  -> Reviewer submits review -> Bot posts result
  -> After approval -> Bot posts "approved"
  -> After merge -> Bot posts "merged!"
```

Stale PR detection ensures nothing falls through the cracks.

---

## 8. Reports

### Daily Report (18:00, Login Channel)

```
Daily Report -- 02.04.2026

Issues: 4 opened, 5 closed
PRs: 2 merged, 4 open
Commits: 23 across all repos

Top Activity:
  Nabil: 4 commits, 2 PRs merged
  Sarah: 3 issues closed, 1 review

Open Blockers: 1
Stale PRs (>4h): 1
```

### Weekly Report (Friday 17:00, Login Channel)

```
Weekly Report -- KW 14

Issues: 12 opened, 15 closed (+3 net)
PRs: 8 merged, 2 still open
Commits: 47 on main

Top Contributors:
  1. Sarah -- 6 issues closed, 3 PRs merged
  2. Nabil -- 4 issues closed, 3 PRs merged
  3. Max -- 3 issues closed, 1 PR merged

Velocity trend: +15% vs last week
```

---

## 9. Onboarding

New user joins group -> Bot sends:
```
Welcome! Please link your GitHub account:
/register your-github-username
```

Mapping stored in KV:
```
user:tg:12345 -> { github: "nabil-gh", name: "Nabil", timezone: "Europe/Berlin" }
user:gh:nabil-gh -> { telegram_id: 12345 }
```

---

## 10. User Color System

Each team member gets a consistent color emoji:
- User 1: yellow circle
- User 2: blue circle
- User 3: purple circle
- User 4: orange circle
- User 5: brown circle
- User 6: red circle
- User 7: green circle

Colors appear in dashboard, active status, and task claiming.

---

## 11. Priority System

GitHub Labels for prioritization (no sprints):
- `urgent` / `critical` -- red, appears in Blocker view
- `high` -- orange
- `medium` -- yellow (default)
- `low` -- gray

Bot sorts by priority in all task views.

---

## 12. Quiet Hours and DND

- Global quiet hours per group (e.g. 22:00-07:00) -- only urgent events pushed
- Personal: `/dnd 2h` -- bot doesn't ping you for 2 hours
- Cron digests respect timezones

---

## 13. Security

| Concern | Solution |
|---|---|
| GitHub Webhook Auth | HMAC-SHA256 signature verification |
| Claude Hook Auth | Bearer token in header (TEAM_BOT_SECRET) |
| Telegram Bot Token | Cloudflare Worker Secrets (not in code) |
| Telegram Groups | Invite-only, bot is admin |
| Button Actions | Verify Telegram user exists in mapping |
| GitHub API Token | Stored in Worker Secrets |

---

## 14. Data Model

### KV Store (fast access)

```
user:tg:12345          -> { github, name, timezone }
user:gh:nabil-gh       -> { telegram_id }
session:project:user   -> { since } (with TTL)
msg:project:pr:42      -> { telegram_message_id, chat_id }
msg:project:issue:34   -> { telegram_message_id, chat_id }
pin:project            -> { message_id }
pin:login              -> { message_id }
dnd:12345              -> { until }
dashboard:project      -> { messageId, activeSessions, lastUpdated }
```

### D1 SQLite (history and analytics)

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  project TEXT NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_minutes INTEGER
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_repo_date ON events(repo, created_at);
CREATE INDEX idx_sessions_user_date ON sessions(user_id, started_at);
```

---

## 15. Cron Schedule

```toml
[triggers]
crons = [
  "0 7 * * 1-5",    # Morning digest (09:00 CEST)
  "0 16 * * 1-5",   # Evening summary (18:00 CEST)
  "*/30 * * * *",   # Stale session check
  "0 */2 * * *",    # Stale PR check
  "0 15 * * 5"      # Weekly report (Friday 17:00 CEST)
]
```

---

## 16. Environment Variables

```toml
# wrangler.toml [vars]
TEAM_TIMEZONE = "Europe/Berlin"
QUIET_HOURS_START = "22"
QUIET_HOURS_END = "7"
STALE_PR_HOURS = 4
SESSION_TIMEOUT_HOURS = 8

# Secrets (via wrangler secret put)
# TELEGRAM_BOT_TOKEN_LOGIN
# TELEGRAM_BOT_TOKEN_<PROJECT>
# TELEGRAM_CHAT_ID_LOGIN
# TELEGRAM_CHAT_ID_<PROJECT>
# GITHUB_WEBHOOK_SECRET
# GITHUB_API_TOKEN
# TEAM_BOT_SECRET
```

---

## 17. Implementation Phases

### Phase 1 -- Foundation (rebuild current Worker)
1. Migrate to grammy framework
2. Set up D1 database + KV namespaces
3. Implement proper GitHub webhook signature verification
4. User mapping with onboarding flow
5. Pinned control messages with full button set

### Phase 2 -- GitHub Integration
6. All GitHub webhook events with noise filter
7. Message threading (reply chains per Issue/PR)
8. Webhook batching (5-second window)
9. Contextual inline buttons under push notifications
10. Deep links to GitHub in every message

### Phase 3 -- Presence and Sessions
11. Heartbeat system (15min ping from Claude hooks)
12. Session timeout detection (Cron)
13. Work hours tracking with D1 history
14. Live dashboard with auto-update

### Phase 4 -- Intelligence
15. Stale PR detection + reminders
16. Merge conflict detection
17. Morning/evening digest (Cron)
18. Weekly reports with velocity trends
19. CI/CD failure alerts

### Phase 5 -- Deploy Tracking
20. Coolify webhook integration
21. Preview URL + live URL in notifications
22. Deploy success/failure alerts

### Phase 6 -- Polish
23. Quiet hours and DND
24. Rate limiting and batching
25. Error handling and retry logic
26. Worker self-monitoring

---

## 18. What Already Exists (Built in Session 01.04.2026)

The following has already been built and deployed:
- Basic Cloudflare Worker with KV (cortex-team-bot.twilight-resonance-f2fc.workers.dev)
- Session tracking with KV TTL
- notify.js module for session start/end
- Live dashboard with inline buttons (Refresh, Active, Claim Tasks, Done)
- Reply keyboard (Dashboard, Active, Tasks, Who)
- /tasks, /grab, /done, /active, /wer, /new, /assign, /register commands
- GitHub issue fetching and display grouped by label
- Color-coded users
- Login channel + project group structure
- 43 GitHub issues created for project scope
- Categorized commit display (features/fixes/other)
- Branch status in notifications

### What Needs to be Rebuilt/Upgraded for v2:
- Migrate from raw Telegram API to grammy
- Add D1 for history/analytics
- Add webhook signature verification
- Add message threading
- Add webhook batching
- Add Cron triggers for digests and stale detection
- Add contextual buttons under push notifications
- Add heartbeat system
- Add Coolify integration
- Expand button set to full spec
