# Learnings reviewen und genehmigen

Review pending Knowledge-Nominations und promote genehmigte Learnings zur Knowledge-Base.

## Anweisungen

1. Öffne die SQLite Datenbank (~/.claude-learnings/learnings.db) mit Python
2. Lade alle pending Nominations (JOIN mit learnings Tabelle)
3. Wenn keine pending Nominations: Melde "Keine offenen Nominations" und zeige Statistik
4. Für JEDE pending Nomination zeige:
   ```
   --- Nomination #[id] ---
   Kategorie: [category]
   Projekt: [project oder "global"]
   Confidence: [confidence]

   Regel: [rule]
   Regel (EN): [rule_en]
   Fehler: [mistake]
   Korrektur: [correction]
   ```
5. Frage den User bei JEDER Nomination: "Genehmigen oder ablehnen?"
6. Bei Genehmigung:
   - Setze nomination status auf 'approved', reviewed_at und promoted_at auf jetzt
   - Erhöhe confidence um 0.2 (max 1.0)
   - Füge das Learning in .claude/knowledge-base.md ein mit Format:
     ```
     ### [Category]: [Rule]
     - Fehler: [mistake]
     - Korrektur: [correction]
     - [Source: learning-db #ID, approved DATE]
     ```
   - Aktualisiere .claude/knowledge-nominations.md (unter "Recently Approved")
7. Bei Ablehnung:
   - Setze nomination status auf 'rejected', reviewed_at auf jetzt
   - Reduziere confidence um 0.1
   - Frage nach Begründung (reviewer_notes)
   - Aktualisiere .claude/knowledge-nominations.md (unter "Recently Rejected")
8. Am Ende: Zeige Zusammenfassung (X genehmigt, Y abgelehnt)

## Wichtig
- MUST: Zeige dem User jedes Learning einzeln — nicht alle auf einmal
- MUST: Warte auf User-Entscheidung bei jedem Learning
- MUST: Erkläre in einfacher Sprache was das Learning bedeutet
- MUST: Synchronisiere DB und Markdown-Dateien
- Die Datenbank liegt unter: ~/.claude-learnings/learnings.db (SQLite, via Python zugreifen)
- Nutze Python mit sqlite3 Modul (kein sqlite3 CLI verfügbar)
