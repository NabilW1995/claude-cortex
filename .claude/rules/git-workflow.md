---
description: Git workflow and branch management rules
globs: "**/*"
---

# Git-Workflow Regeln

## Branches
- NEVER: Direkt auf main/master committen
- MUST: Feature-Branches nutzen: feature/beschreibung, fix/beschreibung
- MUST: Branch-Name beschreibt was gemacht wird
- NEVER: Force push — zerstört shared History und ist nicht umkehrbar

## Commits
- Format: <typ>: <beschreibung>
- Typen: feat, fix, refactor, docs, test, chore, perf, ci
- Beispiel: "feat: add contact form with email validation"
- Kleine, fokussierte Commits — ein Commit pro logischer Änderung
- MUST: Tests laufen lassen vor dem Commit
- MUST: `git diff` reviewen vor dem Commit

## Feature-Workflow
1. Neuer Branch: `git checkout -b feature/beschreibung`
2. Implementieren in kleinen Schritten
3. Tests schreiben und laufen lassen
4. Push: `git push -u origin feature/beschreibung`
5. Preview-Link an User zeigen
6. Auf Feedback warten
7. PR erstellen wenn User zufrieden
8. Merge nach Review

## Sicherheit
- MUST: Checkpoint-Commit vor großen Refactors
- MUST: Review changes mit `git diff` vor Commit
- NEVER: `git reset --hard` ohne explizite Anweisung
- NEVER: Commits mit Secrets — prüfe vor jedem Push
