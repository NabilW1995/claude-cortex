---
description: Professioneller Bericht aus Daten/Findings — zielgruppen-gerecht aufbereitet
argument-hint: "[Thema und Zielgruppe]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Agent
  - Glob
  - Grep
  - Bash(date:*)
---

Verwandle Rohdaten, Findings oder Recherche-Ergebnisse in einen polierten,
narrativen Bericht. Passt Ton und Tiefe an die Zielgruppe an.

## Schritte

### Schritt 1: Inputs klaeren

Identifiziere:
- **Thema:** Worueber geht der Bericht?
- **Datenquellen:** Welche Dateien, Findings oder Daten sollen einfliessen?
- **Zielgruppe:** Wer liest das? (Geschaeftsfuehrung, Technik-Team, Kunde, Vorstand, allgemein)
- **Format-Praeferenz:** Kurz (1-2 Seiten), Standard (3-5 Seiten), Umfassend (5+ Seiten)

Wenn der User keine Zielgruppe angegeben hat:
Standard = "professionell — klar, direkt, kein Fachjargon."

### Schritt 2: Quellmaterial sammeln

Lies alle relevanten Dateien und Daten. Scanne nach:
- Kern-Findings und Metriken
- Patterns und Trends
- Vergleiche (Vorher/Nachher, vs. Benchmark, vs. Wettbewerber)
- Anomalien oder Bedenken
- Empfehlungen die sich aus den Daten ergeben

### Schritt 3: Fuer die Zielgruppe strukturieren

**Geschaeftsfuehrung:**
- Fuehre mit dem Bottom Line (Empfehlung oder Kern-Finding)
- Nutze Aufzaehlungen statt Absaetze
- Nur Metriken die Entscheidungen beeinflussen
- Unter 2 Seiten halten
- Ende mit klaren naechsten Schritten

**Technik-Team:**
- Fuehre mit Methodik
- Detaillierte Daten und Analyse einbeziehen
- Zeige den Weg zur Schlussfolgerung
- Einschraenkungen und Vorbehalte erwaehnen
- Quell-Dateien referenzieren

**Kunden:**
- Fuehre mit dem was ihnen wichtig ist (Ergebnisse, ROI, Auswirkung)
- Ihre Sprache nutzen, nicht unsere
- Zahlen kontextualisieren ("+15% vs. Branchen-Durchschnitt von +3%")
- Visuelle Formatierung (Tabellen, fette Schlussel-Zahlen)
- Ende mit was als naechstes passiert

### Schritt 4: Bericht schreiben

```markdown
# [Bericht-Titel]

**Datum:** [datum]
**Erstellt fuer:** [Zielgruppe]

---

## Zusammenfassung
[2-3 Saetze: Kern-Finding, Empfehlung, Bottom Line]

## Kern-Findings

### [Finding 1]
[Daten, Kontext, Bedeutung]

### [Finding 2]
[Daten, Kontext, Bedeutung]

### [Finding 3]
[Daten, Kontext, Bedeutung]

## Analyse
[Tiefere Interpretation — was die Findings bedeuten, Patterns, Vergleiche]

## Empfehlungen
1. **[Aktion]** — [Begruendung und erwartete Auswirkung]
2. **[Aktion]** — [Begruendung und erwartete Auswirkung]
3. **[Aktion]** — [Begruendung und erwartete Auswirkung]

## Naechste Schritte
- [ ] [Konkrete Aktion mit Verantwortlichkeit/Zeitrahmen]

---
Quellen: [Liste der genutzten Datenquellen]
```

### Schritt 5: Qualitaets-Check

Vor der Auslieferung verifizieren:
- [ ] Jede Behauptung hat stuetzende Daten
- [ ] Kein Fachjargon den die Zielgruppe nicht versteht
- [ ] Empfehlungen sind umsetzbar (nicht vage)
- [ ] Zahlen sind durchgaengig konsistent
- [ ] Der Bericht beantwortet "Na und?" — nicht nur "Was"

Speichere unter `reports/[thema]-bericht.md` und zeige eine Zusammenfassung.

## Wichtig
- MUST: Ton und Tiefe an die Zielgruppe anpassen
- MUST: Immer mit "Na und?" enden — nicht nur Daten praesentieren
- MUST: Empfehlungen muessen konkret und umsetzbar sein
- MUST: Qualitaets-Check durchfuehren bevor der Bericht praesentiert wird
- MUST: Wenn Zielgruppe unklar → fragen, nicht raten
