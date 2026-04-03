# Supported Tech Stacks

The install.js auto-detection checks package.json for these frameworks:

## Frontend Frameworks
- **Next.js** — `next` in dependencies
- **Nuxt** — `nuxt` in dependencies
- **SvelteKit** — `@sveltejs/kit` in dependencies
- **Astro** — `astro` in dependencies
- **Vite** — `vite` in dependencies

## UI Libraries
- **React** — `react` (standalone, not via Next.js)
- **Vue** — `vue` (standalone, not via Nuxt)
- **Angular** — `@angular/core`
- **Svelte** — `svelte` (standalone)

## Databases
- **Prisma** — `prisma` or `@prisma/client`
- **Drizzle** — `drizzle-orm`
- **MongoDB** — `mongoose`
- **SQLite** — `better-sqlite3` or `sql.js`

## Auth
- **NextAuth.js** — `next-auth`
- **Clerk** — `@clerk/nextjs`
- **Better Auth** — `better-auth`
- **Lucia** — `lucia`

## UI Component Libraries
- **shadcn/ui** — `@radix-ui/react-slot` or `components.json` exists
- **Material UI** — `@mui/material`
- **Tailwind CSS** — `tailwindcss`

## Testing
- **Vitest** — `vitest`
- **Jest** — `jest`
