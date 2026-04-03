# Compounding Engineering — Team lernt automatisch

> Jede Korrektur die ein Teammitglied bekommt, wird zur Regel fuer alle.
> Quelle: Boris Cherny (Claude Code Team)

## Der Kreislauf

```
Teammitglied wird korrigiert
  → "Nein, das soll anders sein"
  → Claude speichert Learning (SQLite DB)
  → Learning wird zur Nomination
  → /audit → User approved → Knowledge Base
  → team-learnings.json wird via Git gepusht
  → Alle Teammitglieder bekommen das Learning beim naechsten /start
```

## Level 2: @claude auf PRs (optional)

Installiere die Claude GitHub App fuer automatische CLAUDE.md Updates:

1. Gehe zu: https://github.com/apps/claude
2. Installiere fuer dein Repository
3. In PRs: Tagge @claude mit "Update CLAUDE.md based on these changes"
4. Claude analysiert den Code-Diff und schlaegt CLAUDE.md-Regeln vor

### Beispiel

```
PR: "Fix login validation — was checking email format wrong"

@claude: "Based on this fix, I suggest adding to CLAUDE.md:
- Email validation: use RFC 5322 regex, not simple @ check
- Always validate on server AND client"
```

## Unser System vs. Boris

| Boris | Wir |
|-------|-----|
| Manuell "Update CLAUDE.md" | Automatisch via Learning System |
| @claude auf PRs | @claude auf PRs (optional) |
| Team teilt CLAUDE.md via Git | Team teilt team-learnings.json + knowledge-base.md via Git |

Wir sind **besser** weil unser System Korrekturen automatisch erkennt (prompt-submit.js Hook) statt darauf zu warten dass jemand manuell "update CLAUDE.md" sagt.

## Setup

1. Learning System ist bereits aktiv (continuous-learning Skill)
2. Team-Sync ist bereits aktiv (sync-team-learnings.js Hook)
3. Optional: Claude GitHub App installieren fuer PR-basierte Updates
