# Projekt-Cleanup

Entferne nicht benötigte Dateien und Abhängigkeiten.

## Anweisungen

1. Analysiere das aktuelle Projekt
2. Identifiziere:
   - Ungenutzte Dependencies in package.json
   - Leere Ordner
   - Template-Dateien die nicht angepasst wurden
   - Ungenutzte Konfigurationsdateien
3. Zeige eine Liste von Kandidaten zum Löschen
4. MUST: Frage explizit bevor IRGENDWAS gelöscht wird
5. Erstelle einen Commit nach dem Cleanup

## Wichtig
- NEVER: Lösche ohne Bestätigung
- NEVER: Lösche .env, .gitignore, CLAUDE.md oder .claude/
- Zeige für jede Datei WARUM sie nicht gebraucht wird
