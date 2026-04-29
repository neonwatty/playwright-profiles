# Chrome Coexistence Design

## Problem

The `sign-in.mjs login` command launches real Chrome (`/Applications/Google Chrome.app`) via Playwright's `launchPersistentContext`. macOS Chrome enforces a singleton per binary — only one instance can run at a time. When the user's personal Chrome is already open (which is almost always), `login` either corrupts session state across both instances or is blocked by the `checkChromeRunning` safety guard added in PR #3.

This makes `login` unusable without quitting Chrome first. For services that need frequent re-auth (Supabase JWT expires ~1hr, custom apps during development), the quit-and-relaunch cycle is a real workflow blocker.

## Solution: Two-Binary Strategy

Use Playwright's bundled Chromium as the default browser for `login`. Chromium is a separate binary from the user's Chrome — macOS allows both to run simultaneously. Real Chrome is only used when explicitly requested (for sites with bot detection that blocks Chromium).

### Tier Model

Each site has a `tier` property:

- **`chromium`** (default) — Uses Playwright's bundled Chromium. No singleton conflict with the user's Chrome. Works for most sites and all custom apps.
- **`chrome`** — Uses real Chrome (`/Applications/Google Chrome.app`). Required for sites with bot detection (Cloudflare Turnstile, Google OAuth "This browser is not secure" blocks). Requires the user's Chrome to be closed.

### Tier Resolution

Precedence (highest to lowest):

1. `--tier chrome|chromium` CLI flag on `login` command
2. `tier` field in `sites.json` for that site (learned preference)
3. Default: `chromium`

### Persistence

When the user passes `--tier chrome` on the command line, the script writes `"tier": "chrome"` into `sites.json` for that site immediately (before launching the browser). This ensures the preference is saved even if the user aborts the login. Future `login` calls for that site automatically use the saved tier without the flag. `--tier chromium` resets it back.

### Site Config Shape

`sites.json` entries gain an optional `tier` field:

```json
{
  "supabase": {
    "url": "https://supabase.com/dashboard",
    "waitFor": "/projects",
    "tier": "chrome"
  },
  "deckchecker": {
    "url": "https://deckchecker.app/login",
    "waitFor": "/dashboard"
  }
}
```

Omitted `tier` means `chromium` (the default). Built-in `DEFAULT_SITES` all default to `chromium` — no hardcoded exceptions for any site.

### Browser Launch Behavior

**`chromium` tier:**

```javascript
chromium.launchPersistentContext(dir, {
  headless: false,
});
```

- No `executablePath` — uses Playwright's bundled Chromium
- `checkChromeRunning` is skipped (no singleton conflict)
- `checkProfileLock` still runs (profile lock applies regardless of binary)
- Still headed — user signs in manually in the browser window
- Still persistent — cookies accumulate in the profile directory

**`chrome` tier:**

```javascript
chromium.launchPersistentContext(dir, {
  executablePath: CHROME_PATH,
  headless: false,
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
});
```

- Same as current behavior
- `checkChromeRunning` fires — blocks launch if Chrome is open
- Anti-automation flags stripped for bot detection bypass

### Profile Directories

Both tiers share the same profile directories (`~/.playwright-cli/chrome-profile/` or `chrome-profile-<name>/`). Chrome and Chromium profile formats are compatible — cookies transfer if the user switches tiers for the same site.

### User Guidance on Failure

After every `login`, the script prints a cookie summary via `check`. If the result shows `EXPIRED` or no auth cookies were saved, the output includes:

```
Tip: if sign-in was blocked, retry with: node sign-in.mjs login <site> --tier chrome
```

No auto-detection of Google OAuth failures — the user saw the browser and knows whether they were blocked. The hint provides the escape hatch.

When `--tier chrome` is used and succeeds, the tier is saved. The user never needs to pass the flag for that site again.

## What Changes

- `launchBrowser(profileName)` signature becomes `launchBrowser(profileName, tier)`
- `checkChromeRunning` — only called when `tier === "chrome"`
- `DEFAULT_SITES` — each entry conceptually defaults to `tier: "chromium"` (no explicit field needed since omitted means chromium)
- `performLogin` — resolves tier from CLI flag > sites.json > default, passes to `launchBrowser`, saves tier to sites.json when `--tier` flag is provided
- `login` CLI — accepts `--tier chrome|chromium` flag
- Post-login summary — adds hint when auth looks empty/expired

## What Does NOT Change

- `check` command — unchanged
- `list` command — unchanged
- Cookie analysis module (`cookie-analysis.mjs`) — untouched
- Domain filtering — untouched
- Profile directories — same paths, shared between tiers
- `state-load` browsing — unaffected (no browser launch involved)

## Tests

- Tier resolution precedence: CLI flag > sites.json > default
- `checkChromeRunning` skipped when tier is `chromium`
- `launchBrowser` called without `executablePath` when tier is `chromium`
- `launchBrowser` called with `executablePath` and anti-automation args when tier is `chrome`
- `--tier` flag persists to `sites.json` after successful login
- Omitted tier in sites.json resolves to `chromium`

## Skill Doc Updates

- `auth-browse/SKILL.md` — mention tier selection, update Tier 1/Tier 2 guidance to reference `--tier` flag
- `capture-auth/SKILL.md` — note that custom apps default to `chromium` (no Chrome conflict)
- `commands/setup-auth-browse.md` — no change needed (setup copies scripts, not config)
