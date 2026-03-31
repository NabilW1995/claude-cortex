---
name: scaffolding
description: Set up a new project based on the discovery interview results
trigger: After project-discovery skill completes and user approves the tech stack
---

# Project Scaffolding Skill

## Übersicht
Erstelle ein vollständiges Projekt-Gerüst basierend auf den Discovery-Ergebnissen. Nutze native CLI-Tools wo möglich. Passe CLAUDE.md an das spezifische Projekt an.

## Ablauf

### Step 1: Projekt erstellen
Nutze das passende CLI-Tool:

| Projekttyp | CLI-Tool |
|---|---|
| Next.js | `npx create-next-app@latest` |
| Vite (React/Vue/Svelte) | `npm create vite@latest` |
| Nuxt | `npx nuxi init` |
| SvelteKit | `npm create svelte@latest` |
| Express API | Manuelles Scaffold |
| React Native / Expo | `npx create-expo-app` |
| Flutter | `flutter create` |
| Django | `django-admin startproject` |
| FastAPI | Manuelles Scaffold |
| Astro | `npm create astro@latest` |

### Step 2: Basis-Dependencies installieren
Basierend auf den Discovery-Ergebnissen:
- Auth benötigt? → NextAuth.js / Lucia / Clerk
- Datenbank? → Prisma / Drizzle / SQLAlchemy + passende DB
- Styling? → Tailwind CSS / shadcn/ui / Material UI
- Testing? → Vitest + Playwright / pytest
- Payments? → Stripe SDK
- Email? → Resend / Nodemailer

### Step 3: Projekt-Struktur anlegen
- src/ mit passender Unterstruktur
- tests/ (unit, integration, e2e)
- public/ (statische Assets)
- docs/ (Projekt-Dokumentation)

### Step 4: CLAUDE.md aktualisieren
Fülle die Template-Platzhalter aus:
- [Projektname] → echter Name
- [Einzeilige Beschreibung] → aus Discovery
- [Projekt-Struktur] → tatsächliche Ordner
- Commands → tatsächliche npm Scripts

### Step 5: Git + Deployment
- `git init` (wenn gewünscht)
- `.gitignore` anpassen an Tech-Stack
- Deployment einrichten (wenn gewünscht)
- Erster Commit: "feat: initial project setup"

### Step 6: Cleanup
- Entferne Template-Dateien die nicht mehr gebraucht werden
- Entferne nicht gewählte Framework-Configs
- Validiere: `npm run dev` / `npm run build`

### Step 7: Übergabe
Zeige dem User:
1. Was erstellt wurde (Ordner-Übersicht)
2. Wie man das Projekt startet
3. Nächste empfohlene Schritte
4. Preview-Link (wenn Deployment eingerichtet)

## Regeln
- MUST: Native CLI-Tools nutzen wo verfügbar
- MUST: Immer validieren dass das Scaffold funktioniert
- MUST: CLAUDE.md mit den echten Projekt-Infos aktualisieren
- MUST: Erklären was erstellt wurde in einfacher Sprache
- NEVER: Mehr installieren als nötig — Minimal-Prinzip
- NEVER: Veraltete oder deprecated Packages nutzen
