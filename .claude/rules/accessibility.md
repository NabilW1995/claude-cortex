---
description: Accessibility (a11y) rules for web applications
globs: "src/**/*.{tsx,jsx,html,vue,svelte}"
---

# Barrierefreiheit (Accessibility)

## Bilder
- MUST: Alle img brauchen alt-Text
- Dekorative Bilder: alt=""
- Informative Bilder: Beschreibender alt-Text

## Formulare
- MUST: Jedes Input braucht ein label (nicht nur Placeholder)
- MUST: Fehlermeldungen sind mit dem Input verknüpft (aria-describedby)
- MUST: Required-Felder sind markiert

## Farben und Kontrast
- MUST: Farbkontrast mindestens 4.5:1 (WCAG AA)
- NEVER: Farbe als einziges Unterscheidungsmerkmal
- MUST: Focus-Styles sichtbar lassen (nie outline:none global)

## Navigation
- MUST: Alle interaktiven Elemente per Tastatur erreichbar
- MUST: Sinnvolle Heading-Hierarchie (h1, h2, h3 — keine Sprünge)
- MUST: Skip-to-content Link für Screenreader
- MUST: aria-labels für Icon-Buttons ohne sichtbaren Text

## Dynamischer Content
- MUST: aria-live für dynamisch aktualisierten Content
- MUST: Modals fangen den Fokus (Focus Trap)
- MUST: Loading-States sind für Screenreader erkennbar
