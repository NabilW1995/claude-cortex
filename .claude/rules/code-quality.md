---
description: Code quality standards - style matching, DRY, TypeScript, error handling
globs: "src/**/*"
---

# Code-Qualität

- Match den existierenden Stil des Repos — auch wenn er nicht perfekt ist
- Check ob Logik schon existiert bevor du neue schreibst (DRY)
- Einfache Funktionen mit einem Zweck — keine Multi-Mode-Funktionen
- TypeScript strict mode wenn TS genutzt wird — kein `any` Typ
- Fehler explizit werfen — nie stillschweigend schlucken
- Error-Messages: klar, actionable, mit Kontext (was ging schief, wo, warum)
- Keine generischen Catch-All Exception Handler
