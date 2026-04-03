# Cross-Model Workflow — Claude Code + Codex CLI

> Nutze zwei verschiedene KI-Modelle die sich gegenseitig pruefen.
> Ein Modell kann Fehler machen, ein anderes findet sie.
> Quelle: Boris Cherny (Claude Code Team)

## Warum zwei Modelle?

Boris: "Using separate context windows makes the result even better.
One agent can cause bugs and another (using the same model) can find them.
Using a DIFFERENT model makes it even stronger."

```
Claude Code (Opus 4.6)     — Plant und implementiert
Codex CLI (GPT-5.4)        — Reviewed und verifiziert

Zwei verschiedene Modelle = zwei verschiedene "Denkweisen"
= Fehler die Claude uebersieht, findet Codex (und umgekehrt)
```

## Der 4-Schritt Flow

```
┌─────────────────────────────────────────────────────┐
│ SCHRITT 1: PLAN                                     │
│ Tool: Claude Code (Terminal 1)                      │
│ Modell: Opus 4.6                                    │
│                                                     │
│ → Plan Mode (Shift+Tab 2x)                          │
│ → Claude interviewt dich (AskUserQuestion)           │
│ → Erstellt phasenweisen Plan mit Test-Gates           │
│ → Output: plans/feature-name.md                      │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│ SCHRITT 2: QA REVIEW                                │
│ Tool: Codex CLI (Terminal 2)                        │
│ Modell: GPT-5.4                                     │
│                                                     │
│ → Codex liest den Plan + die Codebase                │
│ → Fuegt Zwischen-Phasen ein ("Phase 2.5")            │
│ → Markiert Findings mit "Codex Finding"              │
│ → WICHTIG: Fuegt hinzu, ueberschreibt NIE            │
│ → Output: Plan mit Codex-Ergaenzungen                │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│ SCHRITT 3: IMPLEMENT                                │
│ Tool: Claude Code (Terminal 1, neue Session)        │
│ Modell: Opus 4.6                                    │
│                                                     │
│ → Implementiert Phase fuer Phase                     │
│ → Test-Gate nach jeder Phase                         │
│ → Beruecksichtigt Codex-Findings                     │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│ SCHRITT 4: VERIFY                                   │
│ Tool: Codex CLI (Terminal 2, neue Session)          │
│ Modell: GPT-5.4                                     │
│                                                     │
│ → Vergleicht Implementation gegen Plan               │
│ → Prueft ob alle Phasen umgesetzt wurden             │
│ → Prueft ob Tests bestehen                           │
│ → Final verdict: PASS / FAIL                         │
└─────────────────────────────────────────────────────┘
```

## Setup

### Voraussetzungen

1. **Claude Code** (hast du schon)
2. **Codex CLI** installieren:
   ```bash
   npm install -g @openai/codex
   ```
3. **OpenAI API Key** setzen:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

### Terminal-Layout

Zwei Terminals nebeneinander:
- **Terminal 1 (links):** Claude Code — plant und implementiert
- **Terminal 2 (rechts):** Codex CLI — reviewed und verifiziert

## Schritt-fuer-Schritt Anleitung

### Schritt 1: Plan (Claude Code)

```bash
# Terminal 1
claude
# Dann in Plan Mode:
# Shift+Tab 2x (oder /plan)

# Beschreibe das Feature:
"Ich moechte User-Authentifizierung mit OAuth2 bauen"

# Claude erstellt einen phasenweisen Plan
# Plan wird gespeichert in plans/auth-feature.md
```

### Schritt 2: QA Review (Codex CLI)

```bash
# Terminal 2
codex "Review the plan at plans/auth-feature.md against the codebase.
For each phase, check:
1. Are the proposed changes technically sound?
2. Are there edge cases the plan misses?
3. Are there security concerns?

If you find issues, INSERT new intermediate phases (e.g., Phase 2.5)
with 'Codex Finding:' headings. NEVER rewrite original phases."
```

### Schritt 3: Implement (Claude Code)

```bash
# Terminal 1 (neue Session)
claude
"Implement the plan at plans/auth-feature.md.
Work phase by phase. After each phase, run tests.
Pay special attention to Codex Findings."
```

### Schritt 4: Verify (Codex CLI)

```bash
# Terminal 2 (neue Session)
codex "Verify the implementation against plans/auth-feature.md.
Check:
1. Were all phases implemented?
2. Do all tests pass?
3. Were Codex Findings addressed?
Verdict: PASS or FAIL with details."
```

## Wann nutzen?

| Situation | Cross-Model? | Warum |
|-----------|-------------|-------|
| Kritisches Feature (Auth, Payment) | Ja | Sicherheit braucht zweite Meinung |
| Grosse Refactors | Ja | Regressionen frueh finden |
| Einfaches Feature | Nein | Overkill, normaler Pipeline reicht |
| Bug Fix | Nein | Zu klein fuer Cross-Model |

## Tipps

- **Codex fuegt hinzu, ueberschreibt nie** — die Review-Phasen ("Phase 2.5") ergaenzen den Plan
- **Neue Session fuer Schritt 3** — frischer Context fuer die Implementation
- **Test-Gates sind pflicht** — nach jeder Phase muessen Tests bestehen
- **Codex Findings priorisieren** — sie zeigen blinde Flecken von Claude
