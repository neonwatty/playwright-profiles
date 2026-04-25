---
name: capture-auth
description: This skill should be used when the user asks to "capture auth for my app", "sign into deckchecker", "save login for seatify", "add my app to playwright auth", "authenticate to my site", "set up QA user profiles", "sign in as admin", "sign in as planner", or wants to set up reusable authenticated browsing for a custom web app. Triggers on app names, custom domains, multi-user/QA auth, or any request to save auth state for a URL that is not a well-known external service. Complements auth-browse (external services) by handling the user's own apps and custom sites.
---

# Capture Web App Authentication

Save reusable authenticated browser sessions for custom web apps (the user's own projects, client apps, staging environments, etc.) using the persistent Chrome profile at `~/.playwright-cli/`.

## How This Differs from auth-browse

- **auth-browse**: Preconfigured external services (Cloudflare, Sentry, Vercel, etc.) with known `waitFor` patterns
- **capture-auth**: The user's own apps — custom URLs where the post-login URL needs to be discovered

Both use the same `~/.playwright-cli/sign-in.mjs` script and shared Chrome profile.

## Workflow

### Step 1: Gather app details

Ask the user for:

1. **A short name** for the app (e.g., `deckchecker`, `seatify-staging`, `client-portal`). Used as the identifier for future sign-ins.
2. **The login URL** (e.g., `https://deckchecker.app/login`, `https://staging.seatify.app/login`).
3. **The post-login URL pattern** (optional). This is a URL substring that appears after successful sign-in — used for auto-detect. Examples:
   - `/dashboard` — most common
   - `/home`
   - `/events`
   - The app's domain alone if login redirects to a different domain

If the user does not know the post-login URL, suggest common patterns or tell them to skip it (the script will use manual Enter instead).

### Step 2: Register the site

Run via Bash:

```bash
node ~/.playwright-cli/sign-in.mjs add <name> <login-url> <wait-for-pattern>
```

Example:
```bash
node ~/.playwright-cli/sign-in.mjs add deckchecker https://deckchecker.app/login /dashboard
```

If no `waitFor` was provided, omit the third argument — the script defaults to the hostname.

### Step 3: Sign in

Tell the user to run the sign-in command in a separate terminal:

```
node ~/.playwright-cli/sign-in.mjs login <name>
```

This is interactive — Claude cannot run it. The user signs in manually. If a `waitFor` pattern was configured, the script auto-detects completion. Otherwise the user presses Enter.

After the user confirms sign-in is complete, verify:

```bash
node ~/.playwright-cli/sign-in.mjs check <name>
```

### Step 4: Test browsing

Open the app's authenticated page to verify the session works:

```bash
playwright-cli open <app-url> --headed --browser chrome --persistent --profile ~/.playwright-cli/chrome-profile
```

Take a snapshot to confirm the user is signed in. If the app redirects to the login page, the session may not have saved correctly — re-run sign-in.

### Step 5: Confirm and summarize

Tell the user:
- Their app is now registered as `<name>`
- Future sign-ins: `node ~/.playwright-cli/sign-in.mjs login <name>`
- To browse authenticated: just ask Claude to "open deckchecker" or "browse seatify"
- Auth state persists in the Chrome profile — different domains coexist, but multiple accounts on the same domain require `--profile` (see Multi-User section above)

## Multi-User / QA Profiles

For apps that need multiple authenticated users (e.g., testing admin vs planner roles), use `--profile` to isolate each user's Chrome session. Without `--profile`, all sign-ins share a single Chrome profile — meaning a second sign-in to the same domain overwrites the first user's cookies.

### Step 1: Register each user as a separate site

```bash
node ~/.playwright-cli/sign-in.mjs add seatify-admin https://seatify.app/login /dashboard
node ~/.playwright-cli/sign-in.mjs add seatify-planner https://seatify.app/login /dashboard
```

### Step 2: Sign in with isolated profiles

Tell the user to run each in a separate terminal:

```
node ~/.playwright-cli/sign-in.mjs login seatify-admin --profile seatify-admin
node ~/.playwright-cli/sign-in.mjs login seatify-planner --profile seatify-planner
```

The `--profile <name>` flag creates an isolated Chrome directory at `~/.playwright-cli/chrome-profile-<name>/`. Each user's session is completely independent.

### Step 3: Browse as a specific user

```bash
playwright-cli open https://seatify.app/dashboard --headed --browser chrome \
  --persistent --profile ~/.playwright-cli/chrome-profile-seatify-admin
```

To switch users, close the browser and re-open with a different profile path.

### Naming convention

Use `<app>-<role>` as both the site name and profile name: `seatify-admin`, `seatify-planner`, `deckchecker-owner`, `client-portal-reviewer`. This keeps auth files and Chrome profiles aligned.

## Handling Multiple Environments

For apps with multiple environments (production, staging, dev), register each as a separate site:

```bash
node ~/.playwright-cli/sign-in.mjs add seatify https://seatify.app/login /dashboard
node ~/.playwright-cli/sign-in.mjs add seatify-staging https://staging.seatify.app/login /dashboard
node ~/.playwright-cli/sign-in.mjs add seatify-dev http://localhost:3000/login /dashboard
```

Combine with `--profile` for multi-user across environments:

```bash
node ~/.playwright-cli/sign-in.mjs add seatify-staging-admin https://staging.seatify.app/login /dashboard
node ~/.playwright-cli/sign-in.mjs login seatify-staging-admin --profile seatify-staging-admin
```

## Common Post-Login Patterns

When helping the user determine the `waitFor` pattern, suggest these common patterns:

| Framework / Pattern | Typical post-login URL |
|---|---|
| Next.js with dashboard | `/dashboard` |
| SPA with hash routing | `#/home` or `#/dashboard` |
| Supabase Auth redirect | `/dashboard` or the `redirectTo` path |
| OAuth callback | The final redirect after `/auth/callback` |
| Multi-step onboarding | `/onboarding` or `/setup` |

If unsure, the user can sign in manually (Enter-based) first, then check the browser URL bar to discover the pattern. They can update the site config later with `add` (same name overwrites).

## Using Captured Auth

Once a session is captured, the user can ask Claude to browse the app naturally:

- "Open deckchecker and check the dashboard"
- "Browse seatify staging"
- "Go to the client portal"
- "Browse seatify as admin"
- "Check the planner view on seatify"

Claude should check auth status first, then open with the appropriate profile:

```bash
# Default profile (single-user apps)
playwright-cli open <url> --headed --browser chrome \
  --persistent --profile ~/.playwright-cli/chrome-profile

# Named profile (multi-user/QA)
playwright-cli open <url> --headed --browser chrome \
  --persistent --profile ~/.playwright-cli/chrome-profile-<name>
```

When the user mentions a role ("as admin", "as planner"), map it to the corresponding profile name.
