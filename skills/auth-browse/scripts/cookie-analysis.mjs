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

/** Auth-relevant cookie name pattern. */
const AUTH_PATTERN = /auth|session|token|sid|jwt|identity|logged/i;

/** Returns true if the cookie name matches auth-relevant patterns. */
export function isAuthCookie(name) {
  return AUTH_PATTERN.test(name);
}

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
