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
