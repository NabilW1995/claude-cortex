# Alle Commands auf einen Blick

> Tippe `/command-name` um einen Command auszuführen. Diese Übersicht hilft dir, den richtigen Command zur richtigen Zeit zu finden.

---

## Dein Tagesablauf

### Morgens: Arbeitstag starten
```
/start
```
Lädt den Stand von gestern, prüft offene Aufgaben, zeigt neue Team-Learnings. Mach das als Erstes wenn du Claude öffnest.

### Schneller Überblick statt vollem Start
```
/standup
```
30-Sekunden-Version: Was hast du gestern gemacht? Was steht heute an? Gibt es Blocker? Wird automatisch aus Git und deinen Notizen generiert.

### Zwischendurch: Kurs prüfen
```
/sync
```
Nach 3-4 Stunden Arbeit: Sind wir noch auf Kurs? Memory auffrischen, offene Punkte checken. Verhindert dass du dich verirrst.

### Feierabend: Tag abschließen
```
/wrap-up
```
Learnings sichern, Memory aufräumen, morgen vorbereiten. Mach das bevor du Claude schließt — sonst gehen Erkenntnisse verloren.

---

## Wenn du Code schreibst

### Neues Feature bauen
```
/feature
```
Kompletter Feature-Workflow: Branch erstellen, Plan zeigen, implementieren, testen, PR erstellen. Fragt dich bei jedem Schritt.

### Code prüfen lassen
```
/review
```
Drei Agents prüfen gleichzeitig: Sicherheit, Performance, Architektur. Gibt dir einen Report mit Problemen sortiert nach Schwere (CRITICAL → LOW).

### Release Notes schreiben
```
/release
```
Generiert automatisch aus deiner Git-History drei Versionen: technisch (für Entwickler), Marketing (für die Website), Executive (für den Chef).

---

## Wenn etwas nicht klappt

### Du steckst fest
```
/unstick
```
Analysiert warum du blockiert bist und schlägt den schnellsten Weg vor. Nutze das wenn du seit 10+ Minuten am gleichen Problem hängst.

### Kontext wird zu voll
```
/safe-clear
```
Sichert den aktuellen Stand und startet frisch — ohne dass du was verlierst. Nutze das wenn Claude anfängt sich zu wiederholen oder Details zu vergessen.

---

## Qualität sichern

### Learnings prüfen und genehmigen
```
/audit
```
Zeigt dir alle offenen Learnings und fragt: "Soll das eine feste Regel werden?" Genehmigte Learnings gelten dann für alle zukünftigen Sessions.

### Tech-Debt Übersicht
```
/debt-map
```
Scannt den Code nach TODOs, Hacks und Problemstellen. Zeigt dir wo die meisten Schulden liegen und was du zuerst fixen solltest.

### System-Gesundheit prüfen
```
/system-audit
```
Prüft ob alle Agents, Commands, Hooks und Skills korrekt funktionieren. Gibt jedem Bereich eine Note (A-F). Mach das einmal im Monat.

### Konfiguration auf Widersprüche prüfen
```
/drift-detect
```
Findet Stellen wo sich deine Regeln widersprechen oder Dateien veraltet sind. Nützlich wenn Claude sich "komisch" verhält.

### Sprint-Rückblick
```
/retro
```
Was lief gut diese Woche? Was nicht? Was ändern wir? Liest deine Notizen und Learnings und erstellt eine strukturierte Retrospektive.

---

## Wissen und Lernen

### Learnings durchsuchen
```
/learn css
/learn auth
/learn
```
Zeigt gespeicherte Learnings. Ohne Argument: die letzten 10. Mit Argument: sucht nach dem Thema.

### Codebase kennenlernen
```
/onboard
```
Scannt ein unbekanntes Projekt und erklärt dir in 5 Minuten: Was ist das? Wie ist es aufgebaut? Wie startet man es? Was sind die Fallstricke?

---

## Planung und Strategie

### Neues Projekt starten
```
/new-project
```
Interaktives Interview: Was willst du bauen? Für wen? Welche Features? Empfiehlt einen Tech-Stack und setzt alles auf.

### Produkt launchen
```
/launch
```
Komplette Launch-Pipeline: Wettbewerbs-Analyse, Positionierung, Landing-Page-Brief, Go-to-Market-Checkliste.

### Report schreiben
```
/report
```
Verwandelt Daten und Erkenntnisse in einen professionellen Bericht. Passt sich an die Zielgruppe an: Executive (kurz), Technisch (detailliert), Client (ROI-fokussiert).

---

## Teamarbeit

### Session an jemand anderen übergeben
```
/handoff
```
Fasst zusammen: Was wurde gemacht, was ist offen, welche Entscheidungen wurden getroffen, welche Dateien wurden geändert. Der nächste kann sofort weitermachen.

### Template aktualisieren
```
/template-update
```
Holt die neueste Version von Claude Cortex von GitHub. Neue Rules, Hooks und Learnings vom Team werden automatisch gemergt.

### Aufräumen
```
/cleanup
```
Findet ungenutzte Dateien, leere Ordner und überflüssige Dependencies. Fragt dich vor dem Löschen.

---

## Wann was nutzen — Schnellreferenz

| Du willst... | Command |
|--------------|---------|
| Arbeitstag starten | `/start` |
| Schneller Überblick | `/standup` |
| Zwischendurch Kurs prüfen | `/sync` |
| Feierabend machen | `/wrap-up` |
| Feature bauen | `/feature` |
| Code prüfen | `/review` |
| Release vorbereiten | `/release` |
| Du steckst fest | `/unstick` |
| Claude vergisst Sachen | `/safe-clear` |
| Learnings genehmigen | `/audit` |
| Tech-Schulden finden | `/debt-map` |
| System-Check | `/system-audit` |
| Widersprüche finden | `/drift-detect` |
| Wochenrückblick | `/retro` |
| Learnings suchen | `/learn` |
| Neues Projekt | `/new-project` |
| Projekt kennenlernen | `/onboard` |
| Produkt launchen | `/launch` |
| Bericht schreiben | `/report` |
| Session übergeben | `/handoff` |
| Template updaten | `/template-update` |
| Aufräumen | `/cleanup` |
