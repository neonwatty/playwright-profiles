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
