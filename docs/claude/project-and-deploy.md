# Project, working copy, deploy, repo layout (moved verbatim from CLAUDE.md 2026-10-12)

**Product name (one name everywhere):** `minimalcnx` — local folder, npm package, Docker image/container, VPS path `~/apps/minimalcnx`, GitHub `ddservice/minimalcnx`, prod domain `minimalcnx.ddserviceth.com`. The only intentional legacy string left is the auth email realm `@marim69.internal` (changing it would break existing logins).

## Two apps, one database

| | Legacy | New (active) |
|---|---|---|
| Code | Static HTML dashboard (rollback copy only on VPS at `/var/www/minimalcnx`; removed from this repo in 2026-08-02) | **This repo root** — Next.js 15 + React 19 + `@supabase/ssr` (package `minimalcnx`) |
| Status | superseded | **live in production** |
| Domain | — | `minimalcnx.ddserviceth.com` (prod) + `minimal.ddserviceth.com` (staging) — both proxy to the same Docker container |

**Shared backend:** Supabase project `vrmaquzhehbfqlfvrsxj` (AWS `ap-southeast-1`, Singapore — **live since 2026-09-09**; migrated from `fkhfrylvronkmktlmmia` in `ap-southeast-2` Sydney, which was kept as a rollback and **deleted on 2026-10-01** — there is no Sydney project to roll back to any more; recovery is the R2 backup. See "Moving Supabase projects / regions" below). Docs and examples no longer hardcode a project ref — `.env.local.example`, `DEPLOY-SUBDOMAIN.md` and `deploy/BACKUP.md` use `<project-ref>` placeholders so a future move can't leave a stale ref pointing people at a dead database. **`deploy.sh` has no fallback either: `.deploy.env` is required and a missing one aborts the deploy with instructions.** It used to fall back to Sydney so that deleting the file was a rollback; after cutover that inverted into a trap — a lost `.deploy.env` would deploy "successfully" against the abandoned database with nothing on screen to say so. Never delete `.deploy.env`; to point the app at a different project, *edit* it and redeploy. Core tables (`sales_daily`, `expenses`, `profiles`, `business_config`) and RPCs (`upsert_sales_daily`, `upsert_opex_item`, `get_monthly_summary`, `admin_*`) plus Loyalty/CDP tables from `sql/add_loyalty_system.sql` (`branches`, `staff_profiles`, `customers`, `point_transactions`, `redemption_history`, `loyalty_audit_logs`). SQL lives in `sql/*.sql`.


## Canonical working copy (portable)

**Source of truth on disk for this team:** `Z:\independentz\Web\minimalcnx`  
(Git remote: `https://github.com/ddservice/minimalcnx.git` → branch `main`)

- Open Cursor / Claude from **that path** on every machine that has the `Z:` drive (or the same independentz sync). Do not use the old generic folder name `files`.
- Do **not** keep a second divergent clone (e.g. under `Downloads\files`) — either work only on `Z:\…\minimalcnx`, or make any shortcut path a **junction** to `Z:\independentz\Web\minimalcnx`.
  - **Exception since 2026-10-13: `Z:\independentz\Web\mamasaidno`** is a deliberate second working copy of this same repo (same `origin`, same `main`) used for the second shop's work, so its chats and `CLAUDE.local.md` do not mix with Minimal's. The rule above exists to stop two copies of the code drifting apart; that still holds — it is one codebase, pulled before every session and pushed after, never a fork or a renamed repo. A change made from either folder ships to **both** shops on their next deploy.
- Before coding on a new machine: `git pull --ff-only origin main` then `npm install` if `package-lock.json` changed.
- After every change: update **`CLAUDE.md`**, then **commit → push → deploy** (VPS). Prefer small, stable diffs; no drive-by refactors.

**(2026-08-15)** Product name unified to `minimalcnx` (GitHub renamed `minimal-cnx` → `minimalcnx`; sample nginx `deploy/nginx-minimalcnx.conf`). Local folder must be `Z:\independentz\Web\minimalcnx` — if this machine still has `Web\files`, close Cursor and `Rename-Item Z:\independentz\Web\files minimalcnx`, then reopen from the new path.

## Run / build / deploy

- Local (from repo root): `npm install && npm run dev`
- **Test: `npm test`** — `node --test "tests/*.test.mjs"`, Node's built-in runner, **no test dependency in `package.json`** (keep it that way). Covers the pure money/domain functions where a wrong number is silent and expensive: `computePayslip()`, `gpNet()`/`computeNetRevenue()`, `computeEffectiveOpex()`, `sanitizeNumberString()`/`groupNumberString()`, `computeRfmSegment()`, `suggestPointsFromSpend()`, `summarizeMonth()`/`cutoffDay()`/`missingSalesDays()`/`pctChange()` (dashboard). Run it **before** `npm run build`; add a case whenever a formula changes. Test files are `.mjs` and must import lib modules **with the `.js` extension** — Node's ESM resolver has no extensionless resolution, so a `lib/` module that imports another `lib/` module needs the extension too (`./payslip.js`), otherwise the test can't load it. Bundlers accept the explicit extension, so this costs nothing.
- Build check: `npm run build` (standalone output; Docker uses it)
- **Deploy to VPS (one line, run ON the VPS):** `cd ~/apps/minimalcnx && bash deploy.sh`
  - **Which Supabase it builds against comes from `.deploy.env`** (gitignored, next to `deploy.sh`); the file is required and a missing one aborts the deploy — see the region-migration section above. `deploy.sh` echoes `==> Supabase: <url>` before building; read it.
  - Repo was flattened to root on 2026-08-02 (`218dba5`) — there is no longer a nested `marim69-next/` app folder. VPS clone should be the repo root at `~/apps/minimalcnx`.
  - VPS authenticates to GitHub via a **read-only deploy key** (not a token). Docker image/container are named `minimalcnx` (renamed 2026-07-29 from `marim69-beta`). Container binds **`127.0.0.1:3011`** (nginx `minimal.conf` / `minimalcnx.conf`). **Do not bind 3001** — that is MikroTik (`node` on the host). Also leave **3002** (cnxhaircutz / `next-server` on host) and **3005** (apexlink-forensics Docker) alone. **Never `systemctl restart docker`** on this VPS — it would bounce unrelated containers. Cutover + rollback details in `CUTOVER.md` (written before the rename — mentally substitute `minimalcnx` wherever it says `marim69-beta`; the port note in that file is already corrected to **3011**).
  - **⚠️ Gotcha (2026-08-14):** `deploy.sh` does `git pull` then `docker run`. Bash keeps the *already-running* script in memory, so the first deploy after changing `HOST_PORT` still used the old **3001** mapping and collided with MikroTik even though the file on disk said 3011. Image build had succeeded. Fix: `docker rm -f minimalcnx` then `docker run -d --name minimalcnx --restart unless-stopped -p 127.0.0.1:3011:3000 minimalcnx:latest`. Later deploys are fine because the on-disk script is already 3011. Health check in `deploy.sh` now loops for up to 30s until Next.js returns 200.
  - **⚠️ Gotcha (2026-08-18): Cloudflare 502 Bad Gateway on first access.** Occurs right after deploy/container restart while Next.js is cold-booting, or when Nginx idle keep-alive connections drop. Fixed by adding `proxy_next_upstream error timeout invalid_header http_502 http_503;` and proxy timeouts to `deploy/nginx-minimalcnx.conf` so Nginx retries automatically instead of returning 502 to Cloudflare.


## App structure (repo root)

- `app/` — `login`, `dashboard`, `sales`, `expenses`, `opex`, `loyalty` (+ `loyalty/analytics`), `reports`, `analytics`, `admin` (+ `admin/loyalty`, `admin/audit`), `settings`, `export` (xlsx Route Handler)
- `components/` — `app-shell`, `sidebar`, `sign-out-button`, `page-header`, `data-table`, `kpi`, `date-field`, `number-input`
- `lib/` — `supabase/{client,server,middleware}`, `session`, `access`, `audit`, `request-meta`, `format`, `gp`, `opex`, `expense-categories`, `suppliers` (curated supplier→item catalog), `config-store`, `perms`, `payslip`, `loyalty-rewards`, …
- `sql/` — all Supabase SQL schema & migrations
- `templates/` — `.xlsx` templates for Excel import
- `deploy/` — nginx sample config
- `CLAUDE.md` — loaded every session: architecture / security / formulas (override locally via `CLAUDE.local.md`, gitignored)
- `LOYALTY-USER-GUIDE.md` — staff/manager loyalty how-to + LINE-QR comparison
- `.mcp.json` — shared MCP server stubs (team-safe; no secrets)
- `.claude/` — Claude Code project config (see below)
- Design: see "Design system" below.

## Claude Code layout (`.claude/`)

Matches the standard Claude Code project structure:

| Path | Role |
|---|---|
| `CLAUDE.md` | Primary project brief (this file) |
| `CLAUDE.local.md` | Local-only notes — copy from `CLAUDE.local.md.example`, **do not commit** |
| `.mcp.json` | MCP connection stubs (GitHub/Jira/etc. when needed) |
| `.claude/settings.json` | Shared permissions / allow-deny for tools |
| `.claude/settings.local.json` | Local permission overrides (gitignored) |
| `.claude/rules/` | Topic rules (`code-style.md`, `testing.md`, `api-conventions.md`, `security.md`, `loyalty.md`) |
| `.claude/commands/` | Slash commands (`review`, `fix-issue`, `deploy`) |
| `.claude/skills/` | On-demand skills (e.g. `deploy/SKILL.md`) |
| `.claude/agents/` | Specialized reviewers (`code-reviewer`, `security-auditor`) |
| `.claude/hooks/validate-bash.sh` | Optional PreToolUse script (force-push / hard-reset / pipe-to-shell). Wire via `settings.local.json` — see `.claude/settings.local.json.example` (not enabled in shared `settings.json` so Cursor shell is unaffected) |

## Multiple shops from one repo (2026-10-12)

**One codebase, one install per shop, one Supabase project per shop.** Chosen over multi-tenancy because the second shop (`mamasaidno`) is a different legal entity: separate tax ID, payroll, certificates and documents are required anyway, and separate databases mean no RLS rule has to keep two companies' rows apart. Runbook: **`deploy/NEW-INSTANCE.md`** (written from the code, not yet executed end to end).

- **`lib/brand.js`** — `APP_NAME` / `APP_SLUG` from `NEXT_PUBLIC_APP_NAME` / `NEXT_PUBLIC_APP_SLUG`, baked in at `docker build` exactly like the Supabase URL. Unset = the original shop, byte-for-byte the old behaviour. Never hardcode the shop name in a component again — import `APP_NAME`.
- **`IS_ORIGINAL_SHOP`** gates every number that belongs to Minimal Maerim only: the `def` values in `OPEX_OPERATING` / `OPEX_STAFF`, `DEFAULT_EMPLOYEES`, and the fallbacks inside `computeEffectiveOpex()` (third argument `builtin`). **Without this gate a new shop's reports would show ~70,000 baht/month of expenses that never happened** (director salary, rent, two default employees) for every month with no saved OPEX rows. A new shop starts empty and sets its own values in `/settings` -> `opex_defaults`. Pinned by `tests/opex.test.mjs`.
- **`deploy.sh`** reads `APP_SLUG` (container + image name), `APP_NAME`, `HOST_PORT` from `.deploy.env`. A non-original instance must set `HOST_PORT` and may not use 3011; the script prints `==> Instance: <slug>` next to `==> Supabase: <url>`. Each shop is its own clone under `~/apps/<slug>` with its own `.deploy.env` / `.backup.env`.
- **Backups:** `R2_PREFIX` separates shops inside the same R2 bucket and is now also the label on failure alerts and the default local backup folder. Forgetting to change it for a new shop mixes two companies' dumps under one prefix.
- **Still Minimal-specific in code** (a different kind of business needs these made configurable first): `lib/suppliers.js`, `lib/bakery.js`, `lib/gp.js` + the sales channels, `lib/expense-categories.js`, the OPEX item list, icons and colours. The auth realm `@marim69.internal` is shared by design — it is only an internal suffix and each shop has its own Auth database.
- A new SQL file must be run in **every** shop's Supabase project; `deploy.sh` must be run once per shop.
