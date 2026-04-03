---
description: Security rules — secrets, auth, input validation, XSS/CSRF/SQL injection prevention
globs: "**/*.{js,ts,tsx,py,sh,sql,html}"
---

# Security Rules

## Secrets
- NEVER: API keys, passwords, or tokens in code
- NEVER: Commit .env files
- MUST: All secrets via environment variables
- MUST: Maintain .env.example (without real values)

## Authentication
- MUST: Hash passwords (bcrypt, argon2)
- JWT with reasonable expiration
- HttpOnly + Secure + SameSite flags on session cookies
- Rate limiting on login endpoints

## Input Validation
- MUST: Validate all user inputs (type, length, format)
- MUST: Whitelist approach (allow only known good values)
- MUST: Validate on client AND server (client for UX, server for security)
- MUST: Length limits on all text inputs
- MUST: Encode/escape at output, not input

## SQL Injection
- MUST: Always use parameterized queries / prepared statements
- NEVER: String concatenation for SQL queries
- MUST: Use ORM when available (Prisma, Drizzle, SQLAlchemy)

## XSS Prevention
- NEVER: innerHTML, outerHTML, or document.write with user input
- MUST: Use textContent or framework escaping
- Caution: dangerouslySetInnerHTML (React), v-html (Vue), {@html} (Svelte) — only with sanitized content

## CSRF Prevention
- MUST: CSRF token in all POST/PUT/DELETE forms
- MUST: SameSite cookie attribute
- MUST: Validate Origin/Referer headers

## HTTP Headers
- Content-Security-Policy
- HTTPS enforced (HSTS)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY

## File Upload
- MUST: Validate file type server-side (not just extension)
- MUST: Limit file size
- MUST: Sanitize filenames (no path characters)
- NEVER: Store uploads in public webroot without validation

## Dangerous Operations
- NEVER: eval() with user input
- NEVER: innerHTML with user input
- NEVER: rm -rf without explicit user permission
- NEVER: curl | bash without explicit user permission
- NEVER: Shell commands with unescaped user input
