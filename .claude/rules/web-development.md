---
description: Frontend and backend web development patterns
globs: "**/*.{js,ts,tsx,jsx,vue,svelte,html,css}"
---

# Web Development Rules

## Frontend
- Server Components as default; Client Components only for interactivity
- Mobile-first responsive design with Tailwind breakpoints
- Code splitting and lazy loading for route-level components
- Optimize images (WebP, next/image or equivalent)
- Named exports for all components
- No global CSS styles — use CSS Modules or Tailwind

## Backend / API
- kebab-case for URL paths
- camelCase for JSON properties
- Pagination for all list endpoints
- API versioning in the URL (/v1/, /v2/)
- Bearer Token Auth; Base URL in API_URL env var
- SDK instead of raw fetch for external API calls
- Rate limiting on all public endpoints

## Database
- Migrations for all schema changes — never manually alter the DB
- Parameterized queries — ALWAYS
- Indexes for frequently queried columns
- Soft delete instead of hard delete for important data

## Performance
- Lazy loading for images and heavy components
- Caching strategy for API responses
- Keep bundle size in check
- No synchronous API calls in the UI

## Browser Use CLI (Testing & Review)
For E2E tests and visual review: use the browser-use skill.
