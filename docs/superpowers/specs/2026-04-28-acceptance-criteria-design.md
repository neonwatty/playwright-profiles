# Playwright Profiles Plugin — Acceptance Criteria

## Problem Statement

The plugin suffers from two categories of runtime failure:

1. **Auth expires quickly across all site types** — Supabase JWTs expire in ~1h, Cloudflare bot-management cookies rotate every 30min, server-side sessions (Sentry, PostHog) get cleaned up, session-only cookies are lost on context restart. The `check` command misreports these as valid because it only inspects cookie-level browser expiry, not the authentication payload inside.

2. **Chrome profile corruption** — Launching real Chrome (`/Applications/Google Chrome.app`) via `sign-in.mjs` while the user's Chrome is running triggers macOS singleton conflicts, causing Google sign-in state to be wiped across the user's real browser.

Both problems are silent — the plugin proceeds without warning until the user hits a login page or discovers their Google account is signed out everywhere.

## Approach

Three-layer acceptance criteria weighted toward runtime self-validation:

- **Layer C (Runtime assertions)** — Checks that fire every time a skill runs. Highest leverage because every real usage validates the plugin.
- **Layer B (Unit tests)** — Tests for pure logic in `sign-in.mjs` against fixture data. No browser needed, runs in CI.
- **Layer A (Manual verification)** — Checks requiring real services, real Chrome, or time-based observation. Run after version bumps or Chrome updates.

## Layer C: Runtime Assertions

These fire every time a skill runs. A failing assertion should block the skill from proceeding silently — it must either abort with a clear message or warn and let the user decide.

### sign-in.mjs — Pre-flight and Post-capture

#### RT-01: Chrome conflict detection

Before launching real Chrome via `launchPersistentContext`, check for running Chrome processes.

- **Pass:** If `pgrep -f "Google Chrome"` finds processes, abort with a message naming the conflict and suggesting the user quit Chrome first. Never launch a second real Chrome instance.
- **Fail:** Launches real Chrome while user's Chrome is running.
- **Current status:** FAIL

#### RT-02: Post-capture cookie quality report

After `storageState()` saves to an auth file, immediately analyze what was captured.

- **Pass:** Report includes: total cookies, count of session-only cookies (expires <= 0), count of auth-relevant cookies (matching `/auth|session|token|sid|jwt|identity|logged/i`), and a warning if zero auth cookies were captured or if >50% of cookies are session-only.
- **Fail:** Saves silently without validating contents.
- **Current status:** PARTIAL — `printCookieSummary` exists but doesn't warn on session-only cookies or missing auth cookies.

#### RT-03: Supabase JWT real expiry in check output

When `check` encounters a cookie value starting with `base64-`, decode the session JSON and report `expires_at` from the payload, not the cookie's browser-level `expires`.

- **Pass:** For a Supabase cookie with browser expiry 2027-05-23 but `session.expires_at` of 2026-04-18, reports "EXPIRED 244h ago" — not "9355h remaining."
- **Fail:** Reports cookie-shell expiry as the session lifetime.
- **Current status:** FAIL

#### RT-04: Generic JWT expiry detection

For any cookie whose value contains a JWT (three dot-separated base64url segments), decode the payload and check the `exp` claim.

- **Pass:** If `exp < now`, report the cookie as expired with the real remaining/elapsed time, regardless of the cookie's browser-level `expires` field.
- **Fail:** Reports cookie as valid when the JWT inside has expired.
- **Current status:** FAIL

#### RT-05: Session-only cookie warning

When `check` analyzes an auth file, count cookies with `expires <= 0` (session-only).

- **Pass:** If session-only cookies represent >30% of total cookies, display a warning: "N session-only cookies will not survive state-load — use persistent profile instead."
- **Fail:** No distinction between persistent and session-only cookies.
- **Current status:** FAIL

#### RT-06: Profile lock detection

Before launching Chrome with a profile directory, check for an existing lock.

- **Pass:** If `SingletonLock` or `lockfile` exists in the profile directory, report which process holds it and suggest killing it. Don't attempt the launch.
- **Fail:** Crashes with an opaque Playwright error about "existing browser session."
- **Current status:** PARTIAL — catches the error in the `catch` block but only after the failed launch attempt.

### use-profiles skill — Pre-load and Post-load

#### RT-07: Profile file existence check

Before attempting to load a profile, verify the `.playwright/profiles/<role>.json` file exists on disk.

- **Pass:** If missing, report which profiles are defined in `profiles.json` vs. which files exist on disk. Suggest `/setup-profiles` only for missing ones.
- **Fail:** Attempts to read a nonexistent file and errors.
- **Current status:** PASS

#### RT-08: Pre-load session health check

Before injecting cookies, read the profile file and check whether the session inside is still valid.

- **Pass:** For Supabase cookies (`base64-` prefix), decode and check `expires_at`. For JWT cookies, check `exp` claim. For standard cookies, check `cookie.expires`. Report a per-cookie health summary: N valid, N expired, N session-only. If all auth cookies are expired, skip loading and suggest `/setup-profiles` directly — don't waste time loading dead cookies and navigating to a redirect.
- **Fail:** Loads cookies blindly, navigates, hits login redirect, then suggests refresh.
- **Current status:** FAIL

#### RT-09: Post-load redirect detection

After loading cookies and navigating to the target page, check whether the final URL matches the `loginUrl` from the profile config.

- **Pass:** If redirected to `loginUrl`, report "Session expired for [role]" within 5 seconds of navigation. Don't proceed with the workflow.
- **Fail:** Proceeds with automation against a login page.
- **Current status:** PASS

#### RT-10: Cross-contamination detection

After loading a profile, check whether injected cookies include domains unrelated to the project's app.

- **Pass:** Warn if a profile contains cookies from >3 distinct domains that don't match the `loginUrl` hostname.
- **Fail:** Silently injects cookies across many unrelated domains.
- **Current status:** FAIL

### auth-browse skill — Tier selection and safety

#### RT-11: Tier selection validation

When browsing a site, validate that the chosen tier (state-load vs. persistent profile) is compatible with the target site.

- **Pass:** Cross-reference the target URL's domain against the compatibility matrix defined in `references/bot-detection.md` (and hardcoded as a domain list in the skill instructions). If the site requires Tier 2 (persistent profile) and the user/skill is attempting Tier 1 (state-load), warn and suggest the correct tier. At minimum, domains matching `cloudflare.com`, `google.com`, `accounts.google.com`, and `console.aws.amazon.com` must always use Tier 2.
- **Fail:** Attempts state-load against a bot-protected site, fails silently.
- **Current status:** FAIL

#### RT-12: Auth freshness check before browsing

Before browsing an external service, run the equivalent of `check <site>` and validate the auth state.

- **Pass:** If the auth file doesn't exist, or if all auth cookies are expired (using RT-03/RT-04 real expiry logic), report the status and prompt for re-auth before proceeding.
- **Fail:** Loads stale auth, navigates, hits login page.
- **Current status:** FAIL

### capture-auth skill — Capture quality

#### RT-13: Post-capture validation for custom apps

After capturing auth for a custom app, validate the saved state.

- **Pass:** Run `check <site>` automatically after capture. Verify at least one auth-relevant cookie exists. If the app uses Supabase (detectable by `sb-*-auth-token` cookie name), decode and report the real session TTL. Warn if the session will expire in <2 hours.
- **Fail:** Saves and reports success without validating what was captured.
- **Current status:** PARTIAL — `performLogin` calls `printCookieSummary` but with misleading expiry reporting.

#### RT-14: Domain filtering on capture

When saving auth state for a specific site/app, filter the captured `storageState` to only include cookies relevant to that site.

- **Pass:** Saved auth file contains only cookies whose domain matches the target site's URL domain (including subdomains and common auth providers). Unrelated domains are excluded.
- **Fail:** `storageState()` dumps all cookies from the entire browser context.
- **Current status:** FAIL

## Layer B: Unit Tests

These test pure logic inside `sign-in.mjs` against fixture data. No browser needed — runs in CI. Requires extracting pure functions from the script so they're importable without side effects.

### Cookie Analysis

#### UT-01: Supabase base64 cookie decoding

Given a cookie value starting with `base64-`, decode the session JSON and extract `access_token`, `refresh_token`, and `expires_at`.

- **Pass:** For a fixture cookie with `base64-eyJhY2Nlc3...`, returns parsed object with all three fields. For a non-`base64-` value, returns null (not an error).
- **Input:** Fixture files with real Supabase cookie structure (redacted tokens).

#### UT-02: JWT exp claim extraction

Given a JWT string (three dot-separated segments), decode the payload and return the `exp` timestamp.

- **Pass:** For a fixture JWT with `exp: 1713470579`, returns that timestamp. For a malformed JWT, returns null gracefully.
- **Input:** Fixture JWTs with known expiry values.

#### UT-03: Cookie classification

Given a cookies array from a storageState file, classify each cookie into categories.

- **Pass:** Returns counts for: `expired` (browser expiry < now), `session_only` (expires <= 0), `jwt_expired` (cookie valid but JWT `exp` < now), `supabase_expired` (cookie valid but `session.expires_at` < now), `valid`, `ephemeral` (in the EPHEMERAL set). Sum of all categories equals total cookie count.
- **Input:** Fixture storageState files representing each category.

#### UT-04: Auth cookie detection regex

The pattern `/auth|session|token|sid|jwt|identity|logged/i` correctly identifies auth-relevant cookies.

- **Pass:** Matches `sb-xxx-auth-token`, `user_session`, `__cf_logged_in`, `JSESSIONID`, `jwt-access`. Does NOT match `_ga`, `ph_phc_xxx_posthog`, `__cf_bm`, `_fbp`.
- **Input:** Array of real cookie names from captured auth files.

#### UT-05: Ephemeral cookie filtering

The EPHEMERAL set is excluded from expiry calculations.

- **Pass:** When computing "soonest expiry," ephemeral cookies are skipped. A file where `__cf_bm` expired 77h ago but auth cookies are valid reports healthy status.
- **Current status:** PASS — existing logic already filters these.

### Profile Path Logic

#### UT-06: Profile directory construction

`profileDir(name)` returns the correct path for default and named profiles.

- **Pass:** `profileDir(undefined)` and `profileDir('default')` return `~/.playwright-cli/chrome-profile`. `profileDir('seatify-admin')` returns `~/.playwright-cli/chrome-profile-seatify-admin`. Path traversal attempts (`../../etc/passwd`) are rejected by `validateName`.

#### UT-07: Auth file path construction

`authFile(site)` returns the correct path and sanitizes the site name.

- **Pass:** `authFile('cloudflare')` returns `~/.playwright-cli/auth-cloudflare.json`. Characters outside `[a-zA-Z0-9_-]` are replaced with `-`.

### Site Config

#### UT-08: Site loading with custom overrides

`loadSites()` merges DEFAULT_SITES with user's `sites.json`.

- **Pass:** Custom sites are added. A custom site with the same name as a default overrides it. All 10 defaults are present when no `sites.json` exists.

#### UT-09: Site loading with corrupted file

`loadSites()` handles a malformed `sites.json` gracefully.

- **Pass:** Returns DEFAULT_SITES unchanged and prints a warning. Does not throw.

### Check Command Output Accuracy

#### UT-10: Check output against known-state fixtures

Given fixture auth files with known cookie states, verify the check logic produces correct output.

- **Pass:** Five fixture files representing:
  1. All cookies valid — reports healthy with soonest expiry
  2. All auth cookies expired — reports expired with elapsed time
  3. Cookie valid but JWT expired — reports JWT expiry not cookie expiry
  4. Cookie valid but Supabase `expires_at` passed — reports session expiry
  5. 100% session-only cookies — warns about state-load incompatibility

### Domain Filtering

#### UT-11: Cookie domain filtering

Given a target URL and a cookies array, filter to only relevant domains.

- **Pass:** For target `http://localhost:3000` — returns only `localhost` cookies. For target `https://dash.cloudflare.com` — returns `.cloudflare.com` and `accounts.google.com` (OAuth provider). Subdomain matching works (`.cloudflare.com` matches `dash.cloudflare.com`).

## Layer A: Manual Verification

Run after plugin version bumps, Chrome updates, or when adding support for new sites.

#### MN-01: Chrome singleton behavior on macOS

With real Chrome open and signed into Google, attempt `node ~/.playwright-cli/sign-in.mjs login cloudflare`.

- **Pass:** RT-01 blocks the launch with a clear message. Real Chrome's Google sessions are unaffected.
- **Fail:** Chrome launches and real Chrome loses Google sign-in state.
- **Frequency:** After changes to `launchBrowser()` or Chrome launch flags. After Chrome major version updates.

#### MN-02: Cloudflare persistent profile session lifetime

Sign into Cloudflare via `sign-in.mjs` (real Chrome closed). Browse Cloudflare at 1h, 4h, and 24h intervals.

- **Pass:** Session valid for at least 4 hours. At 24h, if expired, `check cloudflare` accurately reports the expiry.
- **Frequency:** Quarterly, or after Cloudflare auth flow changes.

#### MN-03: Supabase app session lifetime via state-load

Run `/setup-profiles` for a Supabase app. Load the profile at 15min, 1h, and 4h intervals.

- **Pass:** At 15min, session works. At 1h, if JWT expired, RT-08 detects it pre-load and reports real expiry. At 4h, skill suggests `/setup-profiles` without navigating first.
- **Frequency:** After changes to `use-profiles` skill or Supabase auth configuration.

#### MN-04: Bot detection bypass still works

Sign into Google OAuth and Cloudflare using `sign-in.mjs`.

- **Pass:** Google does not show "This browser or app may not be secure." Cloudflare does not present a Turnstile challenge.
- **Frequency:** After Chrome major version updates. After changes to launch flags.

#### MN-05: Multi-user profile isolation

Sign into the same app as two users with `--profile user-a` and `--profile user-b`.

- **Pass:** Separate profile directories. Browsing with profile A shows user A's session. Switching to profile B shows user B's session. No cross-contamination.
- **Frequency:** After changes to `profileDir()` or `--profile` flag handling.

#### MN-06: state-load vs. persistent profile tier accuracy

For each site in the compatibility matrix, verify the documented tier still works.

- **Pass:** Sites listed as "Works" with state-load actually work. Sites listed as "Blocked" with headless actually get blocked.
- **Frequency:** Quarterly, or when users report auth failures on a specific site.

## Summary

| Layer                   | Count | Currently passing | Currently failing                  |
| ----------------------- | ----- | ----------------- | ---------------------------------- |
| C — Runtime assertions  | 14    | 2 full, 2 partial | 10                                 |
| B — Unit tests          | 11    | 1                 | 10 (functions not yet extractable) |
| A — Manual verification | 6     | Unknown           | Unknown                            |

### Implementation prerequisites

1. **Extract pure functions from `sign-in.mjs`** — Cookie analysis, JWT decoding, domain filtering, profile path construction must be importable without side effects (no `console.log`, no `process.exit`). This enables Layer B testing.
2. **Add vitest to the plugin repo** — Test runner for Layer B. Fixture files under `tests/fixtures/`.
3. **Update skill markdown files** — Layer C assertions are instructions to Claude (the skill executor). The skill docs must describe the checks Claude should perform before and after each action.
4. **Add pre-flight checks to `sign-in.mjs`** — RT-01 (Chrome conflict) and RT-06 (profile lock) are script-level checks that run before browser launch.
5. **Create manual verification checklist** — Layer A as a runnable checklist in the repo (e.g., `docs/manual-verification.md`).
