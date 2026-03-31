# Hook Scripts — Input-Dokumentation

## Wie Hooks funktionieren
Claude Code ruft Hooks bei bestimmten Events auf. Hooks bekommen JSON-Daten via **stdin** (nicht als Argument!).

## Input-Format pro Hook-Typ

### UserPromptSubmit
```json
{"prompt": "User-Eingabe als Text", "content": "..."}
```
Scripts: `prompt-submit.js`, `tdd-reminder.js`

### PreToolUse (Bash)
```json
{"tool": "Bash", "command": "git status"}
```
Scripts: `guard-bash.sh`, `test-existence-check.sh`, `sync-team-learnings.js`

### PreToolUse (Write|Edit)
```json
{"tool": "Write", "file_path": "/path/to/file.ts", "content": "...", "new_string": "..."}
```
Scripts: `backup-before-write.sh`, `completeness-gate.sh`

### PostToolUse (Write|Edit)
```json
{"tool": "Edit", "file_path": "/path/to/file.ts", "content": "...", "new_string": "..."}
```
Scripts: `post-edit-lint.sh`, `security-scan.sh`, `log-changes.sh`, `auto-test.sh`

### PostToolUseFailure
```json
{"tool": "Bash", "error": "Fehlermeldung"}
```
Scripts: `log-failures.sh`

### SessionStart
Kein stdin-Input. Nutzt Umgebungsvariablen.
Scripts: `session-start.js`, `sync-team-learnings.js import`, `post-compact.sh`

### PreCompact
Kein stdin-Input.
Scripts: `pre-compact.sh`

### Stop
Kein stdin-Input.
Scripts: `session-end.js`

## Wichtige Umgebungsvariablen
- `CLAUDE_PROJECT_DIR` — Pfad zum Projekt-Verzeichnis

## Exit-Codes
- `0` — OK, weitermachen
- `2` — Hook BLOCKIERT die Aktion (nur PreToolUse)

## Neuen Hook erstellen
1. Script in `scripts/hooks/` anlegen
2. Erste Zeile: `#!/bin/bash` (oder `#!/usr/bin/env node`)
3. Input lesen: `read -r INPUT` (bash) oder stdin-Handler (Node.js)
4. JSON parsen: `VALUE=$(echo "$INPUT" | sed -n 's/.*"key"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)`
5. In `.claude/settings.json` unter dem passenden Event registrieren
