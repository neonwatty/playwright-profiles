# playwright-profiles

Manage Playwright authentication profiles for Claude Code — both per-project role-based profiles and global persistent auth for external services.

## What it does

### Per-project profiles (role-based)

- **`/setup-profiles`** — Interactive command to create authenticated browser profiles for each user role in your project. Opens a headed Playwright browser, lets you log in manually, then saves the session state.
- **`use-profiles` skill** — Automatically discovers and loads saved auth profiles when Claude does browser work, so you don't have to log in every session.

### Global auth browsing (service-based)

- **`/setup-auth-browse`** — One-time setup to install the sign-in script and authenticate to external services (Cloudflare, Sentry, PostHog, Supabase, Vercel, AWS, etc.).
- **`auth-browse` skill** — Browse external service dashboards using `playwright-cli` with persistent auth. Uses real Chrome with automation flags stripped to bypass Google OAuth and Cloudflare Turnstile bot detection.

### Custom app auth (capture-auth)

- **`capture-auth` skill** — Capture and reuse authenticated sessions for your own web apps (deckchecker, seatify, client portals, staging environments, etc.). Register a custom app with a name, login URL, and post-login pattern, then sign in once and browse authenticated from any Claude session.

## Prerequisites

- Claude Code
- `@playwright/mcp` (installed automatically via npx) — for per-project profiles
- `playwright-cli` — for auth-browse (installed separately)
- Google Chrome — for auth-browse (uses real Chrome, not bundled Chromium)

This plugin bundles its own Playwright MCP server config. If you also have the official `playwright@claude-plugins-official` plugin installed, disable it to avoid running two MCP server instances. The Playwright MCP server runs in headed mode by default, which is required for interactive login.

## Usage

### Per-project profiles

In any project directory:

```
/setup-profiles
```

Claude will:
1. Ask what user roles you need (e.g., admin, planner, speaker)
2. Ask for the login URL
3. Open a browser for each role — log in manually
4. Save the authenticated state to `.playwright/profiles/`
5. Update `.gitignore` to prevent committing auth data
6. Add a Playwright Profiles section to `CLAUDE.md`

Once set up, just mention a role when asking Claude to do browser work:

- "Test the admin dashboard"
- "Check the speaker view"
- "Browse the site as a planner"

Claude automatically loads the right profile before navigating.

### Global auth browsing

First-time setup:

```
/setup-auth-browse
```

Claude will install the sign-in script at `~/.playwright-cli/` and walk you through authenticating to your services.

For subsequent sign-ins, run in a terminal:

```bash
node ~/.playwright-cli/sign-in.mjs login cloudflare
node ~/.playwright-cli/sign-in.mjs login sentry
node ~/.playwright-cli/sign-in.mjs login https://any-site.com
```

The script opens real Chrome (automation flags stripped), you sign in manually, and it auto-detects completion and saves auth state.

Then ask Claude to browse any authenticated service:

- "Open the Cloudflare dashboard"
- "Check Sentry errors"
- "Browse PostHog analytics"

Claude uses `playwright-cli` with the persistent Chrome profile — all services are authenticated in a single session.

**Built-in sites:** github, cloudflare, vercel, sentry, posthog, supabase, aws, netlify, railway, render

**Add custom sites:**

```bash
node ~/.playwright-cli/sign-in.mjs add myapp https://myapp.com/login myapp.com/dashboard
```

**Check auth status:**

```bash
node ~/.playwright-cli/sign-in.mjs check
```

### Multi-user / QA profiles

For apps where you need separate sessions for different users (e.g., admin vs planner), use `--profile` to isolate Chrome profiles:

```bash
# Register each user as a separate site
node ~/.playwright-cli/sign-in.mjs add myapp-admin https://myapp.com/login /dashboard
node ~/.playwright-cli/sign-in.mjs add myapp-planner https://myapp.com/login /dashboard

# Sign in with isolated profiles (run in separate terminal)
node ~/.playwright-cli/sign-in.mjs login myapp-admin --profile myapp-admin
node ~/.playwright-cli/sign-in.mjs login myapp-planner --profile myapp-planner

# Browse as a specific user (own apps — use state-load, headless-friendly)
playwright-cli open https://myapp.com/dashboard
playwright-cli state-load ~/.playwright-cli/auth-myapp-admin.json
playwright-cli reload

# Browse bot-protected sites — use persistent profile (headed, real Chrome)
playwright-cli open https://myapp.com/dashboard --headed --browser chrome \
  --persistent --profile ~/.playwright-cli/chrome-profile-myapp-admin
```

Each `--profile <name>` creates an independent Chrome user data directory (`chrome-profile-<name>/`), so cookies from different accounts never conflict.

### Two browsing modes

| Mode | Command | Headless | Session isolation | Use when |
|------|---------|----------|-------------------|----------|
| `state-load` | `playwright-cli state-load auth-<site>.json` | Yes | Preserved | Your own apps, simple sites |
| `--persistent --profile` | `playwright-cli open --headed --browser chrome --persistent --profile ...` | No | Overridden | Cloudflare, Google OAuth, AWS |

**Default to `state-load`** — it injects cookies into the existing session without interfering with per-repo `cli.config.json` or `PLAYWRIGHT_CLI_SESSION` isolation. Fall back to `--persistent --profile` only when the site has bot detection that rejects headless browsers.

### Refreshing expired sessions

**Per-project profiles:** Run `/setup-profiles` again to refresh specific profiles.

**Global auth:** Run `node ~/.playwright-cli/sign-in.mjs login <site>` for any expired service.

## How auth-browse bypasses bot detection

Google OAuth and Cloudflare Turnstile block automated browsers. The sign-in script uses four techniques to bypass detection:

1. **Real Chrome executable** — not Playwright's bundled Chromium
2. **Headed mode** — headless rendering is blocked by Cloudflare regardless of other flags
3. **`--enable-automation` stripped** — removes the automation signal
4. **`AutomationControlled` disabled** — prevents `navigator.webdriver = true`

A persistent Chrome profile (`~/.playwright-cli/chrome-profile/`) accumulates sessions across all services. When browsing with `playwright-cli --persistent --profile`, every service is already authenticated.

For sites with aggressive bot detection (Cloudflare), headed mode (`--headed`) is required — headless gets blocked regardless of cookies.

## Files

### Per-project files

| File | Committed? | Purpose |
|------|-----------|---------|
| `.playwright/profiles.json` | Yes | Role names, login URLs, descriptions |
| `.playwright/profiles/*.json` | No (gitignored) | storageState auth data |

### Global files (auth-browse)

| File | Purpose |
|------|---------|
| `~/.playwright-cli/sign-in.mjs` | Sign-in script |
| `~/.playwright-cli/chrome-profile/` | Default Chrome profile (shared) |
| `~/.playwright-cli/chrome-profile-<name>/` | Isolated profiles (`--profile` flag) |
| `~/.playwright-cli/sites.json` | Custom site shortcuts |
| `~/.playwright-cli/auth-*.json` | Per-site cookie snapshots |

## Security

- No credentials are stored anywhere — only session cookies and localStorage
- Per-project storageState files are gitignored
- Global auth files live in `~/.playwright-cli/` (user home, never committed)
- Only role names, login URLs, and descriptions are committed (per-project)
- The sign-in script uses your real Chrome — no proxy, no credential interception
