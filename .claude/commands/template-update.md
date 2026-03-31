# Template Update

Update Claude Cortex to the latest version from GitHub.

## Anweisungen

1. Prüfe ob `.claude-template.json` existiert
2. Wenn nicht: Sage dem User:
   "Dieses Projekt nutzt noch kein Claude Cortex.
   Installiere mit: `node scripts/template/install.js`"
3. Zeige aktuelle Version: `node -e "console.log(require('./.claude-template.json').version)"`
4. Führe aus: `node scripts/template/update.js`
5. Zeige dem User was sich geändert hat (Output des Scripts)
6. Bei neuen Learnings: Frage ob `/audit` laufen soll
7. Empfehle `npm install` wenn neue Dependencies hinzugekommen sind

## Beispiele
- /template-update → Aktualisiert auf die neueste Version
