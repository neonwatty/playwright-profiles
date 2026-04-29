# Chrome Coexistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `sign-in.mjs login` to work while Chrome is open by defaulting to Playwright's bundled Chromium, with `--tier chrome` as an escape hatch for bot-protected sites.

**Architecture:** Add a `tier` property (`"chromium"` | `"chrome"`) to each site config. `launchBrowser` selects the binary based on tier — bundled Chromium (no singleton conflict) or real Chrome (bot-detection bypass). Tier preference is resolved from CLI flag > sites.json > default (`"chromium"`), and `--tier` writes the choice to sites.json for persistence.

**Tech Stack:** Node.js, Playwright, vitest

---

## File Structure

| File                                     | Action | Responsibility                                                     |
| ---------------------------------------- | ------ | ------------------------------------------------------------------ |
| `skills/auth-browse/scripts/sign-in.mjs` | Modify | Add `--tier` CLI flag, tier resolution, conditional browser launch |
| `tests/tier-resolution.test.mjs`         | Create | Unit tests for tier resolution and site config merging             |
| `tests/helpers.mjs`                      | Modify | Add `makeSiteConfig` helper                                        |
| `skills/auth-browse/SKILL.md`            | Modify | Document tier selection in browsing guidance                       |
| `skills/capture-auth/SKILL.md`           | Modify | Note custom apps default to chromium                               |

---

### Task 1: Add tier resolution pure function

**Files:**

- Create: `tests/tier-resolution.test.mjs`
- Modify: `tests/helpers.mjs`
- Modify: `skills/auth-browse/scripts/sign-in.mjs:627-628` (exports)

- [ ] **Step 1: Add `makeSiteConfig` helper to test helpers**

In `tests/helpers.mjs`, add after the `makeCookie` function:

```javascript
export function makeSiteConfig(overrides = {}) {
  return {
    url: "https://example.com/login",
    waitFor: "/dashboard",
    ...overrides,
  };
}
```

- [ ] **Step 2: Write failing tests for `resolveTier`**

Create `tests/tier-resolution.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { makeSiteConfig } from "./helpers.mjs";
import { resolveTier } from "../skills/auth-browse/scripts/sign-in.mjs";

describe("resolveTier (UT-13)", () => {
  it("returns 'chromium' when no tier specified anywhere", () => {
    expect(
      resolveTier({ cliTier: undefined, siteConfig: makeSiteConfig() }),
    ).toBe("chromium");
  });

  it("returns site config tier when no CLI flag", () => {
    expect(
      resolveTier({
        cliTier: undefined,
        siteConfig: makeSiteConfig({ tier: "chrome" }),
      }),
    ).toBe("chrome");
  });

  it("CLI flag overrides site config tier", () => {
    expect(
      resolveTier({
        cliTier: "chromium",
        siteConfig: makeSiteConfig({ tier: "chrome" }),
      }),
    ).toBe("chromium");
  });

  it("CLI flag overrides default when site has no tier", () => {
    expect(
      resolveTier({ cliTier: "chrome", siteConfig: makeSiteConfig() }),
    ).toBe("chrome");
  });

  it("rejects invalid tier values", () => {
    expect(() =>
      resolveTier({ cliTier: "firefox", siteConfig: makeSiteConfig() }),
    ).toThrow(/Invalid tier/);
  });

  it("ignores invalid tier in site config, falls back to default", () => {
    expect(
      resolveTier({
        cliTier: undefined,
        siteConfig: makeSiteConfig({ tier: "firefox" }),
      }),
    ).toBe("chromium");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: FAIL — `resolveTier` is not exported from sign-in.mjs

- [ ] **Step 4: Implement `resolveTier` in sign-in.mjs**

Add before the `// ── Exports (for testing)` section in `sign-in.mjs`:

```javascript
// ── Tier resolution ─────────────────────────────────────────────────

const VALID_TIERS = new Set(["chromium", "chrome"]);
const DEFAULT_TIER = "chromium";

function resolveTier({ cliTier, siteConfig }) {
  if (cliTier !== undefined) {
    if (!VALID_TIERS.has(cliTier)) {
      throw new Error(
        `Invalid tier "${cliTier}". Must be "chromium" or "chrome".`,
      );
    }
    return cliTier;
  }
  if (siteConfig.tier && VALID_TIERS.has(siteConfig.tier)) {
    return siteConfig.tier;
  }
  return DEFAULT_TIER;
}
```

Update the export line to include `resolveTier`:

```javascript
export {
  profileDir,
  authFile,
  loadSites,
  validateName,
  formatDelta,
  resolveTier,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All tests pass (53 existing + 6 new = 59)

- [ ] **Step 6: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add tests/tier-resolution.test.mjs tests/helpers.mjs skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: add resolveTier pure function with precedence logic"
```

---

### Task 2: Modify launchBrowser to accept tier

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs:209-237` (launchBrowser function)

- [ ] **Step 1: Change `launchBrowser` signature and body**

Change `launchBrowser` from:

```javascript
async function launchBrowser(profileName) {
  checkChromeRunning();
  const { chromium } = await import("playwright");
  const dir = profileDir(profileName);
  checkProfileLock(dir);
  mkdirSync(dir, { recursive: true });

  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at: ${CHROME_PATH}`);
    console.error("Install Google Chrome or edit CHROME_PATHS in this script.");
    process.exit(1);
  }

  try {
    return await chromium.launchPersistentContext(dir, {
      executablePath: CHROME_PATH,
      headless: false,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--disable-blink-features=AutomationControlled"],
    });
```

To:

```javascript
async function launchBrowser(profileName, tier = DEFAULT_TIER) {
  if (tier === "chrome") {
    checkChromeRunning();
  }
  const { chromium } = await import("playwright");
  const dir = profileDir(profileName);
  checkProfileLock(dir);
  mkdirSync(dir, { recursive: true });

  if (tier === "chrome") {
    if (!existsSync(CHROME_PATH)) {
      console.error(`Chrome not found at: ${CHROME_PATH}`);
      console.error(
        "Install Google Chrome or edit CHROME_PATHS in this script.",
      );
      process.exit(1);
    }
  }

  const launchOptions =
    tier === "chrome"
      ? {
          executablePath: CHROME_PATH,
          headless: false,
          ignoreDefaultArgs: ["--enable-automation"],
          args: ["--disable-blink-features=AutomationControlled"],
        }
      : {
          headless: false,
        };

  console.log(`  Using ${tier === "chrome" ? "real Chrome" : "Playwright Chromium"}`);

  try {
    return await chromium.launchPersistentContext(dir, launchOptions);
```

The rest of the function (catch block, error messages) stays the same.

- [ ] **Step 2: Run existing tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 59 tests pass (launchBrowser is not unit-tested — it's integration-level)

- [ ] **Step 3: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: launchBrowser selects binary based on tier"
```

---

### Task 3: Add `--tier` CLI flag parsing

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs:633-680` (CLI entrypoint)

- [ ] **Step 1: Add `--tier` extraction alongside `--profile` extraction**

In the CLI entrypoint, change the arg parsing loop from:

```javascript
// Extract --profile <name> from anywhere in the args
let cliProfile;
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--profile") {
    if (i + 1 >= rawArgs.length) {
      console.error("Error: --profile requires a name argument.");
      process.exit(1);
    }
    cliProfile = rawArgs[++i];
  } else {
    args.push(rawArgs[i]);
  }
}
```

To:

```javascript
// Extract --profile <name> and --tier <chrome|chromium> from anywhere in the args
let cliProfile;
let cliTier;
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--profile") {
    if (i + 1 >= rawArgs.length) {
      console.error("Error: --profile requires a name argument.");
      process.exit(1);
    }
    cliProfile = rawArgs[++i];
  } else if (rawArgs[i] === "--tier") {
    if (i + 1 >= rawArgs.length) {
      console.error("Error: --tier requires a value (chromium or chrome).");
      process.exit(1);
    }
    cliTier = rawArgs[++i];
  } else {
    args.push(rawArgs[i]);
  }
}
```

- [ ] **Step 2: Pass `cliTier` to `login` and `loginUrl`**

Change the login case from:

```javascript
      case "login": {
        const target = args[1];
        if (!target) {
          console.error(
            "Usage: sign-in.mjs login <site|url> [--profile <name>]",
          );
          process.exit(1);
        }
        if (target.startsWith("http")) {
          await loginUrl(target, cliProfile);
        } else {
          await login(target, cliProfile);
        }
        break;
      }
```

To:

```javascript
      case "login": {
        const target = args[1];
        if (!target) {
          console.error(
            "Usage: sign-in.mjs login <site|url> [--profile <name>] [--tier chromium|chrome]",
          );
          process.exit(1);
        }
        if (target.startsWith("http")) {
          await loginUrl(target, cliProfile, cliTier);
        } else {
          await login(target, cliProfile, cliTier);
        }
        break;
      }
```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 59 tests pass

- [ ] **Step 4: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: parse --tier CLI flag in entrypoint"
```

---

### Task 4: Wire tier through login → performLogin → launchBrowser

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs:296-309,431-466` (performLogin, login, loginUrl)

- [ ] **Step 1: Add `tier` to `performLogin` parameters and pass to `launchBrowser`**

Change `performLogin` signature and the `launchBrowser` call from:

```javascript
async function performLogin({
  url,
  outFile,
  siteName,
  waitForPattern,
  profileName,
}) {
  console.log(`\n🔐 Signing into: ${siteName} (${url})`);
  if (profileName && profileName !== "default") {
    console.log(`   Chrome profile: chrome-profile-${profileName}`);
  }
  console.log(`   Auth will be saved to: ${outFile}\n`);

  const context = await launchBrowser(profileName);
```

To:

```javascript
async function performLogin({
  url,
  outFile,
  siteName,
  waitForPattern,
  profileName,
  tier,
}) {
  console.log(`\n🔐 Signing into: ${siteName} (${url})`);
  if (profileName && profileName !== "default") {
    console.log(`   Chrome profile: chrome-profile-${profileName}`);
  }
  console.log(`   Auth will be saved to: ${outFile}\n`);

  const context = await launchBrowser(profileName, tier);
```

- [ ] **Step 2: Update `login` to resolve tier and pass it through**

Change `login` from:

```javascript
async function login(siteName, profileName) {
  const sites = loadSites();
  const site = sites[siteName];
  if (!site) {
    console.error(`Unknown site: ${siteName}`);
    console.error(`Available: ${Object.keys(sites).join(", ")}, or pass a URL`);
    process.exit(1);
  }

  await performLogin({
    url: site.url,
    outFile: authFile(siteName),
    siteName,
    waitForPattern: site.waitFor,
    profileName,
  });
}
```

To:

```javascript
async function login(siteName, profileName, cliTier) {
  const sites = loadSites();
  const site = sites[siteName];
  if (!site) {
    console.error(`Unknown site: ${siteName}`);
    console.error(`Available: ${Object.keys(sites).join(", ")}, or pass a URL`);
    process.exit(1);
  }

  const tier = resolveTier({ cliTier, siteConfig: site });

  await performLogin({
    url: site.url,
    outFile: authFile(siteName),
    siteName,
    waitForPattern: site.waitFor,
    profileName,
    tier,
  });
}
```

- [ ] **Step 3: Update `loginUrl` to resolve tier and pass it through**

Change `loginUrl` from:

```javascript
async function loginUrl(url, profileName) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Invalid URL: "${url}"`);
    process.exit(1);
  }

  const hostname = parsed.hostname.replace(/\./g, "-");
  await performLogin({
    url,
    outFile: authFile(hostname),
    siteName: hostname,
    waitForPattern: null, // No auto-detect for arbitrary URLs
    profileName,
  });
}
```

To:

```javascript
async function loginUrl(url, profileName, cliTier) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Invalid URL: "${url}"`);
    process.exit(1);
  }

  const tier = resolveTier({ cliTier, siteConfig: {} });
  const hostname = parsed.hostname.replace(/\./g, "-");
  await performLogin({
    url,
    outFile: authFile(hostname),
    siteName: hostname,
    waitForPattern: null, // No auto-detect for arbitrary URLs
    profileName,
    tier,
  });
}
```

- [ ] **Step 4: Run tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 59 tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: wire tier through login → performLogin → launchBrowser"
```

---

### Task 5: Persist `--tier` to sites.json

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs` (saveSiteTier function + login/loginUrl)
- Modify: `tests/tier-resolution.test.mjs` (add persistence tests)

- [ ] **Step 1: Write failing tests for `saveSiteTier`**

Add to `tests/tier-resolution.test.mjs`:

```javascript
import {
  resolveTier,
  saveSiteTier,
  loadSites,
} from "../skills/auth-browse/scripts/sign-in.mjs";
import { writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const SITES_FILE = join(homedir(), ".playwright-cli", "sites.json");

describe("saveSiteTier (UT-14)", () => {
  it("writes tier to sites.json for an existing custom site", () => {
    // Read current state to restore later
    const backup = existsSync(SITES_FILE)
      ? JSON.parse(readFileSync(SITES_FILE, "utf-8"))
      : null;

    try {
      // Set up a test site
      const testSites = {
        "test-tier-site": { url: "https://example.com", waitFor: "/dash" },
      };
      mkdirSync(join(homedir(), ".playwright-cli"), { recursive: true });
      writeFileSync(SITES_FILE, JSON.stringify(testSites, null, 2) + "\n");

      saveSiteTier("test-tier-site", "chrome");

      const sites = loadSites();
      expect(sites["test-tier-site"].tier).toBe("chrome");
    } finally {
      // Restore original state
      if (backup) {
        writeFileSync(SITES_FILE, JSON.stringify(backup, null, 2) + "\n");
      }
    }
  });

  it("creates entry in sites.json for a built-in site", () => {
    const backup = existsSync(SITES_FILE)
      ? JSON.parse(readFileSync(SITES_FILE, "utf-8"))
      : null;

    try {
      // Ensure sites.json exists but does not have supabase
      const testSites = backup ? { ...backup } : {};
      delete testSites["__test-builtin"];
      writeFileSync(SITES_FILE, JSON.stringify(testSites, null, 2) + "\n");

      saveSiteTier("__test-builtin", "chrome");

      const raw = JSON.parse(readFileSync(SITES_FILE, "utf-8"));
      expect(raw["__test-builtin"]).toEqual({ tier: "chrome" });
    } finally {
      // Restore and clean up
      if (backup) {
        writeFileSync(SITES_FILE, JSON.stringify(backup, null, 2) + "\n");
      }
    }
  });
});
```

Update the import at the top of the file to include `readFileSync`:

```javascript
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
```

And update the sign-in.mjs import to include `saveSiteTier` and `loadSites`:

```javascript
import {
  resolveTier,
  saveSiteTier,
  loadSites,
} from "../skills/auth-browse/scripts/sign-in.mjs";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: FAIL — `saveSiteTier` is not exported

- [ ] **Step 3: Implement `saveSiteTier`**

Add after `resolveTier` in `sign-in.mjs`:

```javascript
function saveSiteTier(name, tier) {
  let custom = {};
  if (existsSync(SITES_FILE)) {
    try {
      custom = JSON.parse(readFileSync(SITES_FILE, "utf-8"));
    } catch {
      custom = {};
    }
  }
  if (!custom[name]) {
    custom[name] = {};
  }
  custom[name].tier = tier;
  mkdirSync(BASE_DIR, { recursive: true });
  writeFileSync(SITES_FILE, JSON.stringify(custom, null, 2) + "\n");
}
```

Update exports:

```javascript
export {
  profileDir,
  authFile,
  loadSites,
  validateName,
  formatDelta,
  resolveTier,
  saveSiteTier,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All tests pass (59 + 2 = 61)

- [ ] **Step 5: Wire `saveSiteTier` into `login` when `cliTier` is provided**

In the `login` function, add after the `resolveTier` call:

```javascript
const tier = resolveTier({ cliTier, siteConfig: site });

// Persist tier preference when explicitly set via --tier
if (cliTier) {
  saveSiteTier(siteName, tier);
}
```

In the `loginUrl` function, add after the `resolveTier` call:

```javascript
const tier = resolveTier({ cliTier, siteConfig: {} });

// Persist tier preference when explicitly set via --tier
if (cliTier) {
  saveSiteTier(hostname, tier);
}
```

- [ ] **Step 6: Run tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 61 tests pass

- [ ] **Step 7: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/scripts/sign-in.mjs tests/tier-resolution.test.mjs
git commit -m "feat: persist --tier preference to sites.json"
```

---

### Task 6: Add post-login tier hint on failure

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs:569-575` (printCookieSummary status section)

- [ ] **Step 1: Add tier hint to the EXPIRED and DEGRADED status output**

In `printCookieSummary`, change the status output section from:

```javascript
if (health.status === "expired") {
  console.log(`  ❌ Status: EXPIRED — re-authenticate before use`);
} else if (health.status === "degraded") {
  console.log(`  ⚠ Status: DEGRADED — see warnings above`);
} else {
  console.log(`  ✓ Status: HEALTHY`);
}
```

To:

```javascript
if (health.status === "expired") {
  console.log(`  ❌ Status: EXPIRED — re-authenticate before use`);
  console.log(
    `  Tip: if sign-in was blocked by bot detection, retry with: node sign-in.mjs login ${siteName} --tier chrome`,
  );
} else if (health.status === "degraded") {
  console.log(`  ⚠ Status: DEGRADED — see warnings above`);
} else {
  console.log(`  ✓ Status: HEALTHY`);
}
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 61 tests pass

- [ ] **Step 3: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: add --tier chrome hint on expired/failed login"
```

---

### Task 7: Update help text

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs:578-624` (printHelp function)

- [ ] **Step 1: Update help text to document `--tier`**

In `printHelp`, change the relevant sections:

Change:

```javascript
Commands:
  login <site> [--profile <name>]   Sign in and save auth state
  login <url>  [--profile <name>]   Sign into an arbitrary URL
```

To:

```javascript
Commands:
  login <site> [--profile <name>] [--tier chromium|chrome]   Sign in and save auth state
  login <url>  [--profile <name>] [--tier chromium|chrome]   Sign into an arbitrary URL
```

After the `--profile` option block, add:

```javascript
  --tier <value>      Browser to use for sign-in:
                      "chromium" (default) — Playwright's bundled Chromium.
                        Works while your Chrome is open. Best for most sites.
                      "chrome" — real Google Chrome with bot-detection bypass.
                        Required for Cloudflare, Google OAuth, AWS. Chrome must
                        be closed first. Preference is saved per-site.
```

Add an example:

```javascript
  # Bot-protected site (saves preference for future logins)
  node sign-in.mjs login cloudflare --tier chrome
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 61 tests pass

- [ ] **Step 3: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "docs: add --tier flag to help text"
```

---

### Task 8: Update skill docs

**Files:**

- Modify: `skills/auth-browse/SKILL.md`
- Modify: `skills/capture-auth/SKILL.md`

- [ ] **Step 1: Update auth-browse SKILL.md tier guidance**

In `skills/auth-browse/SKILL.md`, find the "### Tier Selection (RT-11)" section. Replace the hardcoded domain list approach with the new tier model:

```markdown
### Tier Selection (RT-11)

The `login` command defaults to Playwright's bundled Chromium (`--tier chromium`), which works while the user's Chrome is open. If the login is blocked by bot detection (Cloudflare Turnstile, Google OAuth "This browser is not secure"), the user should retry with `--tier chrome`:
```

node ~/.playwright-cli/sign-in.mjs login <site> --tier chrome

```

The `--tier chrome` preference is saved per-site in `sites.json` — future logins for that site automatically use real Chrome. The user must close their personal Chrome before running `--tier chrome`.

Do not assume which sites need `--tier chrome`. Let the user discover it on first login. The script prints a hint when login appears to fail.
```

- [ ] **Step 2: Update capture-auth SKILL.md**

In `skills/capture-auth/SKILL.md`, find "### Step 3: Sign in" and add a note after the `node ~/.playwright-cli/sign-in.mjs login <name>` command block:

```markdown
The script defaults to Playwright's built-in Chromium, which works while Chrome is open. Custom apps rarely have bot detection, so this is almost always fine. If the user's app uses Google OAuth for login and it gets blocked, retry with `--tier chrome` (Chrome must be closed first):
```

node ~/.playwright-cli/sign-in.mjs login <name> --tier chrome

```

```

- [ ] **Step 3: Run tests to verify nothing breaks**

Run: `cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles && npm test`
Expected: All 61 tests pass

- [ ] **Step 4: Commit**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add skills/auth-browse/SKILL.md skills/capture-auth/SKILL.md
git commit -m "docs: update skill docs with tier selection guidance"
```

---

### Task 9: Update deployed scripts

**Files:**

- Modify: `commands/setup-auth-browse.md`

- [ ] **Step 1: Add note about re-copying scripts after updates**

No changes needed to setup-auth-browse.md — it already copies both `sign-in.mjs` and `cookie-analysis.mjs`. But after implementation is complete, the updated `sign-in.mjs` must be re-deployed:

```bash
cp /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles/skills/auth-browse/scripts/sign-in.mjs ~/.playwright-cli/sign-in.mjs
```

- [ ] **Step 2: Verify the deployed script works**

Run: `node ~/.playwright-cli/sign-in.mjs help`
Expected: Output includes `--tier` flag documentation

Run: `node ~/.playwright-cli/sign-in.mjs check`
Expected: Same output as before (check command is unchanged)

- [ ] **Step 3: Commit (if any changes were needed)**

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
git add commands/setup-auth-browse.md
git commit -m "chore: re-deploy updated sign-in.mjs to ~/.playwright-cli"
```

---

## Self-Review

**Spec coverage:**

- ✅ Tier model (chromium/chrome) — Task 1
- ✅ Tier resolution precedence (CLI > sites.json > default) — Task 1
- ✅ Browser launch binary selection — Task 2
- ✅ `--tier` CLI flag — Task 3
- ✅ Wiring through login → performLogin → launchBrowser — Task 4
- ✅ Persistence to sites.json — Task 5
- ✅ User guidance on failure — Task 6
- ✅ Help text — Task 7
- ✅ Skill doc updates — Task 8
- ✅ Deployment — Task 9
- ✅ `checkChromeRunning` only for chrome tier — Task 2
- ✅ All sites default to chromium — Task 1 (DEFAULT_TIER = "chromium")
- ✅ Profile directories shared between tiers — no change needed (already works)

**Placeholder scan:** No TBD, TODO, or vague steps. All code blocks are complete.

**Type consistency:** `resolveTier({ cliTier, siteConfig })` signature is consistent across Task 1 (tests), Task 4 (login/loginUrl callers). `saveSiteTier(name, tier)` signature is consistent across Task 5 (tests and callers). `launchBrowser(profileName, tier)` is consistent between Task 2 (definition) and Task 4 (caller).
