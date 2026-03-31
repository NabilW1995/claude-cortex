---
description: Browser Use CLI commands and rules for E2E testing and visual review
globs: "**/*.{test,spec}.{ts,tsx,js,jsx}"
---

# Browser Use CLI

## Commands
`browser-use doctor`              # Installation prüfen
`browser-use open <url>`          # Seite öffnen
`browser-use state`               # Sichtbare Elemente + Indizes anzeigen
`browser-use screenshot [path]`   # Screenshot machen
`browser-use click <index>`       # Element klicken
`browser-use input <index> "text"` # Text eingeben
`browser-use scroll down|up`      # Scrollen
`browser-use eval "js code"`      # JavaScript ausführen
`browser-use --headed open <url>` # Browser sichtbar öffnen
`browser-use close --all`         # Alle Sessions schließen

## Regeln
- MUST: Browser Use statt Playwright für alle E2E Tests und visuelles Review
- MUST: Nach jedem Design-Build → `browser-use screenshot` zur Kontrolle
- MUST: `PYTHONIOENCODING=utf-8` setzen auf Windows (Emoji-Fix)
- Sessions bleiben persistent — kein Neustart nötig zwischen Befehlen
- Docs: https://docs.browser-use.com/open-source/browser-use-cli
