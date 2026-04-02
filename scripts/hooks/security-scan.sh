#!/bin/bash
# Security scan after file edits
# Checks for common vulnerabilities

read -r INPUT

FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
CONTENT=$(echo "$INPUT" | sed -n 's/.*"content"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)
NEW_STRING=$(echo "$INPUT" | sed -n 's/.*"new_string"\s*:\s*"\([^"]*\)".*/\1/p' | head -1)

CHECK_TEXT="${CONTENT}${NEW_STRING}"

WARNINGS=""

# Check for hardcoded secrets
if echo "$CHECK_TEXT" | grep -qiE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}"; then
  WARNINGS="${WARNINGS}\n  ⚠️  Possible hardcoded secret detected"
fi

# Check for innerHTML (XSS risk)
if echo "$CHECK_TEXT" | grep -qiE "innerHTML|outerHTML|document\.write"; then
  WARNINGS="${WARNINGS}\n  ⚠️  innerHTML/document.write detected — XSS risk. Use textContent instead."
fi

# Check for eval (code injection risk)
if echo "$CHECK_TEXT" | grep -qE "eval\(|new Function\("; then
  WARNINGS="${WARNINGS}\n  ⚠️  eval() detected — code injection risk"
fi

# Check for SQL concatenation
if echo "$CHECK_TEXT" | grep -qiE "SELECT.*\+.*FROM|INSERT.*\+.*VALUES|WHERE.*\+"; then
  WARNINGS="${WARNINGS}\n  ⚠️  Possible SQL concatenation — use parameterized queries"
fi

# Check for http:// (should be https://)
if echo "$CHECK_TEXT" | grep -E "http://" | grep -qvE "localhost|127\.0\.0\.1|http://schemas"; then
  WARNINGS="${WARNINGS}\n  ⚠️  http:// detected — use https:// for production"
fi

# Check for console.log with sensitive data
if echo "$CHECK_TEXT" | grep -qiE "console\.(log|debug|info).*\b(password|token|secret|key)\b"; then
  WARNINGS="${WARNINGS}\n  ⚠️  console.log with sensitive data detected"
fi

# Guardian: API endpoint without auth middleware
if echo "$CHECK_TEXT" | grep -qiE "(app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch))" && ! echo "$CHECK_TEXT" | grep -qiE "(auth|authenticate|isAuthenticated|requireAuth|middleware|protect|verify)"; then
  # Only warn for route handlers, not static file serving
  if ! echo "$FILE_PATH" | grep -qiE "(static|public|assets|middleware)"; then
    WARNINGS="${WARNINGS}\n  🛡️  API endpoint may be missing auth middleware"
  fi
fi

# Guardian: Form without CSRF protection
if echo "$CHECK_TEXT" | grep -qiE "(method=['\"]POST['\"]|method=['\"]PUT['\"]|method=['\"]DELETE['\"])" && ! echo "$CHECK_TEXT" | grep -qiE "(csrf|_token|csrfToken|x-csrf)"; then
  WARNINGS="${WARNINGS}\n  🛡️  Form with POST/PUT/DELETE may need CSRF token"
fi

# Guardian: Unescaped user input in template
if echo "$CHECK_TEXT" | grep -qiE "(dangerouslySetInnerHTML|v-html|\{@html)"; then
  WARNINGS="${WARNINGS}\n  🛡️  Raw HTML rendering detected — ensure content is sanitized"
fi

# Guardian: Missing rate limiting on login/auth routes
if echo "$FILE_PATH" | grep -qiE "(login|auth|signin|register|signup)" && ! echo "$CHECK_TEXT" | grep -qiE "(rateLimit|rate.limit|throttle|limiter)"; then
  if echo "$CHECK_TEXT" | grep -qiE "(app\.(post|put)|router\.(post|put))"; then
    WARNINGS="${WARNINGS}\n  🛡️  Auth endpoint may need rate limiting"
  fi
fi

if [ -n "$WARNINGS" ]; then
  echo "🔒 Security Scan:${WARNINGS}" >&2
fi

exit 0
