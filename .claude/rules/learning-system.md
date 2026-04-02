---
description: Continuous learning system - correction detection, learning extraction, inline approval, bilingual storage
---

# Learning System (Inline Flow)

## Correction Detection (by Claude during conversation)
Claude detects corrections on its own — not just via hook patterns:
- User says "no", "wrong", "not like that", "that's incorrect", "differently"
- User describes a problem with what Claude just did
- User shows the correct way
- User corrects code, design, or behavior

## Learning Extraction (immediate, not deferred)
When the user confirms after a correction that it now works:
1. MUST: Immediately extract the learning (What was wrong? What is correct?)
2. MUST: Save to the SQLite DB via Python (Path: ~/.claude-learnings/learnings.db)
3. MUST: Show the user the learning and IMMEDIATELY ask: "Should this become a permanent rule?"
4. MUST: On approval — add to knowledge-base.md + set nomination to 'approved'
5. MUST: On rejection — set nomination to 'rejected', ask for reason
6. MUST: ALWAYS save learnings bilingually (see below)

## Python Code for Saving
```python
import sqlite3, os
db_path = os.path.join(os.path.expanduser('~'), '.claude-learnings', 'learnings.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("""INSERT INTO learnings (project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""", [project, category, rule, rule_en, mistake, mistake_en, correction, correction_en, 0.8])
learning_id = c.lastrowid
c.execute("INSERT INTO nominations (learning_id, status) VALUES (?, 'pending')", [learning_id])
conn.commit()
conn.close()
```

## Loading Relevant Learnings
- Hooks automatically load relevant learnings with every prompt (prompt-submit.js)
- For manual search: /learn <keyword>
- To review all pending: /audit

## Bilingual Learnings (Team Feature)
- MUST: ALWAYS save every learning in BOTH languages (German + English)
- Fields: rule + rule_en, mistake + mistake_en, correction + correction_en
- The original language goes in the main field (rule, mistake, correction)
- The translation goes in the _en field (rule_en, mistake_en, correction_en)
- If user works in German: rule = German, rule_en = English translation
- If user works in English: rule = English, rule_en = can be left empty
- WHY: Team learnings are shared via Git — teammates in other countries
  need to be able to read learnings in their language

## Full Documentation
For details see: @.claude/skills/continuous-learning/SKILL.md
