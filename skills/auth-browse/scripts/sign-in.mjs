#!/usr/bin/env node

/**
 * Persistent browser sign-in script for external services.
 *
 * Launches real Chrome with automation flags stripped so Google OAuth,
 * Cloudflare Turnstile, and other bot-detection systems allow sign-in.
 * Auth state accumulates in a shared Chrome profile at ~/.playwright-cli/.
 *
 * Usage:
 *   node sign-in.mjs login <site|url>   Sign in and save auth state
 *   node sign-in.mjs check [site]       Check saved auth expiry
 *   node sign-in.mjs list               List preconfigured sites
 *   node sign-in.mjs add <name> <url> [waitFor]  Add a new site shortcut
 *   node sign-in.mjs help               Show help
 *
 * Requires: npm install playwright (in the same directory or globally)
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Config ──────────────────────────────────────────────────────────
const BASE_DIR = join(homedir(), '.playwright-cli');
const PROFILE_DIR = join(BASE_DIR, 'chrome-profile');
const SITES_FILE = join(BASE_DIR, 'sites.json');

// Default Chrome path per platform
const CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};
const CHROME_PATH = CHROME_PATHS[process.platform] || CHROME_PATHS.darwin;

// ── Sites config ────────────────────────────────────────────────────

// Built-in site shortcuts (user can add more via `add` command)
const DEFAULT_SITES = {
  github:     { url: 'https://github.com/login',          waitFor: 'github.com' },
  cloudflare: { url: 'https://dash.cloudflare.com/',       waitFor: 'dash.cloudflare.com' },
  vercel:     { url: 'https://vercel.com/login',            waitFor: 'vercel.com' },
  sentry:     { url: 'https://sentry.io/auth/login/',       waitFor: 'sentry.io/organizations' },
  posthog:    { url: 'https://us.posthog.com/',              waitFor: 'us.posthog.com' },
  supabase:   { url: 'https://supabase.com/dashboard',       waitFor: 'supabase.com/dashboard' },
  aws:        { url: 'https://console.aws.amazon.com/',      waitFor: 'console.aws.amazon.com' },
  netlify:    { url: 'https://app.netlify.com/',              waitFor: 'app.netlify.com' },
  railway:    { url: 'https://railway.com/login',             waitFor: 'railway.com' },
  render:     { url: 'https://dashboard.render.com/',          waitFor: 'dashboard.render.com' },
};

function loadSites() {
  const sites = { ...DEFAULT_SITES };
  if (existsSync(SITES_FILE)) {
    try {
      const custom = JSON.parse(readFileSync(SITES_FILE, 'utf-8'));
      Object.assign(sites, custom);
    } catch {
      // Ignore malformed file, use defaults
    }
  }
  return sites;
}

function saveSite(name, url, waitFor) {
  let custom = {};
  if (existsSync(SITES_FILE)) {
    try {
      custom = JSON.parse(readFileSync(SITES_FILE, 'utf-8'));
    } catch {
      custom = {};
    }
  }
  custom[name] = { url, waitFor: waitFor || new URL(url).hostname };
  mkdirSync(BASE_DIR, { recursive: true });
  writeFileSync(SITES_FILE, JSON.stringify(custom, null, 2) + '\n');
}

function authFile(site) {
  return join(BASE_DIR, `auth-${site}.json`);
}

// ── Shared browser launch ───────────────────────────────────────────

async function launchBrowser() {
  mkdirSync(PROFILE_DIR, { recursive: true });

  return chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: CHROME_PATH,
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

// ── Auto-detect sign-in completion ──────────────────────────────────

async function waitForSignIn(page, waitForPattern, timeoutMs = 120_000) {
  return Promise.race([
    // Auto-detect: poll URL for the waitFor pattern
    (async () => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const url = page.url();
        if (url.includes(waitForPattern)) {
          // Small delay to let cookies settle after redirect
          await new Promise(r => setTimeout(r, 2000));
          return 'auto';
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return 'timeout';
    })(),
    // Manual: user presses Enter
    new Promise((resolve) => {
      process.stdin.once('data', () => resolve('manual'));
    }),
  ]);
}

// ── Commands ────────────────────────────────────────────────────────

async function login(siteName) {
  const sites = loadSites();
  const site = sites[siteName];
  if (!site) {
    console.error(`Unknown site: ${siteName}`);
    console.error(`Available: ${Object.keys(sites).join(', ')}, or pass a URL`);
    process.exit(1);
  }

  const outFile = authFile(siteName);
  console.log(`\n🔐 Signing into: ${siteName} (${site.url})`);
  console.log(`   Auth will be saved to: ${outFile}\n`);

  const context = await launchBrowser();
  const page = context.pages()[0] || await context.newPage();
  await page.goto(site.url, { waitUntil: 'domcontentloaded' });

  console.log('Sign in using the browser window.');
  console.log('Auth state will save automatically when sign-in is detected.');
  console.log('Or press Enter manually to save at any time.\n');

  const result = await waitForSignIn(page, site.waitFor);

  if (result === 'timeout') {
    console.log('⚠ Timed out waiting for sign-in. Saving current state anyway.');
  } else if (result === 'auto') {
    console.log('✓ Sign-in detected automatically.');
  } else {
    console.log('✓ Manual save triggered.');
  }

  await context.storageState({ path: outFile });
  console.log(`Auth state saved to ${outFile}`);

  const state = JSON.parse(readFileSync(outFile, 'utf-8'));
  printCookieSummary(state, siteName);

  await context.close();
  process.exit(0);
}

async function loginUrl(url) {
  const hostname = new URL(url).hostname.replace(/\./g, '-');
  const outFile = join(BASE_DIR, `auth-${hostname}.json`);

  console.log(`\n🔐 Signing into: ${url}`);
  console.log(`   Auth will be saved to: ${outFile}\n`);

  const context = await launchBrowser();
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  console.log('Sign in using the browser window.');
  console.log('Press Enter here to save auth state.\n');

  await new Promise((resolve) => {
    process.stdin.once('data', resolve);
  });

  await context.storageState({ path: outFile });
  console.log(`Auth state saved to ${outFile}`);

  const state = JSON.parse(readFileSync(outFile, 'utf-8'));
  printCookieSummary(state, hostname);

  await context.close();
  process.exit(0);
}

function check(siteName) {
  const sites = loadSites();
  if (siteName) {
    checkSite(siteName, sites);
  } else {
    let found = false;
    for (const site of Object.keys(sites)) {
      const file = authFile(site);
      if (existsSync(file)) {
        found = true;
        checkSite(site, sites);
        console.log('');
      }
    }
    if (!found) {
      console.log('No saved auth states found.');
      console.log('Run: node sign-in.mjs login <site>');
      console.log(`Available: ${Object.keys(sites).join(', ')}`);
    }
  }
}

function checkSite(siteName, sites) {
  const file = (sites && sites[siteName]) ? authFile(siteName) : join(BASE_DIR, `auth-${siteName}.json`);

  if (!existsSync(file)) {
    console.log(`${siteName}: no saved auth (${file} not found)`);
    return;
  }

  const state = JSON.parse(readFileSync(file, 'utf-8'));
  printCookieSummary(state, siteName);
}

function printCookieSummary(state, siteName) {
  const now = Date.now() / 1000;
  const cookies = state.cookies || [];

  if (cookies.length === 0) {
    console.log(`  ${siteName}: no cookies saved`);
    return;
  }

  // Skip ephemeral cookies that rotate frequently
  const EPHEMERAL = new Set([
    '__cf_bm', '__stripe_sid', '__stripe_mid', '_cfuvid',
    'cf_clearance', '__cflb',
  ]);

  const byDomain = {};
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, '');
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(c);
  }

  console.log(`  ${siteName}: ${cookies.length} cookies across ${Object.keys(byDomain).length} domains`);

  // Find soonest-expiring non-session, non-ephemeral cookie
  const expiring = cookies
    .filter(c => c.expires > 0 && !EPHEMERAL.has(c.name))
    .sort((a, b) => a.expires - b.expires);

  if (expiring.length > 0) {
    const soonest = expiring[0];
    const remaining = soonest.expires - now;

    if (remaining <= 0) {
      console.log(`  ⚠ Soonest cookie "${soonest.name}" expired ${formatDuration(-remaining)} ago`);
    } else if (remaining < 3600) {
      console.log(`  ⚠ Soonest cookie "${soonest.name}" expires in ${formatDuration(remaining)}`);
    } else {
      console.log(`  ✓ Soonest expiry: "${soonest.name}" in ${formatDuration(remaining)}`);
    }
  }

  // Show auth-relevant cookies
  const authCookies = cookies.filter(c =>
    /auth|session|token|sid|jwt|identity|logged/i.test(c.name)
    && !EPHEMERAL.has(c.name)
    && c.expires > 0
  );
  if (authCookies.length > 0) {
    const authSoonest = authCookies.sort((a, b) => a.expires - b.expires)[0];
    const authRemaining = authSoonest.expires - now;
    if (authRemaining <= 0) {
      console.log(`  ⚠ Auth cookie "${authSoonest.name}" EXPIRED ${formatDuration(-authRemaining)} ago`);
      console.log(`    Re-run: node sign-in.mjs login ${siteName}`);
    } else {
      console.log(`  ✓ Auth cookie "${authSoonest.name}" valid for ${formatDuration(authRemaining)}`);
    }
  } else {
    console.log(`  ℹ No expiring auth cookies found (may use session-only or httpOnly cookies)`);
  }
}

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function printHelp() {
  const sites = loadSites();
  console.log(`
Persistent browser sign-in for external services.

Launches real Chrome with automation flags stripped so Google OAuth,
Cloudflare Turnstile, and other bot-detection systems allow sign-in.
Auth state accumulates in a shared Chrome profile at ~/.playwright-cli/.

Usage: node sign-in.mjs <command> [args]

Commands:
  login <site>                Sign in and save auth state (auto-detects completion)
  login <url>                 Sign into an arbitrary URL
  check [site]                Check expiry status of saved auth states
  list                        List available site shortcuts
  add <name> <url> [waitFor]  Add a custom site shortcut
  help                        Show this help

Sites: ${Object.keys(sites).join(', ')}

Examples:
  node sign-in.mjs login cloudflare
  node sign-in.mjs login https://console.aws.amazon.com
  node sign-in.mjs check
  node sign-in.mjs add myapp https://myapp.com/login myapp.com/dashboard

After signing in, browse authenticated with playwright-cli:
  playwright-cli open <url> --headed --browser chrome \\
    --persistent --profile ~/.playwright-cli/chrome-profile

Profile & auth files: ~/.playwright-cli/
`);
}

// ── CLI parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0] || 'help';

switch (command) {
  case 'login': {
    const target = args[1];
    if (!target) {
      console.error('Usage: sign-in.mjs login <site|url>');
      process.exit(1);
    }
    if (target.startsWith('http')) {
      await loginUrl(target);
    } else {
      await login(target);
    }
    break;
  }
  case 'check':
    check(args[1]);
    break;
  case 'list': {
    const sites = loadSites();
    console.log('Available sites:');
    for (const [name, site] of Object.entries(sites)) {
      console.log(`  ${name.padEnd(15)} ${site.url}`);
    }
    break;
  }
  case 'add': {
    const [, name, url, waitFor] = args;
    if (!name || !url) {
      console.error('Usage: sign-in.mjs add <name> <url> [waitFor]');
      process.exit(1);
    }
    saveSite(name, url, waitFor);
    console.log(`Added site shortcut: ${name} → ${url}`);
    break;
  }
  case 'help':
  default:
    printHelp();
    break;
}
