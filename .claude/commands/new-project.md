---
description: "Use when user says 'neues Projekt', 'new project', 'I want to build something', 'lass uns was bauen'. Starts the project discovery interview."
---

# New Project Discovery

Starte den Project Discovery Prozess für ein neues Projekt.

## Anweisungen

1. Lies die aktuelle CLAUDE.md und .claude/memory.md
2. Lade relevante Learnings aus der SQLite DB
3. Aktiviere den Project Discovery Skill (.claude/skills/project-discovery/SKILL.md)
4. Führe das Interview durch (10-20 Fragen, eine nach der anderen)
5. Empfehle einen Tech-Stack basierend auf den Antworten
6. Warte auf Genehmigung
7. Aktiviere den Scaffolding Skill (.claude/skills/scaffolding/SKILL.md)
8. Frage: "Soll ich ein Git-Repository erstellen?"
9. Frage: "Soll ich Preview Deployments einrichten? (Vercel/Netlify)"
10. Führe Cleanup durch — lösche alles was nicht gebraucht wird
11. Fülle CLAUDE.md mit projekt-spezifischen Informationen aus
12. Erstelle den ersten Git-Commit

## Wichtig
- Stelle ALLE Fragen bevor du anfängst zu bauen
- Erkläre jede Empfehlung in einfacher Sprache
- Warte auf explizites OK bevor du scaffoldest
