---
description: Frontend and backend web development patterns
globs: "src/**/*"
---

# Web-Development Regeln

## Frontend
- Server Components als Standard; Client Components nur für Interaktivität
- Mobile-first responsive Design mit Tailwind Breakpoints
- Code-Splitting und Lazy Loading für Route-Level Components
- Bilder optimieren (WebP, next/image oder equivalent)
- Named Exports für alle Components
- Keine globalen CSS-Styles — nutze CSS Modules oder Tailwind

## Backend / API
- kebab-case für URL-Pfade
- camelCase für JSON Properties
- Pagination für alle Listen-Endpoints
- API-Versionierung in der URL (/v1/, /v2/)
- Bearer Token Auth; Base URL in API_URL env var
- SDK statt raw fetch für externe API-Calls
- Rate-Limiting auf allen öffentlichen Endpoints

## Datenbank
- Migrations für alle Schema-Änderungen — nie manuell die DB ändern
- Parameterized Queries — IMMER
- Indexe für häufig abgefragte Spalten
- Soft-Delete statt Hard-Delete für wichtige Daten

## Performance
- Lazy Loading für Bilder und schwere Components
- Caching-Strategie für API-Responses
- Bundle-Size im Auge behalten
- Keine synchronen API-Calls in der UI

## Browser Use CLI (Testing & Review)
- MUST: Browser Use CLI (`browser-use`) statt Playwright für E2E Tests und visuelles Review
- `browser-use open <url>` zum Testen, `browser-use screenshot` für visuelles Review
- `browser-use state` zeigt alle klickbaren Elemente mit Indizes
- `browser-use --headed open <url>` für sichtbaren Browser (Debugging)
- Sessions bleiben persistent — kein Neustart nötig zwischen Befehlen
