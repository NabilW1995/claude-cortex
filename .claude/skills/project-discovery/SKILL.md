---
name: project-discovery
description: "Use when user says 'neues Projekt', 'new project', 'I want to build', 'lass uns was bauen', 'was sollen wir bauen?'. MUST run before scaffolding skill."
---

# Project Discovery — Interview Skill

## Purpose

Before writing a single line of code, you need to understand what you're building, who it's for, and how it should work. This skill guides a structured conversation that turns a vague idea into a clear project brief.

The key insight: asking the right questions upfront saves days of rework later. Non-programmers often don't know what decisions need to be made — that's why this interview exists.

## Language

Ask in the language the user is speaking. Default to German. All examples below are in German but adapt as needed.

## Before Starting

Check the Learning-DB for relevant experience:
```python
# Search for learnings from similar project types
searchLearnings(db, "project setup scaffolding", null, 5)
```

If there are relevant learnings (e.g., "Always use Vercel for hobby projects" or "shadcn/ui is preferred for UI"), factor them into your recommendations.

## The Interview

Ask questions ONE AT A TIME. Use multiple-choice whenever possible. Explain technical terms in simple language.

### Phase 1: Vision (Was und Warum)

1. **Projekttyp**: "Was möchtest du bauen?"
   - Web App (interaktive Anwendung im Browser, z.B. Dashboard, Tool)
   - Website (informativer Webauftritt, Landingpage, Portfolio)
   - Mobile App (Handy-App für iOS/Android)
   - API/Backend (Server der Daten verarbeitet — z.B. für eine bestehende App)
   - CMS (System zum Verwalten von Inhalten — z.B. Blog, Magazin)
   - E-Commerce (Online-Shop mit Produkten und Bezahlung)
   - SaaS (Software-as-a-Service mit User-Accounts und Abonnements)
   - Anderes: ___

2. **Projektname**: "Wie soll das Projekt heißen?"
   (Wenn der User keinen Namen hat, hilf mit 2-3 Vorschlägen basierend auf der Beschreibung)

3. **Beschreibung**: "Beschreib in 2-3 Sätzen was es machen soll."
   (Wenn vage: Frage nach. "Für wen löst das welches Problem?")

4. **Zielgruppe**: "Wer wird das benutzen?"
   - Privatpersonen / Endverbraucher
   - Unternehmen / B2B
   - Internes Team (nur Mitarbeiter)
   - Öffentlich (jeder, ohne Anmeldung)
   - Spezifische Nische: ___

5. **Vorbild**: "Gibt es eine bestehende App oder Website die ähnlich ist?"
   (Wenn ja: Was genau gefällt dir daran? Was würdest du anders machen?)

### Phase 2: Features (Was genau)

6. **Kernfeatures**: "Was sind die 3-5 wichtigsten Dinge die es können muss?"
   (Hilf mit Beispielen basierend auf dem Projekttyp)

7. **User-Accounts**: "Braucht es Login/Registrierung?"
   - Ja, mit Email + Passwort
   - Ja, mit Social Login (Google, GitHub, Apple)
   - Ja, beides
   - Nein, kein Login nötig

8. **Daten**: "Welche Art von Daten werden gespeichert?"
   - User-Profile und Einstellungen
   - Texte, Artikel, Blog-Posts
   - Bilder, Videos, Medien
   - Produkte, Bestellungen, Warenkorb
   - Nachrichten, Chat, Kommunikation
   - Andere: ___

9. **Bezahlung**: "Braucht es eine Zahlungsfunktion?"
   - Ja, einmalige Zahlungen (z.B. Stripe Checkout)
   - Ja, Abonnements/Subscriptions (z.B. monatliches Abo)
   - Ja, Marketplace (User verkaufen an User)
   - Nein

10. **Sprache**: "In welcher Sprache soll die Benutzeroberfläche sein?"
    - Deutsch
    - Englisch
    - Mehrsprachig (i18n) — welche Sprachen?
    - Andere: ___

### Phase 3: Design (Wie soll es aussehen)

11. **Design-Weg**: "Wie möchtest du das Design erstellen?"
    - **Google Stitch** (empfohlen) — Du beschreibst deine Idee, Stitch generiert ein professionelles Design, Claude setzt es in Code um
    - **Lokal mit Claude** — Claude designt direkt im Code, du gibst Feedback
    - **Eigene Designs** — Du hast Figma/Sketch/Adobe Dateien
    - **Keine Präferenz** — Claude entscheidet

12. **Design-Stil**: "Welche Stimmung soll die App haben?"
    - Modern / Minimalistisch (viel Weißraum, klare Linien)
    - Bunt / Verspielt (Farben, Animationen, Spaß)
    - Corporate / Professionell (seriös, vertrauenswürdig)
    - Dark Mode / Tech (dunkel, neon-Akzente)
    - Luxuriös / Premium (elegant, hochwertig)
    - Keine Präferenz — mach einen Vorschlag

13. **Komponenten-Bibliothek**: "Sollen wir eine fertige UI-Bibliothek nutzen?"
    - shadcn/ui (empfohlen — flexibel, modern, anpassbar)
    - Material UI (Google-Style)
    - Chakra UI
    - Kein Framework — alles selbst bauen
    - Keine Präferenz

14. **Mobile**: "Wie wichtig ist Mobile?"
    - Mobile-first (Handy ist wichtiger als Desktop)
    - Beides gleich wichtig
    - Desktop-first (Handy ist Bonus)
    - Native App nötig (App Store / Play Store)

### Phase 4: Technik (Wie es gebaut wird)

15. **Deployment**: "Wo soll es laufen?"
    - Vercel (empfohlen für Next.js — einfach, kostenloser Start, Preview-Links)
    - Netlify (ähnlich, gut für statische Seiten)
    - Railway (gut für Backend/Datenbanken)
    - Eigener Server / VPS (volle Kontrolle, mehr Aufwand)
    - Egal — mach einen Vorschlag

16. **Bestehender Code**: "Gibt es bestehenden Code oder ein bestehendes Projekt?"
    - Ja, hier ist der Link/Pfad: ___
    - Nein, komplett neu

17. **GitHub**: "Soll ich ein GitHub-Repository erstellen?"
    - Ja, öffentlich (Open Source)
    - Ja, privat
    - Nein, ich habe schon eins
    - Was ist GitHub? (Erklärung geben)

18. **SEO**: "Ist Suchmaschinen-Optimierung wichtig?"
    - Ja, sehr wichtig (muss bei Google gefunden werden)
    - Etwas wichtig
    - Nicht relevant (interne App)

19. **Barrierefreiheit**: "Muss die App barrierefrei sein?"
    - Ja, WCAG AA Standard (empfohlen)
    - Basis-Barrierefreiheit reicht
    - Nicht relevant

### Phase 5: Extras (kontextabhängig)

Stelle weitere Fragen basierend auf den bisherigen Antworten:
- Wenn Web App → "Braucht es Echtzeit-Features? (Chat, Live-Updates, Notifications)"
- Wenn E-Commerce → "Wie viele Produkte? Varianten? Inventar-Tracking?"
- Wenn CMS → "Wer darf Inhalte bearbeiten? Braucht es einen Editor?"
- Wenn SaaS → "Welche Abo-Stufen? Free Tier? Trial?"
- Wenn Login → "Verschiedene Rollen nötig? (Admin, User, Editor, Moderator)"
- Wenn Datenbank → "Wie viele User erwartest du? Am Anfang? In einem Jahr?"
- Wenn Mobile App → "iOS, Android oder beides? React Native oder Flutter?"
- Wenn Mehrsprachig → "Welche Sprachen? Wer übersetzt?"

20. **Timeline**: "Gibt es eine Deadline oder einen Zeitrahmen?"

21. **Budget**: "Gibt es ein Budget für externe Services? (Hosting, APIs, Domains)"

### Phase 6: Empfehlung

Fasse die Anforderungen zusammen und empfehle:

```
## Projekt-Zusammenfassung

**Name:** [Projektname]
**Typ:** [Projekttyp]
**Beschreibung:** [2-3 Sätze]
**Zielgruppe:** [Wer]

## Empfohlener Tech-Stack

| Bereich | Empfehlung | Warum | Kosten |
|---------|-----------|-------|--------|
| Frontend | [Framework] | [Begründung] | [Kostenlos / $X/Monat] |
| Backend | [Framework] | [Begründung] | [Kostenlos / $X/Monat] |
| Datenbank | [DB] | [Begründung] | [Kostenlos / $X/Monat] |
| Hosting | [Anbieter] | [Begründung] | [Kostenlos / $X/Monat] |
| Auth | [Lösung] | [Begründung] | [Kostenlos / $X/Monat] |
| Design | Stitch / Lokal | [Begründung] | [Kostenlos] |
| UI-Bibliothek | [Lib] | [Begründung] | [Kostenlos] |

## Nächste Schritte
1. Tech-Stack bestätigen
2. Design erstellen (Stitch oder lokal)
3. Projekt aufsetzen (Scaffolding)
4. Cortex installieren (Lernsystem + Hooks)
```

Warte auf explizites OK bevor du weitergehst.

### Phase 7: Handoff an Scaffolding

Wenn der User zustimmt, übergib an den Scaffolding-Skill. Erstelle dabei eine Datei `.claude/project-brief.json`:

```json
{
  "name": "projektname",
  "type": "web-app",
  "description": "...",
  "features": ["feature1", "feature2"],
  "techStack": {
    "frontend": "Next.js 14",
    "backend": "API Routes",
    "database": "PostgreSQL + Prisma",
    "hosting": "Vercel",
    "auth": "NextAuth.js",
    "ui": "shadcn/ui + Tailwind"
  },
  "design": "stitch",
  "locale": "de",
  "seo": true,
  "a11y": "wcag-aa",
  "accounts": true,
  "payments": false
}
```

Dann aktiviere den Scaffolding-Skill mit diesem Brief.

## Rules

- One question per message — don't overwhelm the user
- Prefer multiple-choice over open questions — reduces cognitive load
- Explain technical terms in brackets (z.B. "Datenbank (ein digitaler Aktenschrank)")
- Give a recommendation with every question — the user may not know what to choose
- Never assume — if the user's answer is ambiguous, ask for clarification
- If the user says "mach einfach" or "du entscheidest" — make a reasonable choice and explain why
- Check the Learning-DB at the start for relevant project setup experience
- Factor in Cortex skills (Stitch, Browser Use, UI-UX-Guide) in your recommendations

## Gotchas

- This skill MUST complete before scaffolding can start
- Always use AskUserQuestion tool for structured questions, not free-text
- Don't skip tech stack discussion — the auto-detection in install.js depends on package.json
- Ask about deployment target early (Cloudflare, Vercel, Coolify, etc.)
