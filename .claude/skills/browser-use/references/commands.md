# Browser Use CLI — Full Command Reference

## Navigation

| Command | Description |
|---------|------------|
| `browser-use open <url>` | Open URL in headless browser |
| `browser-use --headed open <url>` | Open URL with visible browser window |
| `browser-use close --all` | Close all browser sessions |

## State & Inspection

| Command | Description |
|---------|------------|
| `browser-use state` | Show all visible interactive elements with indices |
| `browser-use doctor` | Check installation (Python, browser, dependencies) |

## Interaction

| Command | Description |
|---------|------------|
| `browser-use click <index>` | Click element by index |
| `browser-use input <index> "text"` | Type text into input field |
| `browser-use scroll down` | Scroll page down |
| `browser-use scroll up` | Scroll page up |

## Capture

| Command | Description |
|---------|------------|
| `browser-use screenshot` | Screenshot to temp directory |
| `browser-use screenshot <path>` | Screenshot to specific file |

## Advanced

| Command | Description |
|---------|------------|
| `browser-use eval "js code"` | Execute arbitrary JavaScript |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `PYTHONIOENCODING=utf-8` | Required on Windows (emoji fix) |

## Docs

- Official: https://docs.browser-use.com/open-source/browser-use-cli
- GitHub: https://github.com/browser-use/browser-use
