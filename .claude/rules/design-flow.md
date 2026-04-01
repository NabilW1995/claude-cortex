---
description: Design workflow - Stitch vs Local, step-by-step process for UI/design tasks
---

# Design-Flow (MUST follow bei jeder UI/Design-Aufgabe)

## Schritt 1: User fragen — Welcher Weg?
MUST: Bei JEDER Design/UI-Aufgabe ZUERST den User fragen:

**Option A: Google Stitch** (empfohlen für ganze Seiten & Websites)
- High-Fidelity Designs werden in Stitch generiert
- Nutzt die Stitch MCP Verbindung + Skills
- Ergebnis: Professionelle Screens die in Code umgesetzt werden

**Option B: Lokales Design** (für schnelle Komponenten & kleine Änderungen)
- Claude designt direkt im Code
- Nutzt frontend-design + ui-ux-pro-max Skills
- Ergebnis: Code-first, schneller bei kleinen Aufgaben

## Schritt 2A: Google Stitch Workflow (wenn Option A gewählt)
1. `enhance-prompt` Skill aktivieren — User-Idee in präzisen Stitch-Prompt verwandeln
2. `taste-design` Skill aktivieren — Premium Design-Regeln laden (Anti-Generic)
3. `stitch-design` Skill aktivieren — Screen(s) in Stitch generieren via MCP
4. User reviewed das Design in Stitch (https://stitch.withgoogle.com/)
5. Bei Genehmigung:
   - `design-md` Skill → Design-System als DESIGN.md dokumentieren
   - `react:components` Skill → Stitch-Screens zu React-Komponenten umwandeln (wenn React)
   - Oder manuell: Code basierend auf DESIGN.md schreiben
6. `browser-use screenshot` → Visuelles Review des fertigen Codes
7. Für mehrseitige Websites: `stitch-loop` Skill nutzen (automatisiert Screen für Screen)

## Schritt 2B: Lokaler Design Workflow (wenn Option B gewählt)
1. `frontend-design` Skill aktivieren — Design-Philosophie laden
2. `ui-ux-pro-max` Skill aktivieren — 67 Styles, 96 Paletten, 57 Font-Pairings
3. User nach Präferenzen fragen (Style, Farben, Stimmung)
4. 2-3 Optionen zeigen (nie einfach eine aufzwingen)
5. Auf Genehmigung warten
6. Code schreiben
7. `browser-use screenshot` → Visuelles Review

## Design-Regeln (gelten für BEIDE Wege)
- MUST: Keine generische AI-Optik (purple gradients, Inter font, card layouts)
- MUST: `taste-design` Regeln beachten — kein Neon, kein #000000, keine generischen Placeholder
- MUST: Visuelles Review via Browser Use vor Abschluss
- MUST: Bei shadcn/ui Nutzung → `shadcn-ui` Skill aktivieren
