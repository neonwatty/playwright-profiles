---
name: use-profiles
description: This skill should be used when performing browser automation with Playwright MCP in a project that has `.playwright/profiles.json`, when the user mentions "use profile", "load profile", "browser as admin", "test as user", "browse as [role]", "switch profile", "authenticated browser", "logged in browser session", "open the site logged in", or when about to navigate to an authenticated page. Loads saved Playwright storageState authentication profiles so browser sessions start already logged in.
---

# Using Playwright Authentication Profiles

## Purpose

Load saved Playwright `storageState` authentication profiles before browser automation work. This eliminates the need to log in manually at the start of every browser session.

## When This Applies

This skill applies when ALL of the following are true:

1. The current project has a `.playwright/profiles.json` file
2. Browser automation work is about to begin (using Playwright MCP tools)
3. The target page requires authentication

## Profile Discovery

Check for `.playwright/profiles.json` at the project root. Read it to discover available profiles. The file contains entries like:

```json
{
  "profiles": {
    "admin": {
      "loginUrl": "https://example.com/login",
      "description": "Full permissions"
    }
  }
}
```

Each profile has a corresponding storageState file at `.playwright/profiles/<role-name>.json`.

## Profile Selection

Determine which profile to use based on conversation context:

- If the user mentions a specific role (e.g., "test the admin dashboard", "check the speaker view"), match it to a profile name from the config.
- If the user does not specify a role and only one profile exists, use it automatically.
- If the user does not specify a role and multiple profiles exist, ask which one to use. Present the available profiles with their descriptions.

## Loading a Profile

Before navigating to any authenticated page, load and validate the profile:

1. Verify the storageState file exists at `.playwright/profiles/<role-name>.json`. If it does not exist, inform the user and suggest running `/setup-profiles` to create it.

2. Read the storageState JSON file. It contains `cookies` and `origins` (localStorage) arrays.

3. **Pre-load health check (RT-08):** Before injecting cookies, inspect the cookie health:
   - For any cookie whose value starts with `base64-` (Supabase auth): decode the base64 payload (`Buffer.from(value.slice(7), 'base64').toString()`), parse the JSON, and check `expires_at`. If `expires_at < Date.now()/1000`, the session is expired.
   - For any cookie whose value looks like a JWT (three dot-separated base64url segments): decode the middle segment, parse the JSON, and check `exp`. If `exp < Date.now()/1000`, the JWT is expired.
   - For standard cookies: check the `expires` field. If `expires > 0` and `expires < Date.now()/1000`, the cookie is expired.
   - Count session-only cookies (`expires <= 0`). If >30% of cookies are session-only, note this.

   Report a summary: "Profile health: N valid, N expired, N session-only."

   **If ALL auth-relevant cookies (names matching `/auth|session|token|sid|jwt|identity|logged/i`) are expired:** Do not load the cookies. Instead, report: "All auth cookies in [role] profile are expired. Run `/setup-profiles` to refresh." Do not waste time loading dead cookies, navigating, and hitting a redirect.

   **If some cookies are valid:** Proceed to load them, but note the warnings.

4. **Cross-contamination check (RT-10):** Check the domains of all cookies in the profile. Extract unique domains. If cookies span more than 3 distinct domains that don't match the `loginUrl` hostname from the profile config, warn: "Profile contains cookies from N unrelated domains — consider recapturing with `/setup-profiles` for a cleaner profile."

5. Use `browser_run_code` (MCP tool: `mcp__playwright__browser_run_code`) to restore cookies only. Do NOT navigate to the app's origin to set localStorage first — this triggers client-side auth libraries (e.g., Supabase) that may clear the restored cookies.

   ```javascript
   async (page) => {
     const state = STATE_JSON_HERE;
     await page.context().addCookies(state.cookies);
     return "Profile loaded";
   };
   ```

6. Navigate directly to the target authenticated page. The cookies will be sent with the request and the app will recognize the session.

## Session Expiry Detection

After loading a profile and navigating to the target page, check whether the session is still valid. The primary heuristic: if the browser is redirected to a URL matching the `loginUrl` from the profile config, the session has likely expired.

If expiry is detected:

- Inform the user that the session for the profile appears to have expired
- Suggest running `/setup-profiles` to refresh it
- Do not attempt to log in automatically

This detection is best-effort. Not all apps redirect to the same login URL, so some expired sessions may not be caught by this heuristic. The user can always run `/setup-profiles` manually to refresh any profile.

## Missing Profiles

If `.playwright/profiles.json` exists but references profiles whose storageState files are missing (e.g., after a fresh clone), inform the user:

> "This project has Playwright profiles configured but the authentication state files are missing (they are gitignored and need to be created locally). Run `/setup-profiles` to authenticate."

## No Profile Config

If `.playwright/profiles.json` does not exist, this skill does not apply. Do not suggest creating profiles unless the user is explicitly asking about authenticated browser automation.
