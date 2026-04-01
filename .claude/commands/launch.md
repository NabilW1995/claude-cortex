---
description: Produkt-Launch Pipeline — von Idee zu Go-to-Market Plan
argument-hint: "[Produkt oder Feature das gelauncht werden soll]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Agent
  - Glob
  - Grep
  - WebSearch
  - WebFetch
  - Bash(date:*)
---

Vollstaendige Launch-Pipeline. Nimmt ein Produkt oder Feature durch Wettbewerbs-Recherche,
Positionierung, und GTM-Planung.

## Schritte

### Schritt 1: Launch-Brief erfassen

Wenn der User beschrieben hat was gelauncht wird, nutze das. Sonst frage nach:
- Was ist das Produkt/Feature?
- Wer ist die Zielgruppe?
- Was ist der Zeitrahmen?

Schreibe ein einzeiliges Launch-Brief.

### Schritt 2: Wettbewerbs-Scan (parallele Agents)

Dispatche Agents fuer parallele Recherche:

**Agent 1 — Wettbewerber-Landschaft:**
- Suche nach direkten Wettbewerbern (Produkte die das gleiche Problem loesen)
- Extrahiere Preise, Features, Positionierung, Staerken, Schwaechen
- Identifiziere Luecken im Markt
- Nutze WebSearch fuer aktuelle Daten

**Agent 2 — Markt-Signale:**
- Suche nach aktuellen Trends in diesem Bereich
- Suche nach Nachfrage-Signalen (Reddit, HN, Twitter Diskussionen)
- Beachte regulatorische oder Plattform-Aenderungen die das Timing beeinflussen

### Schritt 3: Positionierung

Basierend auf Wettbewerbs-Erkenntnissen definiere:
- **Kategorie:** In welche Markt-Kategorie gehoert das?
- **Differenzierung:** Was macht ihr was Wettbewerber nicht machen?
- **Value Proposition:** Ein Satz der den Kunden sagen laesst "Das brauche ich"
- **Positioning Statement:** Fuer [Zielgruppe] ist [Produkt] die [Kategorie] die
  [Haupt-Nutzen] bietet, anders als [Alternative] weil [Grund]

### Schritt 4: Landing-Page Brief

Erstelle einen strukturierten Landing-Page Entwurf:
1. **Hero:** Headline, Subheading, primaerer CTA
2. **Schmerzpunkte:** 3-4 Probleme die die Zielgruppe hat
3. **Loesung:** Wie das Produkt sie loest
4. **Features:** Top 5-6 Features mit Nutzen (nicht nur Beschreibungen)
5. **Social Proof:** Welche Art Beweis wuerde wirken (Testimonials, Zahlen, Logos)
6. **FAQ:** 5-6 Fragen die die Zielgruppe stellen wuerde
7. **Finaler CTA:** Abschluss-Push

### Schritt 5: Go-to-Market Checkliste

Erstelle eine phasenweise Launch-Checkliste:

**Pre-Launch (2-4 Wochen vorher):**
- [ ] Landing Page live
- [ ] Email-Erfassung / Warteliste eingerichtet
- [ ] Launch-Ankuendigung geschrieben
- [ ] Verteilerkanale identifiziert (Communities, Newsletter, Social)
- [ ] Early-Access / Beta-User bereit

**Launch-Tag:**
- [ ] Auf primaeren Kanaelen ankuendigen
- [ ] Auf Product Hunt / HN / relevante Communities posten
- [ ] Warteliste informieren
- [ ] Auf Probleme ueberwachen
- [ ] Auf fruehes Feedback reagieren

**Post-Launch (1-2 Wochen danach):**
- [ ] Feedback sammeln und umsetzen
- [ ] Case Studies / Ergebnisse veroeffentlichen
- [ ] Basierend auf Conversion-Daten optimieren
- [ ] Mit fruehen Usern nachfassen

### Schritt 6: Launch-Plan speichern

Speichere alles unter `launch-plan-[produktname].md`:

```markdown
# Launch-Plan — [Produktname]

## Brief
[ein Absatz]

## Wettbewerber-Landschaft
[Tabelle mit Wettbewerbern: Preise/Features/Positionierung]

## Positionierung
[Positioning Statement und Differenzierung]

## Landing-Page Brief
[Strukturierter Entwurf aus Schritt 4]

## Go-to-Market Checkliste
[Phasenweise Checkliste aus Schritt 5]

## Zeitplan
[Wichtige Daten und Meilensteine]

## Risiken
[Top 3 Risiken und Mitigierungen]

---
Generiert: [Datum]
```

Zeige eine Zusammenfassung des Plans und frage den User was zuerst umgesetzt werden soll.

## Wichtig
- MUST: WebSearch fuer aktuelle Wettbewerber-Daten nutzen
- MUST: Alles in einfacher Sprache — der User ist kein Marketing-Experte
- MUST: Konkrete, umsetzbare Checklisten statt vager Empfehlungen
- MUST: User fragen bevor der Plan finalisiert wird
