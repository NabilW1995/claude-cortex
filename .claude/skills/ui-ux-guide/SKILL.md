---
name: ui-ux-guide
description: UI/UX design intelligence guide with style recommendations, color palettes, font pairings, and UX best practices for web and mobile applications
trigger: When designing interfaces, choosing styles, selecting colors/fonts, or making UX decisions
---

# UI/UX Design Guide

## Wann diesen Skill nutzen
- Wenn ein neues Projekt visuell gestaltet werden muss
- Wenn Farben, Fonts oder ein Design-System gewählt werden
- Wenn UX-Entscheidungen getroffen werden müssen
- Wenn der User sagt: "Mach es schön" oder "Design das mal"

## UI-Styles nach Projekttyp

### Web Apps (Dashboard, SaaS, Tools)
| Style | Wann nutzen | Kennzeichen |
|---|---|---|
| **Bento Grid** | Dashboards, Analytics | Grid-basierte Karten, verschiedene Größen |
| **Glassmorphism** | Moderne Apps, Overlays | Frosted Glass Effekt, Transparenz |
| **Neumorphism** | Minimale UIs, Settings | Weiche Schatten, eingedrückte Elemente |
| **Material Design 3** | Android-nahe Apps | Dynamic Color, klare Hierarchie |

### Websites (Landing Pages, Corporate, Blog)
| Style | Wann nutzen | Kennzeichen |
|---|---|---|
| **Editorial** | Blogs, Magazin-Seiten | Serif-Fonts, Multi-Column, Hierarchie |
| **Brutalist** | Kreativ-Agenturen, Portfolio | Raw, unpoliert, typografisch |
| **Organic/Natural** | Wellness, Nachhaltigkeit | Erdtöne, weiche Formen, Naturtexturen |
| **Luxury/Refined** | Premium-Produkte, Fashion | Viel Whitespace, Gold/Schwarz, Serif |

### Mobile Apps
| Style | Wann nutzen | Kennzeichen |
|---|---|---|
| **iOS Native** | Apple-Ökosystem | SF Pro, System-Blur, Tab-Navigation |
| **Material You** | Android-Ökosystem | Dynamic Color, FAB, Bottom Sheets |
| **Custom/Branded** | Starke Markenidentität | Eigene Icons, Custom Transitions |

### E-Commerce
| Style | Wann nutzen | Kennzeichen |
|---|---|---|
| **Product-Focused** | Premium, wenig Produkte | Große Bilder, minimal Text |
| **Catalog-Dense** | Viele Produkte, Marketplace | Grid, Filter, Quick-View |
| **Story-Driven** | DTC Brands | Scroll-Storytelling, Lifestyle-Bilder |

## Font-Pairings (Google Fonts, kostenlos)

### Modern & Clean
- Display: **Plus Jakarta Sans** / Body: **DM Sans**
- Display: **Outfit** / Body: **Work Sans**

### Editorial & Elegant
- Display: **Playfair Display** / Body: **Source Serif 4**
- Display: **Cormorant Garamond** / Body: **Lora**

### Tech & Bold
- Display: **Space Grotesk** / Body: **IBM Plex Sans**
- Display: **Syne** / Body: **Inter** (Inter nur als Body, nie als Display)

### Playful & Friendly
- Display: **Fredoka** / Body: **Nunito**
- Display: **Baloo 2** / Body: **Quicksand**

### Luxurious
- Display: **Bodoni Moda** / Body: **Montserrat**
- Display: **Tenor Sans** / Body: **Cormorant**

## Farbpaletten nach Branche

### Tech/SaaS
- Primary: #2563EB (Blue) / Accent: #F59E0B (Amber)
- Primary: #7C3AED (Violet) / Accent: #10B981 (Emerald)

### Health/Wellness
- Primary: #059669 (Teal) / Accent: #F3F4F6 (Light Gray)
- Primary: #0D9488 (Cyan) / Accent: #FCD34D (Yellow)

### Finance/Business
- Primary: #1E293B (Slate) / Accent: #3B82F6 (Blue)
- Primary: #0F172A (Dark) / Accent: #22D3EE (Cyan)

### Creative/Agency
- Primary: #F43F5E (Rose) / Accent: #8B5CF6 (Purple)
- Primary: #000000 (Black) / Accent: #FF6B35 (Orange)

### E-Commerce
- Primary: #111827 (Near-Black) / Accent: #EF4444 (Red)
- Primary: #1F2937 (Gray) / Accent: #F59E0B (Amber)

## UX Best Practices

### Navigation
- Max 7 Items in der Hauptnavigation
- Mobile: Bottom-Navigation für die 4-5 wichtigsten Aktionen
- Breadcrumbs für Seiten tiefer als 2 Ebenen
- Aktiver Nav-State immer sichtbar markiert

### Forms
- Immer Labels (nicht nur Placeholder)
- Fehler inline am Feld anzeigen, nicht nur oben
- Autofill unterstützen (autocomplete Attribute)
- Submit-Button beschreibend ("Konto erstellen" statt "Absenden")
- Progress-Indicator bei mehrstufigen Forms

### Loading & Feedback
- Skeleton-Screens statt Spinner für Content-Loading
- Optimistic UI für schnelle Aktionen (Like, Save)
- Toast-Notifications für Bestätigungen (max 5 Sekunden)
- Disable Button während Submission + Loading-State zeigen

### Responsive Design
- Breakpoints: 640px (sm), 768px (md), 1024px (lg), 1280px (xl)
- Touch-Targets mindestens 44x44px auf Mobile
- Hamburger-Menu nur auf Mobile, nie auf Desktop
- Bilder responsive mit srcset oder next/image

### Accessibility (Kurzversion)
- Kontrast 4.5:1 (WCAG AA)
- Alle Interaktionen per Tastatur erreichbar
- Focus-Styles sichtbar
- Sinnvolle alt-Texte

## Ablauf für Non-Programmers

1. Frage: "Welche Stimmung soll die Seite haben?"
   - Zeige 3-4 Style-Optionen mit Beschreibung
2. Frage: "Welche Farben gefallen dir?"
   - Zeige 2-3 Paletten-Vorschläge
3. Frage: "Welche Schriftart passt?"
   - Zeige 2-3 Font-Pairings
4. Warte auf Feedback
5. Implementiere

## Regeln
- MUST: Immer den User nach Präferenzen fragen bevor du designst
- MUST: 2-3 Optionen zeigen statt eine aufzuzwingen
- MUST: Design-Entscheidungen in einfacher Sprache erklären
- NEVER: Generische AI-Optik (purple gradients, Inter font, card layouts)
- NEVER: Designen ohne vorher die Zielgruppe zu verstehen
