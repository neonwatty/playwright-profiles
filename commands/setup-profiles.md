---
description: Create or refresh Playwright authentication profiles for the current project
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_storage_state, mcp__playwright__browser_set_storage_state, mcp__playwright__browser_close, mcp__plugin_playwright_playwright__browser_navigate, mcp__plugin_playwright_playwright__browser_snapshot, mcp__plugin_playwright_playwright__browser_storage_state, mcp__plugin_playwright_playwright__browser_set_storage_state, mcp__plugin_playwright_playwright__browser_close
---

# Setup Playwright Authentication Profiles

Set up persistent Playwright `storageState` authentication profiles for the current project. This enables authenticated browser automation without logging in every session.

## Step 1: Check MCP Configuration

Before anything else, verify that the Playwright MCP server is configured with the required capabilities.

Check the project's `.mcp.json` and the user's global MCP config (`~/.claude/.mcp.json` or `~/.claude/settings.json`) for a Playwright MCP server entry.

**Required flags:**
- `--caps=storage` — enables `browser_storage_state` and `browser_set_storage_state` tools
- `--headless=false` — enables headed mode so the user can interact with the browser

If either flag is missing, inform the user and help them update their MCP config. Example config:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--caps=storage", "--headless=false"]
    }
  }
}
```

Do NOT proceed until the Playwright MCP server is properly configured. If the config was just updated, inform the user they may need to restart Claude Code for MCP changes to take effect.

## Step 2: Check for Existing Profiles

Check if `.playwright/profiles.json` already exists in the project root.

**If it exists:** Read it and present the existing profiles to the user. Ask whether they want to:
- Refresh specific existing profiles (ask which ones)
- Add new profiles
- Refresh all profiles

Then skip to the appropriate step below.

**If it does not exist:** Proceed to Step 3 for fresh setup.

## Step 3: Define Profiles

Ask the user the following questions, one at a time:

1. **What user roles/profiles do you need?** (e.g., "admin, planner, speaker" or just "user")
2. **What is the login URL?** Ask per-profile if they might differ, but often all roles share the same login page.
3. **Optional: brief description for each role** (e.g., "Full admin permissions" or "Can only view assigned decks"). If the user skips this, generate reasonable descriptions based on the role names.

For projects spanning multiple apps, suggest using descriptive prefixed names (e.g., `admin-panel-admin`, `storefront-buyer`).

## Step 4: Write Configuration

Create the directory structure:
```
.playwright/
  profiles.json
  profiles/
```

Write `.playwright/profiles.json` with the profile definitions. Format:

```json
{
  "profiles": {
    "role-name": {
      "loginUrl": "https://example.com/login",
      "description": "Role description"
    }
  }
}
```

## Step 5: Update .gitignore

Check if `.gitignore` exists at the project root.

- If it exists, check whether `.playwright/profiles/` is already listed. If not, append it.
- If `.gitignore` does not exist, create one with `.playwright/profiles/` as the first entry.

This prevents storageState files (which contain session cookies and tokens) from being committed to git.

## Step 6: Interactive Authentication Loop

For each profile, one at a time:

1. **Announce:** Tell the user which role to log in as. For example:
   > "I'm opening the browser to the login page. Please log in as the **admin** user. Tell me when you're done."

2. **Navigate:** Use `browser_navigate` to open the profile's `loginUrl` in Playwright. The browser must be running in headed mode (`--headless=false`) so the user can see and interact with it.

3. **Wait:** Ask the user to complete the login manually. This handles all auth methods — username/password, Google OAuth, 2FA, etc. Wait for the user to confirm they are logged in.

4. **Capture:** Call `browser_storage_state` with the filename set to `.playwright/profiles/<role-name>.json` (relative to the project root). This saves all cookies, localStorage, and sessionStorage for the authenticated session.

5. **Confirm:** Tell the user the profile was saved successfully.

6. **Next:** Move to the next profile, or finish if all profiles are done.

If the user wants to cancel mid-loop, save whatever profiles have been completed so far — they are still usable.

## Step 7: Update CLAUDE.md

After all profiles are saved, update the project's `CLAUDE.md`:

**If CLAUDE.md exists and already has a "## Playwright Profiles" section:** Replace that entire section with the updated version below.

**If CLAUDE.md exists but has no Playwright Profiles section:** Append the section below.

**If CLAUDE.md does not exist:** Create it with just this section.

Section content (adapt profile names and descriptions to match what was configured):

```markdown
## Playwright Profiles
Authenticated browser profiles are available at `.playwright/profiles/`.
Available profiles:
- role-name: Role description
Config: `.playwright/profiles.json`
To load a profile, call `browser_set_storage_state` with the corresponding file from `.playwright/profiles/`.
Run `/setup-profiles` to create new profiles or refresh expired sessions.
```

## Step 8: Summary

Present a summary of what was set up:
- Number of profiles created
- List of profile names and descriptions
- Reminder that profiles can be refreshed with `/setup-profiles`
- Note that storageState files are gitignored and will need to be recreated on new machines
