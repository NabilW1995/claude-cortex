---
description: Continuous learning system - correction detection, learning extraction, inline approval, bilingual storage
---

# Lernsystem (Inline-Flow)

## Korrektur-Erkennung (durch Claude im Gespräch)
Claude erkennt selbst wenn eine Korrektur stattfindet — nicht nur über Hook-Patterns:
- User sagt "nein", "falsch", "nicht so", "das stimmt nicht", "anders"
- User beschreibt ein Problem mit dem was Claude gerade gemacht hat
- User zeigt wie es richtig sein sollte
- User korrigiert Code, Design oder Verhalten

## Learning-Extraktion (sofort, nicht aufgeschoben)
Wenn der User nach einer Korrektur bestätigt dass es jetzt funktioniert:
1. MUST: Sofort das Learning extrahieren (Was war falsch? Was ist richtig?)
2. MUST: In die SQLite DB speichern via Python (Pfad: ~/.claude-learnings/learnings.db)
3. MUST: Dem User das Learning zeigen und SOFORT fragen: "Soll das eine feste Regel werden?"
4. MUST: Bei Genehmigung → in knowledge-base.md eintragen + Nomination auf 'approved' setzen
5. MUST: Bei Ablehnung → Nomination auf 'rejected' setzen, nach Begründung fragen
6. MUST: Learnings IMMER zweisprachig speichern (siehe unten)

## Python-Code zum Speichern
```python
import sqlite3
from datetime import datetime
conn = sqlite3.connect(r'HOMEDIR/.claude-learnings/learnings.db')
c = conn.cursor()
c.execute("""INSERT INTO learnings (project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", [project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, 0.8])
learning_id = c.lastrowid
c.execute("INSERT INTO nominations (learning_id, status) VALUES (?, 'pending')", [learning_id])
conn.commit()
conn.close()
```
HOMEDIR auf Windows: C:\Users\Nabil — auf Mac/Linux: ~/

## Relevante Learnings laden
- Hooks laden automatisch relevante Learnings bei jedem Prompt (prompt-submit.js)
- Bei manueller Suche: /learn <suchbegriff>
- Zum Reviewen aller offenen: /audit

## Zweisprachige Learnings (Team-Feature)
- MUST: Jedes Learning IMMER in BEIDEN Sprachen speichern (Deutsch + Englisch)
- Felder: rule + rule_en, mistake + mistake_en, correction + correction_en
- Die Originalsprache steht im Hauptfeld (rule, mistake, correction)
- Die Übersetzung steht im _en Feld (rule_en, mistake_en, correction_en)
- Wenn der User auf Deutsch arbeitet: rule = Deutsch, rule_en = Englische Übersetzung
- Wenn der User auf Englisch arbeitet: rule = Englisch, rule_en = kann leer bleiben
- WARUM: Team-Learnings werden via Git geteilt — Teammates in anderen Ländern
  müssen die Learnings in ihrer Sprache lesen können
