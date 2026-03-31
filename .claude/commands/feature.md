# Neues Feature bauen

Starte den Feature-Workflow mit Branch und Preview-Link.

## Anweisungen

1. Frage: "Was möchtest du bauen? Beschreib es in deinen Worten."
2. Lade relevante Learnings aus SQLite per FTS5-Suche
3. Frage: "Soll ich einen neuen Branch dafür aufmachen?"
4. Wenn ja: `git checkout -b feature/[beschreibung]`
5. Erstelle einen Plan und warte auf Genehmigung
6. Implementiere in kleinen Schritten mit Tests
7. Nach Completion:
   - Pushe den Branch
   - Zeige Preview-Link (Vercel/Netlify)
   - Frage: "Schau es dir an — passt das so?"
8. Bei Feedback → iteriere
9. Wenn User zufrieden: "Soll ich den Branch in main mergen?"
10. Erstelle PR und merge

## Wichtig
- MUST: Immer Branch erstellen, nie direkt auf main
- MUST: Preview-Link nach Push zeigen
- MUST: Auf User-Feedback warten vor Merge
- MUST: Tests schreiben und laufen lassen
