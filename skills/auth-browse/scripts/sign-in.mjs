#!/usr/bin/env node

/**
 * Persistent browser sign-in script for external services.
 *
 * Launches real Chrome with automation flags stripped so Google OAuth,
 * Cloudflare Turnstile, and other bot-detection systems allow sign-in.
 * Auth state accumulates in a Chrome profile at ~/.playwright-cli/.
 * Use --profile <name> for isolated profiles (multi-user/QA).
 *
 * Usage:
 *   node sign-in.mjs login <site|url> [--profile <name>]  Sign in and save auth state
 *   node sign-in.mjs check [site]        Check saved auth expiry
 *   node sign-in.mjs list                List preconfigured sites
 *   node sign-in.mjs add <name> <url> [waitFor]  Add a new site shortcut
 *   node sign-in.mjs help                Show help
 *
 * Requires: npm install playwright (in the same directory or globally)
 */

/**
 * @typedef {{ url: string, waitFor: string }} SiteConfig
 * `waitFor` is a URL substring that indicates successful sign-in.
 * It must NOT match the login URL itself — use a post-login path
 * (e.g., '/dashboard', '/organizations') to avoid false auto-detect.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
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
if (!(process.platform in CHROME_PATHS)) {
  console.error(`Warning: unsupported platform "${process.platform}", defaulting to macOS Chrome path.`);
}
const CHROME_PATH = CHROME_PATHS[process.platform] || CHROME_PATHS.darwin;

// ── Sites config ────────────────────────────────────────────────────

// Built-in site shortcuts. waitFor patterns must NOT match the login URL.
const DEFAULT_SITES = {
  github:     { url: 'https://github.com/login',              waitFor: 'github.com/dashboard' },
  cloudflare: { url: 'https://dash.cloudflare.com/',           waitFor: '/home' },
  vercel:     { url: 'https://vercel.com/login',               waitFor: 'vercel.com/~' },
  sentry:     { url: 'https://sentry.io/auth/login/',          waitFor: 'sentry.io/organizations' },
  posthog:    { url: 'https://us.posthog.com/',                 waitFor: '/project' },
  supabase:   { url: 'https://supabase.com/dashboard',          waitFor: '/projects' },
  aws:        { url: 'https://console.aws.amazon.com/',         waitFor: 'console/home' },
  netlify:    { url: 'https://app.netlify.com/',                waitFor: '/sites' },
  railway:    { url: 'https://railway.com/login',               waitFor: 'railway.com/project' },
  render:     { url: 'https://dashboard.render.com/',            waitFor: '/services' },
};

function loadSites() {
  const sites = { ...DEFAULT_SITES };
  if (existsSync(SITES_FILE)) {
    try {
      const custom = JSON.parse(readFileSync(SITES_FILE, 'utf-8'));
      Object.assign(sites, custom);
    } catch (err) {
      console.error(`Warning: could not parse ${SITES_FILE}, using defaults: ${err.message}`);
    }
  }
  return sites;
}

function saveSite(name, url, waitFor) {
  // Validate site name (alphanumeric, hyphens, underscores only)
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    console.error(`Invalid site name "${name}". Use only letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: "${url}"`);
    process.exit(1);
  }

  let custom = {};
  if (existsSync(SITES_FILE)) {
    try {
      custom = JSON.parse(readFileSync(SITES_FILE, 'utf-8'));
    } catch (err) {
      console.error(`Warning: could not parse ${SITES_FILE}, starting fresh: ${err.message}`);
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

// ── Profile management ──────────────────────────────────────────────

function profileDir(profileName) {
  if (!profileName || profileName === 'default') return PROFILE_DIR;
  if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) {
    console.error(`Invalid profile name "${profileName}". Use only letters, numbers, hyphens, and underscores.`);
    process.exit(1);
  }
  return join(BASE_DIR, `chrome-profile-${profileName}`);
}

// ── Shared browser launch ───────────────────────────────────────────

async function launchBrowser(profileName) {
  const dir = profileDir(profileName);
  mkdirSync(dir, { recursive: true });

  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at: ${CHROME_PATH}`);
    console.error('Install Google Chrome or edit CHROME_PATHS in this script.');
    process.exit(1);
  }

  try {
    return await chromium.launchPersistentContext(dir, {
      executablePath: CHROME_PATH,
      headless: false,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (err) {
    if (err.message.includes('existing browser session') || err.message.includes('Target page, context or browser has been closed')) {
      console.error(`Chrome is already running with profile "${profileName || 'default'}".`);
      console.error(`Close it or run: kill $(pgrep -f "${basename(dir)}")`);
    } else {
      console.error(`Failed to launch Chrome: ${err.message}`);
    }
    process.exit(1);
  }
}

// ── Auto-detect sign-in completion ──────────────────────────────────

async function waitForSignIn(page, waitForPattern, startUrl, timeoutMs = 120_000) {
  let stdinHandler;

  const result = await Promise.race([
    // Auto-detect: poll URL for the waitFor pattern
    (async () => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const url = page.url();
        // Only match after navigating away from the starting URL
        if (url !== startUrl && url.includes(waitForPattern)) {
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
      stdinHandler = () => resolve('manual');
      process.stdin.once('data', stdinHandler);
    }),
  ]);

  // Clean up the losing branch
  if (stdinHandler) {
    process.stdin.removeListener('data', stdinHandler);
  }
  process.stdin.unref();

  return result;
}

// ── Shared login logic ──────────────────────────────────────────────

async function performLogin({ url, outFile, siteName, waitForPattern, profileName }) {
  console.log(`\n🔐 Signing into: ${siteName} (${url})`);
  if (profileName && profileName !== 'default') {
    console.log(`   Chrome profile: chrome-profile-${profileName}`);
  }
  console.log(`   Auth will be saved to: ${outFile}\n`);

  const context = await launchBrowser(profileName);

  // Ensure cleanup on Ctrl+C
  const cleanup = async () => {
    console.log('\nInterrupted — closing browser...');
    await context.close().catch(() => {});
    process.exit(130);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    console.error(`Failed to navigate to ${url}: ${err.message}`);
    await context.close().catch(() => {});
    process.exit(1);
  }

  const startUrl = page.url();

  if (waitForPattern) {
    console.log('Sign in using the browser window.');
    console.log('Auth state will save automatically when sign-in is detected.');
    console.log('Or press Enter manually to save at any time.\n');

    const result = await waitForSignIn(page, waitForPattern, startUrl);

    if (result === 'timeout') {
      console.log('⚠ Timed out waiting for sign-in. Saving current state anyway.');
    } else if (result === 'auto') {
      console.log('✓ Sign-in detected automatically.');
    } else {
      console.log('✓ Manual save triggered.');
    }
  } else {
    console.log('Sign in using the browser window.');
    console.log('Press Enter here to save auth state.\n');

    await new Promise((resolve) => {
      process.stdin.once('data', resolve);
    });
    console.log('✓ Manual save triggered.');
  }

  try {
    await context.storageState({ path: outFile });
  } catch (err) {
    console.error(`Failed to save auth state: ${err.message}`);
    await context.close().catch(() => {});
    process.exit(1);
  }

  console.log(`Auth state saved to ${outFile}`);

  const state = JSON.parse(readFileSync(outFile, 'utf-8'));
  printCookieSummary(state, siteName);

  process.removeListener('SIGINT', cleanup);
  process.removeListener('SIGTERM', cleanup);
  await context.close();
  process.exit(0);
}

// ── Commands ────────────────────────────────────────────────────────

async function login(siteName, profileName) {
  const sites = loadSites();
  const site = sites[siteName];
  if (!site) {
    console.error(`Unknown site: ${siteName}`);
    console.error(`Available: ${Object.keys(sites).join(', ')}, or pass a URL`);
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

async function loginUrl(url, profileName) {
  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: "${url}"`);
    process.exit(1);
  }

  const hostname = new URL(url).hostname.replace(/\./g, '-');
  await performLogin({
    url,
    outFile: authFile(hostname),
    siteName: hostname,
    waitForPattern: null, // No auto-detect for arbitrary URLs
    profileName,
  });
}

function check(siteName) {
  const sites = loadSites();
  if (siteName) {
    checkSite(siteName, sites);
    return;
  }

  // Check known sites + discover auth files from URL-based logins
  const checked = new Set();
  let found = false;

  // Known sites first
  for (const site of Object.keys(sites)) {
    const file = authFile(site);
    if (existsSync(file)) {
      found = true;
      checked.add(basename(file));
      checkSite(site, sites);
      console.log('');
    }
  }

  // Discover auth-*.json files not covered by known sites
  if (existsSync(BASE_DIR)) {
    for (const file of readdirSync(BASE_DIR)) {
      if (file.startsWith('auth-') && file.endsWith('.json') && !checked.has(file)) {
        found = true;
        const name = file.replace(/^auth-/, '').replace(/\.json$/, '');
        checkSite(name, sites);
        console.log('');
      }
    }
  }

  if (!found) {
    console.log('No saved auth states found.');
    console.log('Run: node sign-in.mjs login <site>');
    console.log(`Available: ${Object.keys(sites).join(', ')}`);
  }
}

function checkSite(siteName, sites) {
  const file = (sites && sites[siteName]) ? authFile(siteName) : join(BASE_DIR, `auth-${siteName}.json`);

  if (!existsSync(file)) {
    console.log(`${siteName}: no saved auth (${file} not found)`);
    return;
  }

  try {
    const state = JSON.parse(readFileSync(file, 'utf-8'));
    printCookieSummary(state, siteName);
  } catch (err) {
    console.log(`  ${siteName}: corrupted auth file (${err.message})`);
  }
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
  const meaningful = cookies
    .filter(c => c.expires > 0 && !EPHEMERAL.has(c.name))
    .sort((a, b) => a.expires - b.expires);

  if (meaningful.length > 0) {
    const soonest = meaningful[0];
    const remaining = soonest.expires - now;

    if (remaining <= 0) {
      console.log(`  ⚠ Soonest cookie "${soonest.name}" expired ${formatDuration(-remaining)} ago`);
    } else if (remaining < 3600) {
      console.log(`  ⚠ Soonest cookie "${soonest.name}" expires in ${formatDuration(remaining)}`);
    } else {
      console.log(`  ✓ Soonest expiry: "${soonest.name}" in ${formatDuration(remaining)}`);
    }
  }

  // Show auth-relevant cookies (subset of meaningful, already sorted)
  const authCookies = meaningful.filter(c =>
    /auth|session|token|sid|jwt|identity|logged/i.test(c.name)
  );
  if (authCookies.length > 0) {
    const authSoonest = authCookies[0];
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
Auth state accumulates in a Chrome profile at ~/.playwright-cli/.

Usage: node sign-in.mjs <command> [args]

Commands:
  login <site> [--profile <name>]   Sign in and save auth state
  login <url>  [--profile <name>]   Sign into an arbitrary URL
  check [site]                       Check expiry status of saved auth states
  list                               List available site shortcuts
  add <name> <url> [waitFor]         Add a custom site shortcut
  help                               Show this help

Options:
  --profile <name>    Use an isolated Chrome profile (chrome-profile-<name>).
                      Useful for multiple accounts on the same domain
                      (e.g., admin vs planner on the same app).
                      Without this flag, uses the shared default profile.

Sites: ${Object.keys(sites).join(', ')}

Examples:
  node sign-in.mjs login cloudflare
  node sign-in.mjs login https://console.aws.amazon.com
  node sign-in.mjs check
  node sign-in.mjs add myapp https://myapp.com/login myapp.com/dashboard

  # Multi-user / QA profiles
  node sign-in.mjs login seatify-admin --profile seatify-admin
  node sign-in.mjs login seatify-planner --profile seatify-planner

After signing in, browse authenticated with playwright-cli:
  playwright-cli open <url> --headed --browser chrome \\
    --persistent --profile ~/.playwright-cli/chrome-profile

  # With an isolated profile:
  playwright-cli open <url> --headed --browser chrome \\
    --persistent --profile ~/.playwright-cli/chrome-profile-seatify-admin

Profile & auth files: ~/.playwright-cli/
`);
}

// ── CLI parsing ─────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);

// Extract --profile <name> from anywhere in the args
let cliProfile;
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--profile') {
    if (i + 1 >= rawArgs.length) {
      console.error('Error: --profile requires a name argument.');
      process.exit(1);
    }
    cliProfile = rawArgs[++i];
  } else {
    args.push(rawArgs[i]);
  }
}

const command = args[0] || 'help';

switch (command) {
  case 'login': {
    const target = args[1];
    if (!target) {
      console.error('Usage: sign-in.mjs login <site|url> [--profile <name>]');
      process.exit(1);
    }
    if (target.startsWith('http')) {
      await loginUrl(target, cliProfile);
    } else {
      await login(target, cliProfile);
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
