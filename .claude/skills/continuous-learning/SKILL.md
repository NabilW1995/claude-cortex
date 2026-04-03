---
name: continuous-learning
description: "Use whenever: user corrects Claude ('nein','falsch','wrong','not like that'), confirms something works ('perfect','genau so','exactly'), or says 'save as rule'. Triggers on corrections and confirmations in both German and English."
---

# Continuous Learning System

## How It Works

This system learns from every conversation. When you make a mistake and the user corrects you, the system captures what went wrong and what the right approach is. Next time a similar situation comes up, the system reminds you of the lesson — so the same mistake never happens twice.

Think of it as a team notebook: every correction becomes a lesson, every lesson helps everyone on the team.

## The Learning Cycle

```
User gives task → Claude tries → User corrects → Claude fixes → User confirms
                                      ↓                              ↓
                              Correction detected              Learning extracted
                              (Hook + Claude)                  (saved to SQLite DB)
                                                                     ↓
                                                              User asked: "Soll das
                                                              eine feste Regel werden?"
                                                                  ↓           ↓
                                                              Approved    Rejected
                                                                  ↓
                                                          knowledge-base.md
                                                          (permanent rule)
```

## Stage 1: Detection

### How Corrections Are Detected

Two systems work together — hooks provide signals, Claude provides understanding:

**Hook-based detection** (prompt-submit.js, runs automatically):
The hook scans every user message for correction patterns and success patterns. It tracks a correction streak — 3 in a row suggests rephrasing, 5+ suggests pre--architect for root-cause analysis.

**Claude-based detection** (inline, in the conversation):
Claude recognizes corrections that go beyond simple keywords:
- User describes a problem with what Claude just did
- User shows how it should be done instead
- User's tone shifts from positive to frustrated
- User repeats a request with different wording (sign that the first attempt failed)

### Correction Patterns

**German — Corrections:**
nein, falsch, stimmt nicht, passt nicht, immer noch nicht, nicht richtig, anders, mach das nicht, stop, warte, rückgängig, zurück, funktioniert nicht, geht nicht, klappt nicht, hat nicht geklappt

**English — Corrections:**
no, wrong, that's not right, incorrect, undo, revert, don't do that, stop, not working, still broken, try again, that didn't work

**German — Success:**
perfekt, genau, funktioniert, super, passt, endlich, ja genau so, toll, sieht gut aus, stimmt jetzt, richtig so, jetzt geht's, klasse, wunderbar, prima

**English — Success:**
perfect, exactly, works, great, nice, that's it, looks good, finally, correct, awesome, yes, nailed it

### Task-Relevant Learning Search (prompt-submit.js)

On every new prompt, the hook:
1. Extracts keywords (filters out common stop words in DE + EN)
2. Searches the SQLite DB using LIKE-based pattern matching
3. Returns the top 3-5 most relevant learnings based on confidence and times_applied
4. Marks each returned learning as "applied" (incrementing times_applied)

This means Claude gets reminded of relevant past lessons before starting any new task.

## Stage 2: Extraction & Storage

### When to Extract a Learning

Extract a learning when ALL of these are true:
1. Claude made an attempt that was wrong or suboptimal
2. The user corrected it (explicitly or by showing the right way)
3. The correction was applied and confirmed to work

Do NOT extract learnings from:
- Simple misunderstandings about requirements (not a pattern)
- One-time project-specific decisions (not generalizable)
- User preferences that change frequently

### How to Extract

When a correction→success cycle is detected, Claude extracts:

| Field | What to capture | Example |
|-------|----------------|---------|
| `rule` | The lesson in one sentence | "Login-Token muss HttpOnly Cookie sein, nicht localStorage" |
| `mistake` | What was done wrong | "Token in localStorage gespeichert — XSS-Risiko" |
| `correction` | The right approach | "express-session mit cookie:{httpOnly:true, secure:true}" |
| `category` | Topic area | Auth, CSS, Security, Git, Testing, UI, Backend, etc. |
| `project` | Current project name | "webshop" or null for global lessons |
| `confidence` | How certain (0.0-1.0) | 0.8 for first occurrence |

### Bilingual Storage (Team Feature)

Every learning is stored in BOTH German and English:
- `rule` + `rule_en`
- `mistake` + `mistake_en`
- `correction` + `correction_en`

The original language goes in the main field, the translation in the `_en` field. This way teammates in different countries can read the learnings in their language.

### SQLite Database

Location: `~/.claude-learnings/learnings.db` (global, shared across all projects on this machine)

**Save a learning via Python:**
```python
import sqlite3, os
db_path = os.path.join(os.path.expanduser('~'), '.claude-learnings', 'learnings.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("""INSERT INTO learnings 
  (project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
  [project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, 0.8])
learning_id = c.lastrowid
c.execute("INSERT INTO nominations (learning_id, status) VALUES (?, 'pending')", [learning_id])
conn.commit()
conn.close()
```

### Inline Approval Flow

After saving a learning, immediately ask the user:

```
📝 Learning gespeichert:
  Regel: [rule]
  Fehler: [mistake]  
  Korrektur: [correction]

Soll das eine feste Regel werden? (Genehmigen / Ablehnen)
```

- **Approved** → Add to `.claude/knowledge-base.md` with `[Source: learning-db #ID]` tag, set nomination to 'approved', increase confidence by 0.2
- **Rejected** → Set nomination to 'rejected', decrease confidence by 0.1, ask for reason

This replaces the old workflow where learnings sat in a queue until someone ran `/audit`. The `/audit` command still exists as a fallback for reviewing older pending nominations.

## Stage 3: Knowledge Promotion

### Confidence System

| Confidence | Meaning | How it changes |
|-----------|---------|---------------|
| 0.8 | New learning (default) | Set on creation |
| +0.2 | User approved it | Via inline approval or /audit |
| -0.1 | User rejected it | Via inline approval or /audit |
| -0.1 | Not applied for 6+ months | Automatic decay (session-start.js) |
| 1.0 | Maximum — proven rule | After multiple approvals |
| <0.1 | Archived — no longer relevant | Automatic cleanup |

### Cross-Project Promotion

When the same lesson appears in 2+ different projects (matched by similar rule text), its confidence is boosted to 0.9 — it's a candidate for a global rule that applies everywhere.

### Team Sync

Learnings are shared with teammates via `team-learnings.json`:
- **Export:** High-confidence learnings (≥0.7) are exported to `.claude/team-learnings.json` with a unique fingerprint
- **Import:** At session start, new learnings from teammates are imported into the local DB
- **Auto-push:** At session end, changes are committed and pushed to the project repo
- **Deduplication:** Fingerprints prevent the same learning from being imported twice

## Commands

| Command | What it does |
|---------|-------------|
| `/learn` | Show recent learnings and statistics |
| `/learn <keyword>` | Search learnings by topic |
| `/audit` | Review and approve/reject pending nominations |
| `/template-update` | Sync learnings with the Cortex template repo |

## Escalation Chain

When corrections pile up, the system escalates:

```
Correction 1-2:  Normal — Claude tries again
Correction 3:    pre--architect agent — helps articulate the real problem
Correction 4:    (pre--architect continues)
Correction 5+:   fix--root-cause-finder agent — root-cause analysis
```

## Rules

- Extract learnings in simple, non-technical language — the user is not a programmer
- Always capture BOTH the problem AND the solution — one without the other is useless
- Always tag with project name for cross-project analysis
- Always store bilingually (German + English) for team sharing
- Never store sensitive data (API keys, passwords, personal info) in learnings
- Don't force more than 10 learnings per session — quality over quantity
- Ask for approval immediately — don't defer to a separate audit step
- When a learning is surfaced during a task, acknowledge it briefly: "Basierend auf einem früheren Learning: [rule]"

## Gotchas

- SQLite DB path is ~/.claude-learnings/learnings.db — make sure directory exists
- Always save learnings bilingually (German + English) for team sharing
- Confidence decay runs on session start — old unused learnings lose relevance after 6 months
- Never skip the nomination step — always ask user if learning should become permanent
