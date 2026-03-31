---
description: Security rules and best practices
globs: "**/*"
---

# Sicherheitsregeln

## Secrets
- NEVER: API Keys, Passwörter oder Tokens im Code
- NEVER: .env Dateien committen
- MUST: Alle Secrets über Environment Variables
- MUST: .env.example pflegen (ohne echte Werte)

## Authentication
- Passwörter IMMER hashen (bcrypt, argon2)
- JWT mit angemessener Expiration
- HttpOnly + Secure + SameSite Flags auf Session-Cookies
- Rate-Limiting auf Login-Endpoints (Brute-Force Prevention)

## Input-Handling
- ALLE User-Inputs validieren: Typ, Länge, Format
- SQL: IMMER Parameterized Queries
- HTML: IMMER Escapen bevor User-Input angezeigt wird
- URLs: IMMER URL-encode für User-generierte URL-Parameter
- Dateipfade: IMMER Path-Traversal-Check

## HTTP Security
- Content-Security-Policy Header
- CSRF-Token in allen State-ändernden Forms
- HTTPS erzwingen (HSTS Header)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY (Clickjacking Prevention)

## Gefährliche Operationen
- NEVER: eval() mit User-Input
- NEVER: innerHTML mit User-Input → textContent nutzen
- NEVER: `rm -rf` ohne explizite User-Anweisung
- NEVER: `curl | bash` ohne explizite User-Anweisung
- NEVER: Shell-Commands mit unescaptem User-Input
