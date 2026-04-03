---
description: "Use when user says 'update cortex', 'template update', 'neue Version?', or '/template-update'. Updates Cortex to latest version."
---

# Template Update

Update Claude Cortex to the latest version.

## Anweisungen

1. Prüfe ob `.claude-template.json` existiert
2. Wenn nicht: Sage dem User:
   "Dieses Projekt nutzt noch kein Claude Cortex.
   Installiere mit: `npx cortex-init`"
3. Zeige aktuelle Version: `node -e "console.log(require('./.claude-template.json').version)"`
4. Primäre Methode (empfohlen): `npx cortex-init@latest --update`
5. Fallback (wenn npm nicht funktioniert): `node scripts/template/update.js` (benötigt `gh` CLI)
6. Zeige dem User was sich geändert hat (Output des Scripts)
7. Bei neuen Learnings: Frage ob `/audit` laufen soll
8. Empfehle `npm install` wenn neue Dependencies hinzugekommen sind

8. Nach dem Update: Frage ob der Drift-Detektor laufen soll (`util--drift-detector` Agent) um zu prüfen ob neue Claude Code Features verfügbar sind

## Beispiele
- /template-update → Aktualisiert auf die neueste Version
- Nach dem Update → "Soll ich prüfen ob es neue Claude Code Features gibt?" → Drift-Detektor Agent starten
