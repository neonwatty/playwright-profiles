# playwright-profiles

Manage Playwright `storageState` authentication profiles for multi-role browser testing with Claude Code.

## What it does

- **`/setup-profiles`** — Interactive command to create authenticated browser profiles for each user role in your project. Opens a headed Playwright browser, lets you log in manually, then saves the session state.
- **`use-profiles` skill** — Automatically discovers and loads saved auth profiles when Claude does browser work, so you don't have to log in every session.

## Prerequisites

- Claude Code
- `@playwright/mcp` (installed automatically via npx)

This plugin bundles its own Playwright MCP server config. If you also have the official `playwright@claude-plugins-official` plugin installed, disable it to avoid running two MCP server instances. The Playwright MCP server runs in headed mode by default, which is required for interactive login.

## Usage

### First-time setup

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

### Using profiles

Once set up, just mention a role when asking Claude to do browser work:

- "Test the admin dashboard"
- "Check the speaker view"
- "Browse the site as a planner"

Claude automatically loads the right profile before navigating.

### Refreshing expired sessions

Sessions expire over time. Run `/setup-profiles` again to refresh specific profiles.

## Per-project files

| File | Committed? | Purpose |
|------|-----------|---------|
| `.playwright/profiles.json` | Yes | Role names, login URLs, descriptions |
| `.playwright/profiles/*.json` | No (gitignored) | storageState auth data |

## Security

- No credentials are stored anywhere
- storageState files (containing session cookies) are gitignored
- Only role names, login URLs, and descriptions are committed
