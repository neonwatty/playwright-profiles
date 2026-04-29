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
