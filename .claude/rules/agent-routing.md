---
description: Automatic agent routing - when to trigger which agent based on context
---

# Agent-Routing (MUST follow)

## Wann welcher Agent automatisch laufen MUSS

### error-whisperer — Bei JEDER Fehlermeldung
- TRIGGER: Wenn ein Tool fehlschlägt oder eine Fehlermeldung erscheint
- TRIGGER: Wenn der User sagt "geht nicht", "Fehler", "Error", "funktioniert nicht"
- AKTION: Agent starten mit der Fehlermeldung als Input
- FORMAT: Fehler übersetzen, Lösung zeigen, Ursache erklären — in einfacher Sprache
- MUST: IMMER den error-whisperer Agent nutzen, NIEMALS rohe Fehlermeldungen an den User weitergeben

### pr-ghostwriter — Vor JEDEM Pull Request
- TRIGGER: Wenn ein PR erstellt werden soll (`gh pr create`, `/commit`, oder User sagt "PR erstellen")
- AKTION: Agent starten, der den Diff analysiert und PR-Beschreibung schreibt
- FORMAT: Was wurde gemacht, Warum, Änderungen, Test-Anleitung, Checkliste
- MUST: PR-Beschreibung vom Agent schreiben lassen, nicht selbst formulieren

### unsticker — Nach 5 aufeinanderfolgenden Korrekturen
- TRIGGER: Wenn der User 5x hintereinander korrigiert ("nein", "falsch", "nicht so", "anders")
- AKTION: Agent starten für Root-Cause-Analyse
- FORMAT: Problem klassifizieren, Learnings-DB prüfen, einfachste Lösung zuerst
- Der prompt-submit.js Hook zählt aufeinanderfolgende Korrekturen (corrections_streak)
- Bei streak >= 5: Meldung "[Unsticker] 5 Korrekturen hintereinander — Root-Cause-Analyse empfohlen"
- MUST: Claude MUSS dann den unsticker Agent starten

### yak-shave-detector — Periodisch + bei Komprimierung
- TRIGGER: Vor Context-Komprimierung (PreCompact)
- TRIGGER: Wenn >10 Dateien in einer Session geändert wurden
- TRIGGER: Wenn aktuelle Arbeit 2+ Ebenen von der Originalaufgabe entfernt ist
- AKTION: Agent prüft ob die aktuelle Arbeit noch zur Aufgabe passt
- FORMAT: Originalaufgabe nennen, Abweichungs-Pfad zeigen, Weg zurück vorschlagen
- MUST: Höflich hinweisen, nie vorwurfsvoll

### onboarding-sherpa — Bei Cortex-Installation + /onboard
- TRIGGER: Nach dem Install-Script (`scripts/template/install.js`)
- TRIGGER: Wenn User `/onboard` aufruft
- TRIGGER: Wenn User sagt "Erkläre mir das Projekt" oder "Was ist das hier?"
- AKTION: Agent scannt Codebase und gibt 1-Seite Briefing
- MUST: Immer "So startet man das Projekt" inkludieren

### auditor — Bei /audit + nach Learning-Genehmigung
- TRIGGER: Wenn User `/audit` aufruft
- TRIGGER: Wenn ein Learning gespeichert und genehmigt wurde → Qualitäts-Check
- AKTION: Nominations reviewen, Knowledge-Base aktualisieren
- MUST: Jede Promotion braucht einen [Source:] Tag

### archaeologist — Bei "Warum ist das so?"
- TRIGGER: Wenn der User fragt "Warum wurde das so gemacht?", "Wer hat das geschrieben?", "Ist es sicher das zu ändern?"
- TRIGGER: Wenn Code unklar ist und die Geschichte verstanden werden muss
- AKTION: Git Blame + Commit-Archäologie, Kontext rekonstruieren
- FORMAT: Archaeological Report mit Timeline, Sicherheits-Verdict (SAFE/CAUTION/DANGEROUS)
- MUST: Immer Git-History lesen bevor Schlüsse gezogen werden

### debt-collector — Bei /debt-map + periodisch
- TRIGGER: Wenn User `/debt-map` aufruft
- TRIGGER: Wenn viele TODOs/FIXMEs in geänderten Dateien erkannt werden
- TRIGGER: Periodisch bei größeren Projekten (empfohlen: wöchentlich)
- AKTION: Codebase scannen, Tech-Debt kategorisieren und priorisieren
- FORMAT: Debt-Report mit Hotspots, Impact×Effort Matrix, Empfehlungen
- Speichert Scan-History in agent-memory/debt-collector/MEMORY.md

### rubber-duck — Bei Denkblockade
- TRIGGER: Wenn der User sagt "Ich weiß nicht wie", "Ich stecke fest", "Hilf mir denken"
- TRIGGER: Wenn der unsticker nach 2 Runden keine Lösung findet
- AKTION: Sokratisches Debugging — Fragen stellen statt Antworten geben
- FORMAT: Gezielte Fragen die den User zum eigentlichen Problem führen
- MUST: Niemals direkt die Lösung geben — der User soll sie selbst finden
