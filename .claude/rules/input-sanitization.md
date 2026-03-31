---
description: Input sanitization and XSS/CSRF/SQL injection prevention
globs: "src/**/*"
---

# Input-Sanitization

## Cross-Site Scripting (XSS) Prevention
- NEVER: innerHTML, outerHTML oder document.write mit User-Input
- MUST: textContent oder Framework-Escaping nutzen
- MUST: Content-Security-Policy Header setzen
- MUST: User-Input in Templates escapen (automatisch in React/Vue/Svelte)
- Achtung: dangerouslySetInnerHTML (React), v-html (Vue), {@html} (Svelte) nur mit sanitized Content

## SQL Injection Prevention
- MUST: IMMER Parameterized Queries / Prepared Statements
- NEVER: String-Concatenation für SQL-Queries
- MUST: ORM nutzen wenn verfügbar (Prisma, Drizzle, SQLAlchemy)
- MUST: Stored Procedures mit Parametern wenn kein ORM

## Cross-Site Request Forgery (CSRF)
- MUST: CSRF-Token in allen POST/PUT/DELETE Forms
- MUST: SameSite Cookie-Attribut setzen
- MUST: Origin/Referer Header validieren

## File Upload
- MUST: Dateityp auf Server-Seite validieren (nicht nur Extension)
- MUST: Dateigröße limitieren
- MUST: Dateinamen sanitizen (keine Pfad-Zeichen)
- NEVER: Uploads im öffentlichen Webroot speichern ohne Prüfung

## Allgemeine Regeln
- MUST: Whitelist-Approach (erlaube nur bekannte gute Werte)
- MUST: Validierung auf Client UND Server (Client für UX, Server für Sicherheit)
- MUST: Encoding/Escaping am Output, nicht am Input
- MUST: Längen-Limits für alle Text-Inputs
