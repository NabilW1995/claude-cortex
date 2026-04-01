---
description: Codebase-Onboarding — Architektur-Scan, Key-Decisions, erste Aufgaben
argument-hint: "[Projekt-Verzeichnis oder leer fuer aktuelles Projekt]"
allowed-tools:
  - Read
  - Write
  - Agent
  - Glob
  - Grep
  - Bash(git log:*, wc:*, ls:*, date:*)
---

Lerne eine bestehende Codebase in 5 Minuten kennen. Scannt Architektur, Dependencies,
Patterns und generiert ein umfassendes Onboarding-Briefing.

## Schritte

### Schritt 1: Projekt lokalisieren

Wenn der User ein Verzeichnis angegeben hat, nutze dieses. Sonst das aktuelle Arbeitsverzeichnis.
Pruefe ob es ein echtes Projekt ist (package.json, Cargo.toml, pyproject.toml, go.mod o.ae.).

### Schritt 2: Paralleler Struktur-Scan (3 Agents gleichzeitig)

**Scan 1 — Projekt-Identitaet:**
- Lies README, CONTRIBUTING, CHANGELOG (falls vorhanden)
- Lies package.json / Cargo.toml / pyproject.toml fuer Metadaten
- Identifiziere: Sprache, Framework, Build-Tool, Test-Framework
- Zaehle: Dateien gesamt, Zeilen Code, Anzahl Dependencies

**Scan 2 — Architektur:**
- Mappe die Verzeichnisstruktur (Top 3 Ebenen)
- Identifiziere Architektur-Pattern (MVC, Hexagonal, Monolith, Microservices, Serverless)
- Finde Entry Points (Main-Dateien, Route-Definitionen, Handler)
- Lokalisiere Config-Dateien (.env, yaml, json Configs)

**Scan 3 — Schluessel-Dateien:**
- Finde die 10 meistgeaenderten Dateien:
  `git log --format='' --name-only | sort | uniq -c | sort -rn | head -20`
- Finde die groessten Dateien (wahrscheinlich wichtig oder problematisch)
- Lokalisiere Test-Verzeichnisse und Test-Patterns

### Schritt 3: Dependency-Analyse

- Liste direkte Dependencies mit Versionen
- Markiere veraltete oder deprecated Pakete (Major-Version-Luecken)
- Identifiziere kritische Dependencies (ohne die das Projekt nicht laeuft)
- Notiere ungewoehnliche oder Nischen-Dependencies die man verstehen sollte

### Schritt 4: Code-Patterns erkennen

Lies 3-5 repraesentative Dateien und identifiziere:
- Namenskonventionen (camelCase, snake_case, etc.)
- Fehlerbehandlungs-Patterns
- Logging-Ansatz
- State Management (bei Frontend)
- Datenbank-Zugriffs-Patterns (bei Backend)
- Authentifizierungs-Ansatz

### Schritt 5: Git-Archaeologie

```bash
git log --oneline -20
```

Aus der History ableiten:
- Woran wird aktiv gearbeitet?
- Wer sind die Haupt-Contributors?
- Wie ist der Commit-Stil? (Conventional Commits, frei, etc.)
- Gibt es langlebige Branches?

### Schritt 6: Onboarding-Sherpa Agent dispatchen

Dispatche den Onboarding-Sherpa Agent fuer das Briefing:
```
Agent(onboarding-sherpa): Erstelle ein Onboarding-Briefing fuer dieses Projekt.
Kontext: [Ergebnisse aus Schritt 2-5]
```

### Schritt 7: Onboarding-Guide generieren

Ausgabe als strukturiertes Briefing mit diesen Sektionen:
- **Quick Facts:** Sprache, Framework, Architektur, LOC, Dependencies, Test/Build Tool
- **Projektstruktur:** Verzeichnisbaum (Top 3 Ebenen, annotiert)
- **Top 5 Dateien:** Die wichtigsten Dateien mit Begruendung warum sie wichtig sind
- **Architektur-Ueberblick:** 2-3 Absaetze wie das System funktioniert
- **Code-Patterns:** Benennung, Fehlerbehandlung, State, Auth
- **Umgebung einrichten:** Schritte zum lokalen Starten
- **Erste Aufgaben:** 3 kleine, konkrete Tasks mit Datei-Referenzen zum Einarbeiten
- **Aufpassen bei:** Nicht-offensichtliche Stolperfallen und Gotchas

### Schritt 8: CLAUDE.md aktualisieren

Trage die Erkenntnisse in CLAUDE.md ein:
- Projekt-Struktur Sektion ausfuellen
- Tech-Stack dokumentieren
- Bekannte Gotchas eintragen

## Wichtig
- MUST: Erklaere alles in einfacher Sprache
- MUST: Nutze den Onboarding-Sherpa Agent
- MUST: Zeige eine kurze Zusammenfassung am Ende (max 1 Seite)
- MUST: Schlage konkrete erste Aufgaben vor (mit Datei-Referenzen)
