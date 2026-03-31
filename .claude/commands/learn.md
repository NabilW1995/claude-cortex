# Learnings anzeigen und suchen

Zeige gespeicherte Learnings aus der SQLite Datenbank.

## Anweisungen

Wenn ohne Argument aufgerufen:
- Zeige die letzten 10 Learnings mit Kategorie und Confidence
- Zeige Statistiken: Gesamt-Learnings, pro Projekt, meistgenutzte

Wenn mit Suchbegriff aufgerufen ($ARGUMENTS):
- Nutze FTS5 Volltextsuche in der SQLite DB
- Zeige relevante Learnings sortiert nach BM25 Ranking
- Zeige auch verwandte Learnings

## Beispiele
- /learn → Zeige alle Learnings
- /learn login → Suche Learnings zum Thema Login
- /learn css centering → Suche Learnings zu CSS Zentrierung
