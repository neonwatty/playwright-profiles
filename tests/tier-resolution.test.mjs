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

describe("loadSites merge behavior", () => {
  it("merges partial custom entry with built-in site, preserving url and waitFor", () => {
    const backup = existsSync(SITES_FILE)
      ? readFileSync(SITES_FILE, "utf-8")
      : null;

    try {
      // Write only a tier override for a built-in site (no url/waitFor)
      const custom = { supabase: { tier: "chrome" } };
      mkdirSync(join(homedir(), ".playwright-cli"), { recursive: true });
      writeFileSync(SITES_FILE, JSON.stringify(custom, null, 2) + "\n");

      const sites = loadSites();
      expect(sites.supabase.tier).toBe("chrome");
      expect(sites.supabase.url).toBeDefined();
      expect(sites.supabase.waitFor).toBeDefined();
    } finally {
      if (backup) {
        writeFileSync(SITES_FILE, backup);
      } else if (existsSync(SITES_FILE)) {
        unlinkSync(SITES_FILE);
      }
    }
  });

  it("lets a custom entry override a built-in site url", () => {
    const backup = existsSync(SITES_FILE)
      ? readFileSync(SITES_FILE, "utf-8")
      : null;

    try {
      const custom = { github: { url: "https://github.enterprise.com" } };
      mkdirSync(join(homedir(), ".playwright-cli"), { recursive: true });
      writeFileSync(SITES_FILE, JSON.stringify(custom, null, 2) + "\n");

      const sites = loadSites();
      expect(sites.github.url).toBe("https://github.enterprise.com");
      expect(sites.github.waitFor).toBeDefined();
    } finally {
      if (backup) {
        writeFileSync(SITES_FILE, backup);
      } else if (existsSync(SITES_FILE)) {
        unlinkSync(SITES_FILE);
      }
    }
  });

  it("returns a custom-only site with no built-in counterpart", () => {
    const backup = existsSync(SITES_FILE)
      ? readFileSync(SITES_FILE, "utf-8")
      : null;

    try {
      const custom = {
        "my-app": { url: "https://my-app.com", waitFor: "/home" },
      };
      mkdirSync(join(homedir(), ".playwright-cli"), { recursive: true });
      writeFileSync(SITES_FILE, JSON.stringify(custom, null, 2) + "\n");

      const sites = loadSites();
      expect(sites["my-app"].url).toBe("https://my-app.com");
      expect(sites["my-app"].waitFor).toBe("/home");
    } finally {
      if (backup) {
        writeFileSync(SITES_FILE, backup);
      } else if (existsSync(SITES_FILE)) {
        unlinkSync(SITES_FILE);
      }
    }
  });
});

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

      // Verify raw JSON preserves existing fields (not masked by loadSites merge)
      const raw = JSON.parse(readFileSync(SITES_FILE, "utf-8"));
      expect(raw["test-tier-site"].tier).toBe("chrome");
      expect(raw["test-tier-site"].url).toBe("https://example.com");
      expect(raw["test-tier-site"].waitFor).toBe("/dash");

      // Also verify via loadSites for the full roundtrip
      const sites = loadSites();
      expect(sites["test-tier-site"].tier).toBe("chrome");
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

  it("refuses to overwrite corrupted sites.json", () => {
    const backup = existsSync(SITES_FILE)
      ? readFileSync(SITES_FILE, "utf-8")
      : null;

    try {
      const original = {
        "my-app": { url: "https://my-app.com", waitFor: "/home" },
      };
      mkdirSync(join(homedir(), ".playwright-cli"), { recursive: true });
      writeFileSync(SITES_FILE, JSON.stringify(original, null, 2) + "\n");

      // Corrupt the file
      writeFileSync(SITES_FILE, "{ invalid json }}}");

      saveSiteTier("my-app", "chrome");

      // File should still be corrupted — saveSiteTier must not overwrite
      const raw = readFileSync(SITES_FILE, "utf-8");
      expect(raw).toBe("{ invalid json }}}");
    } finally {
      if (backup) {
        writeFileSync(SITES_FILE, backup);
      } else if (existsSync(SITES_FILE)) {
        unlinkSync(SITES_FILE);
      }
    }
  });
});
