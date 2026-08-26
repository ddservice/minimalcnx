# Security — minimalcnx

- Real boundary = Supabase **RLS + SECURITY DEFINER RPCs**. Server Action checks are defense-in-depth only.
- Never put `service_role` in client / `NEXT_PUBLIC_*`.
- Recompute money/payslip/loyalty points server-side — never trust client totals.
- `lib/perms.js` gates nav + page actions (view/create/edit). Enforce writes with `requireCap()` in Server Actions. RLS remains the real data boundary — the matrix cannot grant more than RLS.
- `/admin/audit` is Super Admin (`role = admin`) only. Requires `sql/add_audit_context.sql`. Do not log passwords in audit details.
- Loyalty writes: earn/redeem must go through app actions + RLS in `harden_loyalty_writes.sql`; void only via `loyalty_void_transaction` RPC.
- Staff cannot spoof another branch (only manager+ may pick branch).
- After schema changes, document required SQL in `CLAUDE.md` migrations list.
- **Caching: `cache()` (per-request) is safe for user-scoped data; a process-wide cache is NOT.** `lib/config-cache.js` may hold `business_config` only, because RLS returns those rows identically to every authenticated user. Never cache `sales_daily` / `expenses` / `customers` / `audit_log` across requests — that serves one user's rows to another. Invalidate via `upsertBusinessConfig()`, the single write choke point.
- Backups (`scripts/backup-to-r2.sh`) must stay `age`-encrypted — the dump holds customer phone numbers, employee national IDs and bank accounts. Key stored outside R2. `.backup.env` / `*.key` are gitignored.
- Never commit `.env.local` or real passwords. `sql/fix_imm_login.sql` must not ship a production default password.
