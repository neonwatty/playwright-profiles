import { describe, it, expect } from "vitest";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { makeSiteConfig } from "./helpers.mjs";
import {
  resolveTier,
  saveSiteTier,
  loadSites,
} from "../skills/auth-browse/scripts/sign-in.mjs";

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

const SITES_FILE = join(homedir(), ".playwright-cli", "sites.json");

describe("saveSiteTier (UT-14)", () => {
  it("writes tier to sites.json for an existing custom site", () => {
    const backup = existsSync(SITES_FILE)
      ? JSON.parse(readFileSync(SITES_FILE, "utf-8"))
      : null;

    try {
      const testSites = {
        "test-tier-site": { url: "https://example.com", waitFor: "/dash" },
      };
      mkdirSync(join(homedir(), ".playwright-cli"), { recursive: true });
      writeFileSync(SITES_FILE, JSON.stringify(testSites, null, 2) + "\n");

      saveSiteTier("test-tier-site", "chrome");

      const sites = loadSites();
      expect(sites["test-tier-site"].tier).toBe("chrome");
      expect(sites["test-tier-site"].url).toBe("https://example.com");
      expect(sites["test-tier-site"].waitFor).toBe("/dash");
    } finally {
      if (backup) {
        writeFileSync(SITES_FILE, JSON.stringify(backup, null, 2) + "\n");
      } else if (existsSync(SITES_FILE)) {
        unlinkSync(SITES_FILE);
      }
    }
  });

  it("creates entry in sites.json for a built-in site", () => {
    const backup = existsSync(SITES_FILE)
      ? JSON.parse(readFileSync(SITES_FILE, "utf-8"))
      : null;

    try {
      const testSites = backup ? { ...backup } : {};
      delete testSites["__test-builtin"];
      writeFileSync(SITES_FILE, JSON.stringify(testSites, null, 2) + "\n");

      saveSiteTier("__test-builtin", "chrome");

      const raw = JSON.parse(readFileSync(SITES_FILE, "utf-8"));
      expect(raw["__test-builtin"]).toEqual({ tier: "chrome" });
    } finally {
      if (backup) {
        writeFileSync(SITES_FILE, JSON.stringify(backup, null, 2) + "\n");
      } else if (existsSync(SITES_FILE)) {
        unlinkSync(SITES_FILE);
      }
    }
  });
});
