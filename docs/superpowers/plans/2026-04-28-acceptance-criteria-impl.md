# Acceptance Criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the playwright-profiles plugin pass all 31 acceptance criteria defined in `docs/superpowers/specs/2026-04-28-acceptance-criteria-design.md` — runtime assertions (RT-01 through RT-14), unit tests (UT-01 through UT-11), and manual verification checklist (MN-01 through MN-06).

**Architecture:** Extract pure functions from the monolithic `sign-in.mjs` into a testable module. Add vitest for unit testing. Wire pre-flight checks and JWT-aware cookie analysis into the script. Update skill markdown files with runtime assertion instructions for Claude.

**Tech Stack:** Node.js ESM, vitest, Playwright (dynamic import for browser-dependent code only)

**Spec:** `docs/superpowers/specs/2026-04-28-acceptance-criteria-design.md`

---

## File Map

**New files:**

| File                                             | Responsibility                                                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `skills/auth-browse/scripts/cookie-analysis.mjs` | Pure functions: JWT decoding, Supabase cookie parsing, cookie classification, domain filtering, auth cookie detection |
| `tests/cookie-analysis.test.mjs`                 | Unit tests for cookie-analysis.mjs (UT-01 through UT-05, UT-10, UT-11)                                                |
| `tests/path-and-config.test.mjs`                 | Unit tests for profileDir, authFile, loadSites (UT-06 through UT-09)                                                  |
| `tests/helpers.mjs`                              | Test fixture builders: makeJwt, makeSupabaseCookieValue, makeCookie                                                   |
| `vitest.config.mjs`                              | Vitest configuration                                                                                                  |
| `docs/manual-verification.md`                    | Layer A manual checklist (MN-01 through MN-06)                                                                        |

**Modified files:**

| File                                     | Changes                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/auth-browse/scripts/sign-in.mjs` | Import from cookie-analysis.mjs, dynamic playwright import, add pre-flight checks (RT-01, RT-06), replace printCookieSummary with JWT-aware version (RT-02 through RT-05), add domain filtering on capture (RT-14), export pure functions for testing, guard CLI execution |
| `skills/use-profiles/SKILL.md`           | Add pre-load health check (RT-08), cross-contamination warning (RT-10)                                                                                                                                                                                                     |
| `skills/auth-browse/SKILL.md`            | Add tier validation (RT-11), pre-browse freshness check (RT-12)                                                                                                                                                                                                            |
| `skills/capture-auth/SKILL.md`           | Add post-capture validation (RT-13)                                                                                                                                                                                                                                        |
| `commands/setup-auth-browse.md`          | Copy cookie-analysis.mjs alongside sign-in.mjs                                                                                                                                                                                                                             |
| `package.json`                           | Add vitest devDependency, add test script                                                                                                                                                                                                                                  |
| `.github/workflows/validate.yml`         | Add unit test job                                                                                                                                                                                                                                                          |

---

### Task 1: Test Infrastructure

**Files:**

- Create: `vitest.config.mjs`
- Create: `tests/helpers.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add vitest**

Run:

```bash
cd /Users/neonwatty/.claude/plugins/marketplaces/neonwatty-playwright-profiles
npm install --save-dev vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.mjs`:

```javascript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

Add to the `"scripts"` section:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create test fixture helpers**

Create `tests/helpers.mjs`:

```javascript
import { Buffer } from "buffer";

/** Build a JWT with a known payload. Signature is fake — only the payload matters for testing. */
export function makeJwt(payload) {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fake-signature`;
}

/** Build a Supabase-style `base64-<session JSON>` cookie value. */
export function makeSupabaseCookieValue(expiresAt, email = "test@example.com") {
  const jwt = makeJwt({
    sub: "user-123",
    email,
    role: "authenticated",
    exp: expiresAt,
    iat: expiresAt - 3600,
  });
  const session = JSON.stringify({
    access_token: jwt,
    refresh_token: "fake-refresh-token-xyz",
    expires_at: expiresAt,
    token_type: "bearer",
  });
  return "base64-" + Buffer.from(session).toString("base64");
}

/** Build a cookie object with sensible defaults. Override any field via `overrides`. */
export function makeCookie(overrides = {}) {
  return {
    name: "test-cookie",
    value: "test-value",
    domain: "localhost",
    path: "/",
    expires: Date.now() / 1000 + 86400,
    httpOnly: false,
    secure: false,
    sameSite: "Lax",
    ...overrides,
  };
}
```

- [ ] **Step 5: Verify vitest runs**

Run:

```bash
npm test
```

Expected: "No test files found" or similar — no failures. Confirms vitest is wired up.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.mjs tests/helpers.mjs package.json package-lock.json
git commit -m "chore: add vitest test infrastructure and fixture helpers"
```

---

### Task 2: Cookie Analysis Module (TDD — UT-01 through UT-05)

**Files:**

- Create: `skills/auth-browse/scripts/cookie-analysis.mjs`
- Create: `tests/cookie-analysis.test.mjs`

- [ ] **Step 1: Write failing tests for decodeSupabaseCookie (UT-01)**

Create `tests/cookie-analysis.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import { makeSupabaseCookieValue, makeJwt, makeCookie } from "./helpers.mjs";
import {
  decodeSupabaseCookie,
  decodeJwtExp,
  isAuthCookie,
  classifyCookies,
  EPHEMERAL,
} from "../skills/auth-browse/scripts/cookie-analysis.mjs";

describe("decodeSupabaseCookie (UT-01)", () => {
  it("decodes a valid base64- prefixed Supabase cookie", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const value = makeSupabaseCookieValue(futureExp);
    const session = decodeSupabaseCookie(value);
    expect(session).not.toBeNull();
    expect(session.access_token).toBeDefined();
    expect(session.refresh_token).toBe("fake-refresh-token-xyz");
    expect(session.expires_at).toBe(futureExp);
  });

  it("returns null for non-base64- values", () => {
    expect(decodeSupabaseCookie("some-random-value")).toBeNull();
    expect(decodeSupabaseCookie("")).toBeNull();
    expect(decodeSupabaseCookie("base64")).toBeNull();
  });

  it("returns null for corrupted base64 payload", () => {
    expect(decodeSupabaseCookie("base64-!!!notbase64!!!")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test
```

Expected: FAIL — `cookie-analysis.mjs` does not exist.

- [ ] **Step 3: Implement decodeSupabaseCookie**

Create `skills/auth-browse/scripts/cookie-analysis.mjs`:

```javascript
import { Buffer } from "buffer";

/**
 * Decode a Supabase `base64-<session JSON>` cookie value.
 * Returns the parsed session object ({ access_token, refresh_token, expires_at })
 * or null if the value is not a Supabase cookie.
 */
export function decodeSupabaseCookie(value) {
  if (typeof value !== "string" || !value.startsWith("base64-")) return null;
  try {
    const json = Buffer.from(value.slice(7), "base64").toString("utf-8");
    const session = JSON.parse(json);
    if (typeof session.expires_at !== "number") return null;
    return session;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify decodeSupabaseCookie passes**

Run:

```bash
npm test
```

Expected: All decodeSupabaseCookie tests PASS.

- [ ] **Step 5: Add failing tests for decodeJwtExp (UT-02)**

Append to `tests/cookie-analysis.test.mjs`:

```javascript
describe("decodeJwtExp (UT-02)", () => {
  it("extracts exp from a valid JWT", () => {
    const exp = 1713470579;
    const jwt = makeJwt({ sub: "user", exp, iat: exp - 3600 });
    expect(decodeJwtExp(jwt)).toBe(exp);
  });

  it("returns null for non-JWT strings", () => {
    expect(decodeJwtExp("not-a-jwt")).toBeNull();
    expect(decodeJwtExp("")).toBeNull();
    expect(decodeJwtExp("a.b")).toBeNull();
    expect(decodeJwtExp("a.b.c.d")).toBeNull();
  });

  it("returns null for JWT without exp claim", () => {
    const jwt = makeJwt({ sub: "user", iat: 1713470000 });
    expect(decodeJwtExp(jwt)).toBeNull();
  });

  it("returns null for corrupted base64url segments", () => {
    expect(decodeJwtExp("!!!.@@@.###")).toBeNull();
  });
});
```

- [ ] **Step 6: Implement decodeJwtExp**

Add to `cookie-analysis.mjs`:

```javascript
/**
 * Decode a JWT and return the `exp` claim (Unix timestamp).
 * Returns null if the value is not a JWT or has no exp claim.
 */
export function decodeJwtExp(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  if (!parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 7: Run tests — decodeJwtExp passes**

Run: `npm test` — Expected: PASS.

- [ ] **Step 8: Add failing tests for isAuthCookie (UT-04)**

Append to `tests/cookie-analysis.test.mjs`:

```javascript
describe("isAuthCookie (UT-04)", () => {
  it("matches auth-relevant cookie names", () => {
    const positives = [
      "sb-xxx-auth-token",
      "user_session",
      "__cf_logged_in",
      "JSESSIONID",
      "jwt-access",
      "auth_token",
      "session_id",
      "identity-v2",
      "logged_in",
    ];
    for (const name of positives) {
      expect(isAuthCookie(name), `expected "${name}" to match`).toBe(true);
    }
  });

  it("does not match analytics/tracking cookies", () => {
    const negatives = [
      "_ga",
      "ph_phc_xxx_posthog",
      "__cf_bm",
      "_fbp",
      "_gid",
      "mp_mixpanel",
      "intercom-id",
      "hubspotutk",
    ];
    for (const name of negatives) {
      expect(isAuthCookie(name), `expected "${name}" not to match`).toBe(false);
    }
  });
});
```

- [ ] **Step 9: Implement isAuthCookie**

Add to `cookie-analysis.mjs`:

```javascript
/** Auth-relevant cookie name pattern. */
const AUTH_PATTERN = /auth|session|token|sid|jwt|identity|logged/i;

/** Returns true if the cookie name matches auth-relevant patterns. */
export function isAuthCookie(name) {
  return AUTH_PATTERN.test(name);
}
```

- [ ] **Step 10: Run tests — isAuthCookie passes**

Run: `npm test` — Expected: PASS.

- [ ] **Step 11: Add failing tests for classifyCookies (UT-03)**

Append to `tests/cookie-analysis.test.mjs`:

```javascript
describe("classifyCookies (UT-03)", () => {
  it("classifies valid cookies", () => {
    const cookies = [makeCookie({ expires: Date.now() / 1000 + 86400 })];
    const result = classifyCookies(cookies);
    expect(result.valid).toBe(1);
    expect(result.total).toBe(1);
  });

  it("classifies browser-expired cookies", () => {
    const cookies = [makeCookie({ expires: 1577836800 })]; // 2020-01-01
    const result = classifyCookies(cookies);
    expect(result.expired).toBe(1);
  });

  it("classifies session-only cookies", () => {
    const cookies = [makeCookie({ expires: -1 })];
    const result = classifyCookies(cookies);
    expect(result.session_only).toBe(1);
  });

  it("classifies ephemeral cookies", () => {
    const cookies = [makeCookie({ name: "__cf_bm", expires: 1577836800 })];
    const result = classifyCookies(cookies);
    expect(result.ephemeral).toBe(1);
    expect(result.expired).toBe(0);
  });

  it("classifies cookies with expired JWT value", () => {
    const expiredJwt = makeJwt({ sub: "u", exp: 1577836800, iat: 1577750400 });
    const cookies = [
      makeCookie({
        name: "my-jwt",
        value: expiredJwt,
        expires: Date.now() / 1000 + 86400,
      }),
    ];
    const result = classifyCookies(cookies);
    expect(result.jwt_expired).toBe(1);
    expect(result.valid).toBe(0);
  });

  it("classifies cookies with expired Supabase session", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 7200;
    const cookies = [
      makeCookie({
        name: "sb-test-auth-token",
        value: makeSupabaseCookieValue(pastExp),
        expires: Date.now() / 1000 + 86400,
      }),
    ];
    const result = classifyCookies(cookies);
    expect(result.supabase_expired).toBe(1);
    expect(result.valid).toBe(0);
  });

  it("sum of categories equals total", () => {
    const now = Date.now() / 1000;
    const cookies = [
      makeCookie({ expires: now + 86400 }),
      makeCookie({ expires: 1577836800 }),
      makeCookie({ expires: -1 }),
      makeCookie({ name: "__cf_bm" }),
      makeCookie({
        value: makeJwt({ sub: "u", exp: 1577836800, iat: 1577750400 }),
        expires: now + 86400,
      }),
      makeCookie({
        name: "sb-test-auth-token",
        value: makeSupabaseCookieValue(Math.floor(now) - 3600),
        expires: now + 86400,
      }),
    ];
    const result = classifyCookies(cookies);
    const sum =
      result.valid +
      result.expired +
      result.session_only +
      result.ephemeral +
      result.jwt_expired +
      result.supabase_expired;
    expect(sum).toBe(result.total);
    expect(result.total).toBe(6);
  });
});
```

- [ ] **Step 12: Implement classifyCookies**

Add to `cookie-analysis.mjs`:

```javascript
/** Cookie names that rotate too frequently to be meaningful for expiry checks. */
export const EPHEMERAL = new Set([
  "__cf_bm",
  "__stripe_sid",
  "__stripe_mid",
  "_cfuvid",
  "cf_clearance",
  "__cflb",
]);

/**
 * Classify cookies into categories.
 * Returns { valid, expired, session_only, jwt_expired, supabase_expired, ephemeral, total }.
 */
export function classifyCookies(cookies) {
  const now = Date.now() / 1000;
  const result = {
    valid: 0,
    expired: 0,
    session_only: 0,
    jwt_expired: 0,
    supabase_expired: 0,
    ephemeral: 0,
    total: cookies.length,
  };

  for (const c of cookies) {
    if (EPHEMERAL.has(c.name)) {
      result.ephemeral++;
      continue;
    }
    if (c.expires <= 0) {
      result.session_only++;
      continue;
    }
    if (c.expires < now) {
      result.expired++;
      continue;
    }

    const supabase = decodeSupabaseCookie(c.value);
    if (supabase) {
      if (supabase.expires_at < now) {
        result.supabase_expired++;
        continue;
      }
      if (supabase.access_token) {
        const tokenExp = decodeJwtExp(supabase.access_token);
        if (tokenExp !== null && tokenExp < now) {
          result.supabase_expired++;
          continue;
        }
      }
      result.valid++;
      continue;
    }

    const jwtExp = decodeJwtExp(c.value);
    if (jwtExp !== null && jwtExp < now) {
      result.jwt_expired++;
      continue;
    }

    result.valid++;
  }

  return result;
}
```

- [ ] **Step 13: Run tests — classifyCookies passes**

Run: `npm test` — Expected: PASS.

- [ ] **Step 14: Add ephemeral filtering test (UT-05)**

Append to `tests/cookie-analysis.test.mjs`:

```javascript
describe("EPHEMERAL set (UT-05)", () => {
  it("contains known ephemeral cookie names", () => {
    expect(EPHEMERAL.has("__cf_bm")).toBe(true);
    expect(EPHEMERAL.has("__stripe_sid")).toBe(true);
    expect(EPHEMERAL.has("cf_clearance")).toBe(true);
  });

  it("does not contain auth cookies", () => {
    expect(EPHEMERAL.has("sb-xxx-auth-token")).toBe(false);
    expect(EPHEMERAL.has("session")).toBe(false);
  });

  it("classifyCookies skips ephemeral when classifying", () => {
    const cookies = [
      makeCookie({ name: "__cf_bm", expires: 1577836800 }),
      makeCookie({ name: "auth", expires: Date.now() / 1000 + 86400 }),
    ];
    const result = classifyCookies(cookies);
    expect(result.ephemeral).toBe(1);
    expect(result.valid).toBe(1);
    expect(result.expired).toBe(0);
  });
});
```

- [ ] **Step 15: Run tests — UT-05 passes (already implemented)**

Run: `npm test` — Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add skills/auth-browse/scripts/cookie-analysis.mjs tests/cookie-analysis.test.mjs
git commit -m "feat: cookie analysis module with JWT and Supabase decoding (UT-01 through UT-05)"
```

---

### Task 3: Domain Filtering (TDD — UT-11)

**Files:**

- Modify: `skills/auth-browse/scripts/cookie-analysis.mjs`
- Modify: `tests/cookie-analysis.test.mjs`

- [ ] **Step 1: Write failing tests for filterCookiesByDomain**

Append to `tests/cookie-analysis.test.mjs` (add `filterCookiesByDomain` to the import):

```javascript
describe("filterCookiesByDomain (UT-11)", () => {
  it("keeps only localhost cookies for localhost target", () => {
    const cookies = [
      makeCookie({ domain: "localhost" }),
      makeCookie({ domain: ".github.com" }),
      makeCookie({ domain: ".google.com" }),
      makeCookie({ domain: ".stripe.com" }),
    ];
    const filtered = filterCookiesByDomain(cookies, "http://localhost:3000");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].domain).toBe("localhost");
  });

  it("keeps parent domain cookies for subdomain targets", () => {
    const cookies = [
      makeCookie({ domain: ".cloudflare.com" }),
      makeCookie({ domain: "dash.cloudflare.com" }),
      makeCookie({ domain: ".github.com" }),
    ];
    const filtered = filterCookiesByDomain(
      cookies,
      "https://dash.cloudflare.com",
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.every((c) => c.domain.includes("cloudflare"))).toBe(true);
  });

  it("keeps OAuth provider cookies for non-localhost targets", () => {
    const cookies = [
      makeCookie({ domain: ".cloudflare.com" }),
      makeCookie({ domain: "accounts.google.com" }),
      makeCookie({ domain: ".stripe.com" }),
    ];
    const filtered = filterCookiesByDomain(
      cookies,
      "https://dash.cloudflare.com",
    );
    expect(filtered).toHaveLength(2);
    expect(filtered.some((c) => c.domain === "accounts.google.com")).toBe(true);
  });

  it("does not keep OAuth cookies for localhost targets", () => {
    const cookies = [
      makeCookie({ domain: "localhost" }),
      makeCookie({ domain: "accounts.google.com" }),
    ];
    const filtered = filterCookiesByDomain(cookies, "http://localhost:3000");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].domain).toBe("localhost");
  });

  it("returns all cookies for invalid URLs", () => {
    const cookies = [makeCookie(), makeCookie()];
    const filtered = filterCookiesByDomain(cookies, "not-a-url");
    expect(filtered).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests — fail**

Run: `npm test` — Expected: FAIL — `filterCookiesByDomain` not exported.

- [ ] **Step 3: Implement filterCookiesByDomain**

Add to `cookie-analysis.mjs`:

```javascript
/** OAuth provider domains to always keep for non-localhost targets. */
const OAUTH_DOMAINS = ["accounts.google.com", "google.com"];

/**
 * Filter cookies to only those relevant to the target URL.
 * Keeps cookies matching the target's domain (including parent domains)
 * and common OAuth providers (for non-localhost targets).
 */
export function filterCookiesByDomain(cookies, targetUrl) {
  let targetHost;
  try {
    targetHost = new URL(targetUrl).hostname;
  } catch {
    return cookies;
  }

  const isLocalhost = targetHost === "localhost" || targetHost === "127.0.0.1";

  return cookies.filter((c) => {
    const cd = c.domain.replace(/^\./, "");
    if (targetHost === cd || targetHost.endsWith("." + cd)) return true;
    if (
      !isLocalhost &&
      OAUTH_DOMAINS.some((d) => cd === d || cd.endsWith("." + d))
    )
      return true;
    return false;
  });
}
```

- [ ] **Step 4: Run tests — pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/auth-browse/scripts/cookie-analysis.mjs tests/cookie-analysis.test.mjs
git commit -m "feat: domain filtering for cookie capture (UT-11)"
```

---

### Task 4: Path Construction and Site Config Tests (TDD — UT-06 through UT-09)

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs`
- Create: `tests/path-and-config.test.mjs`

- [ ] **Step 1: Make sign-in.mjs importable**

Three changes to `sign-in.mjs`:

**1a.** Remove the static playwright import at line 27:

```javascript
import { chromium } from "playwright";
```

**1b.** Add dynamic import inside `launchBrowser` as the first line of the function body:

```javascript
async function launchBrowser(profileName) {
  const { chromium } = await import('playwright');
  const dir = profileDir(profileName);
```

**1c.** Change `validateName` from `process.exit(1)` to throwing an Error:

```javascript
function validateName(value, label) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      `Invalid ${label} "${value}". Use only letters, numbers, hyphens, and underscores.`,
    );
  }
}
```

**1d.** Add exports and guard CLI execution. At the bottom, replace the raw CLI block (starting at `const rawArgs = process.argv.slice(2);`) by wrapping it. Add `fileURLToPath` to the top imports:

```javascript
import { fileURLToPath } from "url";
```

Then wrap the CLI block:

```javascript
// ── Exports (for testing) ──────────────────────────────────────────
export { profileDir, authFile, loadSites, validateName, formatDuration };

// ── CLI entrypoint ─────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const rawArgs = process.argv.slice(2);
  // ... rest of existing CLI parsing unchanged ...
}
```

- [ ] **Step 2: Write tests for profileDir (UT-06)**

Create `tests/path-and-config.test.mjs`:

```javascript
import { describe, it, expect } from "vitest";
import {
  profileDir,
  authFile,
  loadSites,
  validateName,
} from "../skills/auth-browse/scripts/sign-in.mjs";
import { join } from "path";
import { homedir } from "os";

const BASE = join(homedir(), ".playwright-cli");

describe("profileDir (UT-06)", () => {
  it("returns default profile for undefined", () => {
    expect(profileDir(undefined)).toBe(join(BASE, "chrome-profile"));
  });

  it('returns default profile for "default"', () => {
    expect(profileDir("default")).toBe(join(BASE, "chrome-profile"));
  });

  it("returns named profile directory", () => {
    expect(profileDir("seatify-admin")).toBe(
      join(BASE, "chrome-profile-seatify-admin"),
    );
  });

  it("rejects path traversal attempts", () => {
    expect(() => profileDir("../../etc/passwd")).toThrow(/Invalid/);
  });
});
```

- [ ] **Step 3: Run tests — profileDir passes**

Run: `npm test` — Expected: PASS.

- [ ] **Step 4: Write tests for authFile (UT-07)**

Append to `tests/path-and-config.test.mjs`:

```javascript
describe("authFile (UT-07)", () => {
  it("returns correct path for site name", () => {
    expect(authFile("cloudflare")).toBe(join(BASE, "auth-cloudflare.json"));
  });

  it("sanitizes special characters", () => {
    const path = authFile("my.weird site");
    expect(path).not.toContain(" ");
    expect(path).toContain("auth-my-weird-site.json");
  });
});
```

- [ ] **Step 5: Run tests — authFile passes**

Run: `npm test` — Expected: PASS.

- [ ] **Step 6: Write tests for loadSites (UT-08, UT-09)**

Append to `tests/path-and-config.test.mjs`:

```javascript
describe("loadSites (UT-08, UT-09)", () => {
  it("returns all 10 default sites", () => {
    const sites = loadSites();
    expect(Object.keys(sites).length).toBeGreaterThanOrEqual(10);
    expect(sites.github).toBeDefined();
    expect(sites.cloudflare).toBeDefined();
    expect(sites.vercel).toBeDefined();
  });

  it("each default site has url and waitFor", () => {
    const sites = loadSites();
    for (const [name, config] of Object.entries(sites)) {
      expect(config.url, `${name} missing url`).toBeDefined();
      expect(config.waitFor, `${name} missing waitFor`).toBeDefined();
    }
  });
});
```

- [ ] **Step 7: Run tests — pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add skills/auth-browse/scripts/sign-in.mjs tests/path-and-config.test.mjs
git commit -m "refactor: export pure functions from sign-in.mjs, add path/config tests (UT-06 through UT-09)"
```

---

### Task 5: Check Output Accuracy Tests (UT-10)

**Files:**

- Modify: `skills/auth-browse/scripts/cookie-analysis.mjs`
- Modify: `tests/cookie-analysis.test.mjs`

- [ ] **Step 1: Write failing tests for analyzeCookieHealth**

Append to `tests/cookie-analysis.test.mjs` (add `analyzeCookieHealth` to the import):

```javascript
describe("analyzeCookieHealth (UT-10)", () => {
  it("reports healthy for all-valid cookies", () => {
    const cookies = [
      makeCookie({ name: "auth-token", expires: Date.now() / 1000 + 86400 }),
      makeCookie({ name: "_ga", expires: Date.now() / 1000 + 86400 }),
    ];
    const health = analyzeCookieHealth(cookies);
    expect(health.status).toBe("healthy");
    expect(health.classification.valid).toBe(2);
  });

  it("reports expired for all-expired auth cookies", () => {
    const cookies = [makeCookie({ name: "auth-token", expires: 1577836800 })];
    const health = analyzeCookieHealth(cookies);
    expect(health.status).toBe("expired");
    expect(health.soonestAuthExpiry.remaining).toBeLessThan(0);
  });

  it("reports expired when JWT inside cookie is expired (not cookie shell)", () => {
    const expiredJwt = makeJwt({ sub: "u", exp: 1577836800, iat: 1577750400 });
    const cookies = [
      makeCookie({
        name: "jwt-session",
        value: expiredJwt,
        expires: Date.now() / 1000 + 86400,
      }),
    ];
    const health = analyzeCookieHealth(cookies);
    expect(health.status).toBe("expired");
    expect(health.jwtIssues.length).toBeGreaterThan(0);
  });

  it("reports expired when Supabase session.expires_at is past", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const cookies = [
      makeCookie({
        name: "sb-test-auth-token",
        value: makeSupabaseCookieValue(pastExp),
        expires: Date.now() / 1000 + 86400,
      }),
    ];
    const health = analyzeCookieHealth(cookies);
    expect(health.status).toBe("expired");
    expect(health.jwtIssues.length).toBeGreaterThan(0);
    expect(health.jwtIssues[0]).toMatch(/supabase/i);
  });

  it("warns when >30% session-only cookies", () => {
    const cookies = [
      makeCookie({ expires: -1 }),
      makeCookie({ expires: -1 }),
      makeCookie({ expires: -1 }),
      makeCookie({ expires: Date.now() / 1000 + 86400 }),
    ];
    const health = analyzeCookieHealth(cookies);
    expect(health.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/session-only.*state-load/i),
      ]),
    );
  });

  it("warns when zero auth cookies found", () => {
    const cookies = [makeCookie({ name: "_ga" }), makeCookie({ name: "_fbp" })];
    const health = analyzeCookieHealth(cookies);
    expect(health.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/no auth/i)]),
    );
  });
});
```

- [ ] **Step 2: Run tests — fail**

Run: `npm test` — Expected: FAIL — `analyzeCookieHealth` not exported.

- [ ] **Step 3: Implement analyzeCookieHealth**

Add to `cookie-analysis.mjs`:

```javascript
/**
 * Analyze the health of cookies in a storageState file.
 * Returns { status, classification, soonestAuthExpiry, jwtIssues, warnings }.
 *
 * status: 'healthy' | 'expired' | 'degraded' | 'empty'
 */
export function analyzeCookieHealth(cookies) {
  if (!cookies || cookies.length === 0) {
    return {
      status: "empty",
      classification: classifyCookies([]),
      soonestAuthExpiry: null,
      jwtIssues: [],
      warnings: ["No cookies saved"],
    };
  }

  const classification = classifyCookies(cookies);
  const now = Date.now() / 1000;
  const jwtIssues = [];
  const warnings = [];

  const authCookies = cookies.filter(
    (c) => isAuthCookie(c.name) && !EPHEMERAL.has(c.name),
  );

  if (authCookies.length === 0) {
    warnings.push("No auth-relevant cookies found — session may not restore");
  }

  for (const c of authCookies) {
    const supabase = decodeSupabaseCookie(c.value);
    if (supabase) {
      if (supabase.expires_at < now) {
        jwtIssues.push(
          `Supabase session "${c.name}" expired ${formatDelta(now - supabase.expires_at)} ago (cookie shell says ${formatDelta(c.expires - now)} remaining)`,
        );
      }
      continue;
    }
    const jwtExp = decodeJwtExp(c.value);
    if (jwtExp !== null && jwtExp < now) {
      jwtIssues.push(
        `JWT "${c.name}" expired ${formatDelta(now - jwtExp)} ago (cookie shell says ${formatDelta(c.expires - now)} remaining)`,
      );
    }
  }

  if (classification.session_only > 0) {
    const pct = Math.round(
      (classification.session_only / classification.total) * 100,
    );
    if (pct > 30) {
      warnings.push(
        `${classification.session_only} session-only cookies (${pct}%) will not survive state-load — use persistent profile instead`,
      );
    }
  }

  let soonestAuthExpiry = null;
  for (const c of authCookies) {
    let realExp = c.expires > 0 ? c.expires : null;
    const supabase = decodeSupabaseCookie(c.value);
    if (supabase) {
      realExp = supabase.expires_at;
    } else {
      const jwtExp = decodeJwtExp(c.value);
      if (jwtExp !== null) {
        realExp = jwtExp;
      }
    }
    if (
      realExp !== null &&
      (soonestAuthExpiry === null || realExp < soonestAuthExpiry.expires)
    ) {
      soonestAuthExpiry = {
        name: c.name,
        expires: realExp,
        remaining: realExp - now,
      };
    }
  }

  let status;
  if (
    jwtIssues.length > 0 ||
    (soonestAuthExpiry && soonestAuthExpiry.remaining < 0)
  ) {
    status = "expired";
  } else if (warnings.length > 0) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return { status, classification, soonestAuthExpiry, jwtIssues, warnings };
}

function formatDelta(seconds) {
  const abs = Math.abs(seconds);
  if (abs < 60) return `${Math.round(abs)}s`;
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h`;
  return `${Math.round(abs / 86400)}d`;
}
```

- [ ] **Step 4: Run tests — pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/auth-browse/scripts/cookie-analysis.mjs tests/cookie-analysis.test.mjs
git commit -m "feat: analyzeCookieHealth with JWT-aware expiry reporting (UT-10)"
```

---

### Task 6: Pre-flight Safety Checks in sign-in.mjs (RT-01, RT-06)

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs`

- [ ] **Step 1: Add Chrome conflict detection (RT-01)**

Add `execFileSync` to the top imports:

```javascript
import { execFileSync } from "child_process";
```

Add above the `launchBrowser` function:

```javascript
function checkChromeRunning() {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  try {
    const result = execFileSync("pgrep", ["-f", "Google Chrome"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const pids = result.trim().split("\n").filter(Boolean);
    if (pids.length > 0) {
      console.error(
        "\n⛔ Chrome is already running (PIDs: " + pids.join(", ") + ").",
      );
      console.error(
        "   Launching a second Chrome instance can corrupt your browser's session state",
      );
      console.error("   (including Google sign-in across all tabs).");
      console.error(
        "\n   To fix: quit Chrome first, then re-run this command.",
      );
      console.error("   Or run: kill " + pids.join(" ") + "\n");
      process.exit(1);
    }
  } catch {
    // pgrep returns exit code 1 when no matches — safe to proceed
  }
}
```

- [ ] **Step 2: Add profile lock detection (RT-06)**

Add below `checkChromeRunning`:

```javascript
function checkProfileLock(dir) {
  const lockPath = join(dir, "SingletonLock");
  if (existsSync(lockPath)) {
    console.error(`\n⛔ Profile directory is locked: ${dir}`);
    console.error("   Another Chrome process is using this profile.");
    console.error(`   Run: rm "${lockPath}" (if no Chrome process is running)`);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Wire checks into launchBrowser**

At the top of `launchBrowser`, before the `mkdirSync` call:

```javascript
async function launchBrowser(profileName) {
  checkChromeRunning();
  const { chromium } = await import('playwright');
  const dir = profileDir(profileName);
  checkProfileLock(dir);
  mkdirSync(dir, { recursive: true });
```

- [ ] **Step 4: Test manually — Chrome running**

With Chrome open, run:

```bash
cd ~/.playwright-cli && node sign-in.mjs login cloudflare
```

Expected: Script aborts with the Chrome conflict message.

- [ ] **Step 5: Commit**

```bash
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: pre-flight Chrome conflict and profile lock detection (RT-01, RT-06)"
```

---

### Task 7: Enhanced Check Command (RT-02 through RT-05)

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs`

- [ ] **Step 1: Import cookie-analysis into sign-in.mjs**

Add to the top imports:

```javascript
import {
  analyzeCookieHealth,
  filterCookiesByDomain,
} from "./cookie-analysis.mjs";
```

- [ ] **Step 2: Replace printCookieSummary**

Replace the entire `printCookieSummary` function with:

```javascript
function printCookieSummary(state, siteName) {
  const cookies = state.cookies || [];
  const health = analyzeCookieHealth(cookies);

  if (health.status === "empty") {
    console.log(`  ${siteName}: no cookies saved`);
    return;
  }

  const c = health.classification;
  console.log(
    `  ${siteName}: ${c.total} cookies (${c.valid} valid, ${c.expired} expired, ${c.session_only} session-only, ${c.ephemeral} ephemeral)`,
  );

  for (const issue of health.jwtIssues) {
    console.log(`  ⚠ ${issue}`);
  }

  if (health.soonestAuthExpiry) {
    const r = health.soonestAuthExpiry.remaining;
    if (r <= 0) {
      console.log(
        `  ⚠ Auth "${health.soonestAuthExpiry.name}" EXPIRED ${formatDuration(-r)} ago`,
      );
      console.log(`    Re-run: node sign-in.mjs login ${siteName}`);
    } else if (r < 3600) {
      console.log(
        `  ⚠ Auth "${health.soonestAuthExpiry.name}" expires in ${formatDuration(r)}`,
      );
    } else {
      console.log(
        `  ✓ Auth "${health.soonestAuthExpiry.name}" valid for ${formatDuration(r)}`,
      );
    }
  }

  for (const w of health.warnings) {
    console.log(`  ℹ ${w}`);
  }

  if (health.status === "expired") {
    console.log(`  ❌ Status: EXPIRED — re-authenticate before use`);
  } else if (health.status === "degraded") {
    console.log(`  ⚠ Status: DEGRADED — see warnings above`);
  } else {
    console.log(`  ✓ Status: HEALTHY`);
  }
}
```

Also remove the old `EPHEMERAL` set and `AUTH_PATTERN` from `sign-in.mjs` since they now live in `cookie-analysis.mjs`.

- [ ] **Step 3: Test the enhanced check command**

Run:

```bash
cd ~/.playwright-cli && node sign-in.mjs check
```

Expected: For sites with expired JWTs, output now shows real session expiry and `Status: EXPIRED`.

- [ ] **Step 4: Commit**

```bash
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: JWT-aware check command with real expiry reporting (RT-02 through RT-05)"
```

---

### Task 8: Domain Filtering on Capture (RT-14)

**Files:**

- Modify: `skills/auth-browse/scripts/sign-in.mjs`

- [ ] **Step 1: Add domain filtering to performLogin**

In `sign-in.mjs`, in the `performLogin` function, immediately after the `context.storageState({ path: outFile })` call, add:

```javascript
try {
  const rawState = JSON.parse(readFileSync(outFile, "utf-8"));
  const originalCount = rawState.cookies.length;
  rawState.cookies = filterCookiesByDomain(rawState.cookies, url);
  if (rawState.cookies.length < originalCount) {
    console.log(
      `  Filtered cookies: ${originalCount} → ${rawState.cookies.length} (removed ${originalCount - rawState.cookies.length} unrelated domains)`,
    );
  }
  writeFileSync(outFile, JSON.stringify(rawState, null, 2) + "\n");
} catch (err) {
  console.error(`Warning: could not filter cookies: ${err.message}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add skills/auth-browse/scripts/sign-in.mjs
git commit -m "feat: filter captured cookies by domain, remove cross-contamination (RT-14)"
```

---

### Task 9: Update use-profiles Skill (RT-08, RT-10)

**Files:**

- Modify: `skills/use-profiles/SKILL.md`

- [ ] **Step 1: Replace the "Loading a Profile" section**

In `skills/use-profiles/SKILL.md`, replace the section starting at `## Loading a Profile` (line 46) through step 4 ("Navigate directly to the target authenticated page") with:

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add skills/use-profiles/SKILL.md
git commit -m "feat: add pre-load health check and cross-contamination detection to use-profiles (RT-08, RT-10)"
```

---

### Task 10: Update auth-browse Skill (RT-11, RT-12)

**Files:**

- Modify: `skills/auth-browse/SKILL.md`

- [ ] **Step 1: Add pre-browse validation section**

In `skills/auth-browse/SKILL.md`, after the `## Workflow` heading and before `### Step 1: Check existing auth`, insert:

```markdown
## Pre-Browse Validation

Before browsing any external service, perform these checks:

### Tier Selection (RT-11)

Cross-reference the target URL against known bot-protected domains. These domains **must** use Tier 2 (`--persistent --profile`) and **cannot** use `state-load`:

- `cloudflare.com`, `dash.cloudflare.com`
- `google.com`, `accounts.google.com`
- `console.aws.amazon.com`

If the target URL matches any of these domains and the planned approach is Tier 1 (state-load), warn the user and switch to Tier 2. Do not attempt state-load against these sites — it will fail silently.

For all other sites, default to Tier 1 (state-load) and fall back to Tier 2 only if state-load fails.

### Auth Freshness (RT-12)

Before loading any auth state, check whether it is still valid:

1. Run `node ~/.playwright-cli/sign-in.mjs check <site>` via Bash.
2. Look at the output. If it shows `Status: EXPIRED` or any `⚠ Auth ... EXPIRED` lines, the auth is stale.
3. If stale: inform the user and prompt for re-auth (`node ~/.playwright-cli/sign-in.mjs login <site>`) **before** attempting to browse. Do not load expired auth and navigate — it wastes time.
4. If healthy: proceed with the browsing workflow below.
```

- [ ] **Step 2: Commit**

```bash
git add skills/auth-browse/SKILL.md
git commit -m "feat: add tier validation and freshness check to auth-browse (RT-11, RT-12)"
```

---

### Task 11: Update capture-auth Skill (RT-13)

**Files:**

- Modify: `skills/capture-auth/SKILL.md`

- [ ] **Step 1: Add post-capture validation**

In `skills/capture-auth/SKILL.md`, replace the heading `### Step 4: Test browsing` and its first paragraph with:

````markdown
### Step 4: Validate and test

After the user confirms sign-in is complete, validate the captured auth:

```bash
node ~/.playwright-cli/sign-in.mjs check <name>
```

Review the output:

- **Status: HEALTHY** — proceed to test browsing.
- **Status: EXPIRED** — the capture failed or the session expired before saving. Re-run sign-in.
- **Status: DEGRADED** — check the warnings. Common issues:
  - "No auth-relevant cookies found" — the app may use httpOnly cookies not captured by storageState, or sign-in wasn't completed before saving.
  - "N session-only cookies will not survive state-load" — this app needs `--persistent --profile` instead.
  - Supabase session expires in <2h — normal for Supabase, but the profile will need frequent refresh.

If the app uses Supabase (look for `sb-*-auth-token` in the check output), note the real session TTL. Supabase access tokens typically expire in 1 hour — inform the user that profiles will need refresh before each work session.

Then test browsing:
````

The rest of Step 4 (the `playwright-cli open` / `state-load` / `reload` / `snapshot` sequence) remains unchanged.

- [ ] **Step 2: Commit**

```bash
git add skills/capture-auth/SKILL.md
git commit -m "feat: add post-capture validation with Supabase TTL warning to capture-auth (RT-13)"
```

---

### Task 12: Update Setup Command and CI

**Files:**

- Modify: `commands/setup-auth-browse.md`
- Modify: `.github/workflows/validate.yml`

- [ ] **Step 1: Update setup-auth-browse to copy cookie-analysis.mjs**

In `commands/setup-auth-browse.md`, in `## Step 2: Install the Sign-In Script`, after the existing `cp` command for `sign-in.mjs`, add:

````markdown
Also copy the cookie analysis module that sign-in.mjs depends on:

```bash
cp <found-path-directory>/cookie-analysis.mjs ~/.playwright-cli/cookie-analysis.mjs
```

Where `<found-path-directory>` is the same directory as `sign-in.mjs`. Use Glob to find it:

```
**/skills/auth-browse/scripts/cookie-analysis.mjs
```
````

- [ ] **Step 2: Add unit test job to CI**

In `.github/workflows/validate.yml`, add a new job after `validate-markdown`:

```yaml
unit-tests:
  name: Unit Tests
  runs-on: ubuntu-latest
  steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: "20"

    - name: Install dependencies
      run: npm ci

    - name: Run unit tests
      run: npm test
```

Update the `release` job's `needs` to include `unit-tests`:

```yaml
needs: [validate-plugin, validate-markdown, unit-tests]
```

- [ ] **Step 3: Commit**

```bash
git add commands/setup-auth-browse.md .github/workflows/validate.yml
git commit -m "chore: copy cookie-analysis.mjs in setup, add unit tests to CI"
```

---

### Task 13: Manual Verification Checklist (Layer A)

**Files:**

- Create: `docs/manual-verification.md`

- [ ] **Step 1: Write the checklist**

Create `docs/manual-verification.md`:

```markdown
# Manual Verification Checklist

Run after plugin version bumps, Chrome major version updates, or when adding support for new sites.

## MN-01: Chrome Singleton Safety

**Precondition:** Real Chrome is open with Google signed in.

1. Run: `node ~/.playwright-cli/sign-in.mjs login cloudflare`
2. Verify: Script aborts with Chrome conflict message (RT-01)
3. Verify: Real Chrome still has Google signed in (check Gmail in a tab)

- [ ] Pass / Fail — Date: \_\_\_\_

## MN-02: Cloudflare Session Lifetime

**Precondition:** Real Chrome is closed.

1. Run: `node ~/.playwright-cli/sign-in.mjs login cloudflare` — sign in
2. At T+1h: `node ~/.playwright-cli/sign-in.mjs check cloudflare` — verify healthy
3. At T+4h: repeat check — verify still healthy
4. At T+24h: repeat check — if expired, verify output says EXPIRED (not misleading hours remaining)

- [ ] 1h: Pass / Fail
- [ ] 4h: Pass / Fail
- [ ] 24h: Pass / Fail — Date: \_\_\_\_

## MN-03: Supabase Session Lifetime

**Precondition:** Local Supabase dev server running.

1. Run `/setup-profiles` for a Supabase app
2. At T+15m: load profile via `use-profiles` — verify session works
3. At T+1h: load profile — verify RT-08 detects JWT expiry pre-load
4. At T+4h: load profile — verify skill suggests `/setup-profiles` without navigating first

- [ ] 15m: Pass / Fail
- [ ] 1h: Pass / Fail
- [ ] 4h: Pass / Fail — Date: \_\_\_\_

## MN-04: Bot Detection Bypass

**Precondition:** Real Chrome is closed.

1. Run: `node ~/.playwright-cli/sign-in.mjs login cloudflare`
2. Verify: No Turnstile challenge during sign-in
3. Run: `node ~/.playwright-cli/sign-in.mjs login github` (uses Google OAuth if configured)
4. Verify: No "This browser or app may not be secure" message

- [ ] Cloudflare: Pass / Fail
- [ ] Google OAuth: Pass / Fail — Date: \_\_\_\_

## MN-05: Multi-User Isolation

1. Sign in as user A: `node ~/.playwright-cli/sign-in.mjs login myapp --profile user-a`
2. Sign in as user B: `node ~/.playwright-cli/sign-in.mjs login myapp --profile user-b`
3. Verify: `~/.playwright-cli/chrome-profile-user-a/` and `chrome-profile-user-b/` are separate
4. Browse with profile A: verify user A's session
5. Browse with profile B: verify user B's session, user A not visible

- [ ] Pass / Fail — Date: \_\_\_\_

## MN-06: Tier Accuracy

For each site in `references/bot-detection.md` compatibility matrix:

| Site       | Expected Tier | state-load works? | persistent works? | Date |
| ---------- | ------------- | ----------------- | ----------------- | ---- |
| GitHub     | Both          | [ ]               | [ ]               |      |
| Vercel     | Both          | [ ]               | [ ]               |      |
| Sentry     | Both          | [ ]               | [ ]               |      |
| PostHog    | Both          | [ ]               | [ ]               |      |
| Supabase   | Both          | [ ]               | [ ]               |      |
| Cloudflare | Tier 2 only   | [ ] Blocked       | [ ] Works         |      |
| Google/AWS | Tier 2 only   | [ ] Blocked       | [ ] Works         |      |
```

- [ ] **Step 2: Commit**

```bash
git add docs/manual-verification.md
git commit -m "docs: manual verification checklist for acceptance criteria (MN-01 through MN-06)"
```

---

## Spec Coverage

| Spec criterion                | Task                                |
| ----------------------------- | ----------------------------------- |
| RT-01 Chrome conflict         | Task 6                              |
| RT-02 Post-capture quality    | Task 7                              |
| RT-03 Supabase JWT expiry     | Task 7 (via analyzeCookieHealth)    |
| RT-04 Generic JWT detection   | Task 7 (via analyzeCookieHealth)    |
| RT-05 Session-only warning    | Task 7 (via analyzeCookieHealth)    |
| RT-06 Profile lock            | Task 6                              |
| RT-07 Profile existence       | Already passes — no change needed   |
| RT-08 Pre-load health check   | Task 9                              |
| RT-09 Redirect detection      | Already passes — no change needed   |
| RT-10 Cross-contamination     | Task 9                              |
| RT-11 Tier validation         | Task 10                             |
| RT-12 Auth freshness          | Task 10                             |
| RT-13 Post-capture validation | Task 11                             |
| RT-14 Domain filtering        | Task 3 (function) + Task 8 (wiring) |
| UT-01 through UT-05           | Task 2                              |
| UT-06 through UT-09           | Task 4                              |
| UT-10                         | Task 5                              |
| UT-11                         | Task 3                              |
| MN-01 through MN-06           | Task 13                             |
