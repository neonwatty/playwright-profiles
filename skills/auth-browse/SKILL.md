---
name: auth-browse
description: This skill should be used when the user asks to "sign into Cloudflare", "browse Sentry authenticated", "open Supabase dashboard", "log into Vercel", "check auth status", "authenticate to AWS", or any request to browse an external service that requires authentication using playwright-cli. Also triggers on "sign in to <site>", "authenticate to <site>", "open <site> logged in", "browse <service> for me". Complements use-profiles (per-project roles) by providing global persistent auth for external services with bot-detection bypass.
---

# Authenticated Browsing with Playwright CLI

Browse external services (Cloudflare, Sentry, PostHog, Supabase, Vercel, GitHub, AWS, etc.) using `playwright-cli` with persistent authentication that bypasses bot detection.

## How This Differs from use-profiles

- **use-profiles**: Per-project, role-based auth (admin/user/speaker) for the project's own app, using Playwright MCP
- **auth-browse**: Global, service-based auth for external dashboards (Cloudflare, Sentry, etc.) using `playwright-cli` with real Chrome to bypass bot detection

Both skills can coexist. Use `use-profiles` for testing your app with different roles. Use `auth-browse` for browsing third-party services.

## Architecture

All auth state lives in `~/.playwright-cli/`:

```
~/.playwright-cli/
├── sign-in.mjs              ← Sign-in script (bundled with this skill)
├── chrome-profile/           ← Persistent Chrome user data (shared across all sites)
├── sites.json                ← User-added custom site shortcuts
├── auth-cloudflare.json      ← Per-site cookie snapshots
├── auth-sentry.json
├── package.json              ← Playwright dependency
└── node_modules/
```

The persistent Chrome profile accumulates sessions from all sign-ins. When browsing with `--persistent --profile`, all sites are already authenticated.

## Setup

First-time setup requires installing the script and its dependency:

```bash
mkdir -p ~/.playwright-cli
cp <path-to-this-skill>/scripts/sign-in.mjs ~/.playwright-cli/sign-in.mjs
cd ~/.playwright-cli && npm init -y && npm install playwright
```

The script path for this skill is relative to the plugin install location. Use `Glob` to find it:

```
skills/auth-browse/scripts/sign-in.mjs
```

## Workflow

### Step 1: Check existing auth

```bash
node ~/.playwright-cli/sign-in.mjs check           # all sites
node ~/.playwright-cli/sign-in.mjs check cloudflare # specific site
```

If auth is valid, skip to Step 3.

### Step 2: Sign in (if needed)

The sign-in command is **interactive** — it opens Chrome for manual sign-in. This cannot be run via the Bash tool. Tell the user to run it in a separate terminal:

```
node ~/.playwright-cli/sign-in.mjs login <site>
```

The script auto-detects sign-in completion by watching the URL and saves automatically. It also accepts Enter as a manual fallback.

Do NOT use the Bash tool or `!` prefix — the command requires interactive stdin.

Built-in sites: `github`, `cloudflare`, `vercel`, `sentry`, `posthog`, `supabase`, `aws`, `netlify`, `railway`, `render`. Users can add custom sites:

```bash
node ~/.playwright-cli/sign-in.mjs add myapp https://myapp.com/login myapp.com/dashboard
```

For arbitrary URLs without adding a shortcut: `node ~/.playwright-cli/sign-in.mjs login https://example.com`

### Step 3: Browse authenticated

**Default (works for all sites including bot-protected ones):**

```bash
playwright-cli open <url> --headed --browser chrome --persistent --profile ~/.playwright-cli/chrome-profile
```

**Headless mode (simpler sites only — NOT Cloudflare, Google):**

```bash
playwright-cli open <url>
playwright-cli state-load ~/.playwright-cli/auth-<site>.json
playwright-cli reload
```

When unsure whether a site has bot detection, default to the headed/persistent approach.

### Navigating between services

Within a single `playwright-cli` session using the persistent profile, navigate freely between authenticated services:

```bash
playwright-cli goto https://sentry.io
playwright-cli goto https://dash.cloudflare.com
```

No re-authentication needed — the profile holds all sessions.

### Chrome Profile Lock

Only one Chrome process can use the profile at a time. If the sign-in script fails with "Opening in existing browser session":

```bash
kill $(pgrep -f "chrome-profile")
```

Then re-run the sign-in command.

## Additional Resources

### Reference Files

- **`references/bot-detection.md`** — Detailed explanation of Google OAuth and Cloudflare Turnstile detection mechanisms, why specific Chrome flags are needed, and per-site compatibility matrix

### Scripts

- **`scripts/sign-in.mjs`** — The sign-in script to install at `~/.playwright-cli/sign-in.mjs`
