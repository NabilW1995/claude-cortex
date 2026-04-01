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

### rubber-duck — Nach 3 aufeinanderfolgenden Korrekturen
- TRIGGER: Wenn der User 3x hintereinander korrigiert (prompt-submit.js zählt streak)
- TRIGGER: Wenn der User sagt "Ich weiß nicht wie", "Hilf mir denken"
- TRIGGER: Wenn der unsticker nach 2 Runden keine Lösung findet
- AKTION: Sokratisches Debugging — Fragen stellen statt Antworten geben
- Bei streak == 3: Meldung "[Rubber-Duck] 🦆 3 Korrekturen — Problem laut formulieren"
- MUST: Niemals direkt die Lösung geben — der User soll sie selbst finden

### unsticker — Nach 5 aufeinanderfolgenden Korrekturen
- TRIGGER: Wenn der User 5x hintereinander korrigiert (prompt-submit.js zählt streak)
- AKTION: Agent starten für Root-Cause-Analyse
- FORMAT: Problem klassifizieren, Learnings-DB prüfen, einfachste Lösung zuerst
- Bei streak >= 5: Meldung "[Unsticker] ⚠️ 5 Korrekturen — Root-Cause-Analyse empfohlen"
- MUST: Claude MUSS dann den unsticker Agent starten
- Eskalations-Kette: Rubber Duck (3) → Unsticker (5)

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

### debt-collector — Bei /debt-map + automatisch bei steigender Debt
- TRIGGER: Wenn User `/debt-map` aufruft
- TRIGGER: Automatisch wenn TODO/FIXME-Zähler >=20 UND steigend (completeness-gate.sh Hook)
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

### coder — Bei JEDER Coding-Aufgabe
- TRIGGER: Wenn ein neues Feature implementiert werden soll
- TRIGGER: Wenn bestehender Code refactored werden soll
- TRIGGER: Wenn der User sagt "Bau mir...", "Implementiere...", "Schreibe Code fuer..."
- TRIGGER: Wenn eine neue Komponente, Funktion oder Modul erstellt werden soll
- AKTION: 3-Phasen-Workflow: Recherche → Implementierung → Verifizierung
- FORMAT: Code-Aenderungen mit einfacher Erklaerung was gemacht wurde und warum
- MUST: Immer zuerst Codebase und Learnings-DB recherchieren
- MUST: Immer `npm run lint` und `npm run test` vor Abschluss ausfuehren

### code-review — Nach Feature-Completion + vor PR
- TRIGGER: Wenn ein Feature fertig implementiert wurde
- TRIGGER: Wenn der User sagt "Review", "Pruefe den Code", "Ist das gut so?"
- TRIGGER: Vor dem Erstellen eines Pull Requests
- TRIGGER: Wenn der User fragt ob Code produktionsreif ist
- AKTION: 7-Kategorien-Review (Qualitaet, Wartbarkeit, Doku, Performance, Security, Error Handling, Testing)
- FORMAT: Strukturierter Report mit Schweregrad-Levels (CRITICAL, HIGH, MEDIUM, LOW)
- MUST: Issues in einfacher Sprache erklaeren — der User ist kein Programmierer
- MUST: Wiederkehrende Issues als Learning in der SQLite-DB speichern

### debug-investigator — Bei spezifischen Fehlern/Bugs
- TRIGGER: Wenn ein spezifischer Fehler oder Bug untersucht werden muss
- TRIGGER: Wenn ein Test fehlschlaegt und die Ursache unklar ist
- TRIGGER: Wenn der User einen Stack-Trace oder eine Fehlermeldung teilt
- TRIGGER: Ergaenzend zum error-whisperer wenn tiefere Analyse noetig ist
- AKTION: 5-Schritt-Untersuchung: Fehler parsen → Dateien lesen → Patterns suchen → Git-History pruefen → Grundursache identifizieren
- FORMAT: Strukturierter Bericht mit Fehler-Klassifizierung, technischen Details und einfacher Erklaerung
- MUST: Learnings-DB konsultieren ob der Fehler schon mal aufgetreten ist
- MUST: Fehler in einfacher Sprache uebersetzen (ggf. error-whisperer nutzen)

### deep-dive — Bei gruendlicher Analyse vor Entscheidungen
- TRIGGER: Wenn eine technische Entscheidung gruendlich analysiert werden muss
- TRIGGER: Wenn der User sagt "Analysiere...", "Untersuche...", "Was waere der beste Ansatz?"
- TRIGGER: Wenn ein Implementierungsplan vor der Ausfuehrung geprueft werden soll
- TRIGGER: Wenn eine unbekannte Codebase erkundet werden muss
- TRIGGER: Wenn Architektur-Alternativen bewertet werden muessen
- AKTION: 6-Phasen-Framework: Umfang → Exploration → Recherche → Tiefenanalyse → Alternativen → Bericht
- FORMAT: Executive Summary (einfache Sprache) + Detaillierte Erkenntnisse + Risiken + Empfehlungen
- MUST: Gruendlichkeit vor Geschwindigkeit — keine uebereilten Analysen

### build-validator — Nach Implementierung + vor Commit
- TRIGGER: Wenn eine Implementierung abgeschlossen wurde
- TRIGGER: Vor jedem Git-Commit
- TRIGGER: Wenn der User fragt "Funktioniert alles?", "Ist der Code bereit?"
- TRIGGER: Nach grossen Refactorings oder Merges
- AKTION: Build → Types → Lint → Tests → Visuelles Review (wenn UI betroffen)
- FORMAT: Ampel-System (BESTANDEN / WARNUNG / FEHLGESCHLAGEN) mit einfacher Zusammenfassung
- MUST: Alle 4 Haupt-Checks ausfuehren (Build, Types, Lint, Tests)
- MUST: Auto-Fix nur fuer sichere Aenderungen (Formatierung, Imports)

### env-validator — Am Session-Start + vor Deploy
- TRIGGER: Am Beginn einer neuen Arbeitssession (schneller Check)
- TRIGGER: Vor einem Deployment
- TRIGGER: Nach einer Cortex-Installation oder Template-Setup
- TRIGGER: Wenn der User sagt "Funktioniert meine Umgebung?", "Ist alles installiert?"
- AKTION: Umgebungsvariablen, CLI-Tools, Dependencies, Datenbank und Git-Status pruefen
- FORMAT: Tabellen-basierter Report mit Schweregrad (KRITISCH / WARNUNG / OK)
- MUST: NIEMALS Secret-Werte anzeigen — nur ob sie gesetzt sind
- MUST: Klare Loesungsschritte fuer jedes Problem angeben
