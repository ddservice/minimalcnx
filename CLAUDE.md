# CLAUDE.md — minimalcnx coffee-shop system

Maintained by Claude. This file is the **short core** loaded every session. Detail, history and incident notes live in `docs/claude/*.md` — **read the matching file before touching that area** (table below). After every change: update the matching `docs/claude/` file (and this file only if a core rule changes), then commit → push → deploy.

## Project

- **One name everywhere:** `minimalcnx` (folder, npm package, Docker image/container, VPS path `~/apps/minimalcnx`, GitHub `ddservice/minimalcnx`, domain `minimalcnx.ddserviceth.com`; staging `minimal.ddserviceth.com` hits the same container). Only legacy string kept on purpose: auth email realm `@marim69.internal` — changing it breaks logins.
- **Stack:** Next.js 15 + React 19 + `@supabase/ssr`, plain JS, repo root is the app. Working copy: `Z:\independentz\Web\minimalcnx`, branch `main`. No second clone.
- **Backend:** Supabase project `vrmaquzhehbfqlfvrsxj` (Singapore). The old Sydney project was deleted 2026-10-01 — no rollback target; recovery is the R2 backup.
- Single shop for sales/expenses/OPEX/reports; multi-branch applies to loyalty only.

## Where the detail lives

| Read this | Before working on |
|---|---|
| `docs/claude/security.md` | RLS, roles/`lib/perms.js`, audit log, `business_config` writes, numeric/ID input sanitizing, passwords |
| `docs/claude/formulas.md` | GP rates, VAT, rent WHT, payroll/SSO, OPEX defaults — any money formula |
| `docs/claude/design-system.md` | CSS tokens, sidebar shell, `Kpi`, `DateField`, `DataTable`, iOS/viewport gotchas |
| `docs/claude/performance.md` | `requireSession()`, the two caches, icons, `/reports` client cache |
| `docs/claude/features.md` | What each page does and why; expenses/reports/dashboard/loyalty/audit history; optional-later list |
| `docs/claude/migrations.md` | Which `sql/*.sql` to run and in what order; cutover + loyalty ops checklists; which old `fix_*.sql` are repair utilities, not migrations |
| `docs/claude/backups-and-region-migration.md` | R2 backups, restore drill, moving Supabase projects |
| `docs/claude/project-and-deploy.md` | Deploy gotchas (ports, `.deploy.env`), repo/`.claude/` layout, working-copy rules |

Topic rules in `.claude/rules/` and staff guide `LOYALTY-USER-GUIDE.md` still apply.

## Rules that must never be broken

- **The security boundary is Supabase RLS + `SECURITY DEFINER` RPCs.** Server Action checks (`requireCap()`, `requireAdmin()`) and `lib/perms.js` are defense-in-depth. Never put `service_role` in client code or `NEXT_PUBLIC_*`.
- **Recompute money, payslips and points server-side.** Never trust client totals. One payroll formula: `lib/payslip.js` `computePayslip()`.
- **RLS `UPDATE` failures are silent (0 rows, no error).** Mutations must `.select()` and treat an empty result as a permission error. Every `business_config` write goes through `lib/config-store.js` `upsertBusinessConfig()`; reads through `readBusinessConfig()`.
- **Caching:** React `cache()` (per request) is fine for user-scoped data. The process-wide cache (`lib/config-cache.js`) may hold `business_config` only — never `sales_daily` / `expenses` / `customers` / `audit_log`.
- **`requireSession()` uses `getSession()`, not `getUser()`** — middleware already verified. Changing it back is a regression.
- **Inputs:** money/quantity/points → `components/number-input.js` (`NumberInput`), never `type="number"`. Dates/months → `components/date-field.js`. Person names → `stripDigits()`. ID/bank/tax numbers → `digitsOnly()`.
- **Styling:** tokens from `app/globals.css` only — no numeric `fontSize` or `borderRadius` in components. Icons via `<Icon name="ti-xxx" />`, no webfont/CDN.
- **User-entered business data is persisted server-side**, never localStorage-only.
- **Forms seeded from a date/month-scoped prop need `key={date}`**, or they keep the old date's values.
- **Loyalty:** earn needs linked `staff_profiles` + branch + receipt (one receipt = one earn per branch); redeem via `loyalty_redeem_reward` RPC; void via `loyalty_void_transaction` RPC, never delete. RFM segments are computed live (`lib/rfm.js` ↔ SQL `fn_rfm_segment` — change both).
- **Audit:** `/admin/audit` is Super Admin (`role = admin`) only. Never log passwords. IP/User-Agent are client-reported and spoofable; `session_id` / `actor_email` are the trustworthy fields.
- **Storage buckets:** `evidence` is public (free-cup proof). **`documents` is private and must stay private** — it holds ID-card copies and contracts; read via short-lived signed URLs from a Server Action, admin + co-admin only at both table and object level. Never put personal documents in `evidence`.
- **Backups stay `age`-encrypted** (dump holds phone numbers, national IDs, bank accounts). `pg_dump` uses the session pooler `:5432`, never `:6543`.
- **Schema changes:** add the SQL file to `docs/claude/migrations.md` and a column to `sql/check_migrations.sql`. Never edit `sql/supabase_migration.sql`, only annotate.
- Never commit `.env.local`, `.deploy.env`, `.backup.env`, `*.key`, `push_to_github.bat` or real passwords.

## Run / test / deploy

- Local: `npm install && npm run dev`
- **`npm test` first, then `npm run build`** — both must pass before commit. Tests are `node --test "tests/*.test.mjs"`, no test dependency; `.mjs` tests and `lib/` cross-imports need the `.js` extension. Add a case whenever a formula changes.
- Deploy (on the VPS): `cd ~/apps/minimalcnx && bash deploy.sh`. `.deploy.env` is required (no fallback) and `NEXT_PUBLIC_SUPABASE_*` is baked in at build — read the `==> Supabase: <url>` line. Container binds `127.0.0.1:3011`; leave 3001/3002/3005 alone; **never `systemctl restart docker`** on that VPS.
- The VPS clock is `Asia/Bangkok`; cron times are already Thai time.

## App map

- `app/` — `login`, `dashboard`, `sales`, `expenses`, `opex`, `reports`, `analytics`, `loyalty` (+ `history`, `analytics`), `admin` (+ `loyalty`, `audit`, `documents`), `settings`, `export`
- `components/` — `app-shell`, `sidebar`, `page-header`, `kpi`, `data-table`, `date-field`, `number-input`, `icon`
- `lib/` — `supabase/*`, `session`, `access`, `perms`, `audit`, `config-store`, `config-cache`, `format`, `gp`, `opex`, `payslip`, `wht`, `documents`, `dashboard`, `rfm`, `loyalty-rewards`
- `sql/` migrations · `scripts/` backup/restore/migrate · `deploy/` nginx + runbooks · `tests/` · `templates/` import xlsx
