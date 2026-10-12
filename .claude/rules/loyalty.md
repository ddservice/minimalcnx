---
paths:
  - "app/loyalty/**"
  - "app/admin/loyalty/**"
  - "lib/loyalty*.js"
  - "lib/rfm.js"
  - "sql/*loyalty*.sql"
---

# Loyalty / สะสมแต้ม

- Staff guide: `LOYALTY-USER-GUIDE.md`
- Routes: `/loyalty`, `/loyalty/history`, `/loyalty/analytics`, `/admin/loyalty`
- Catalog: table `loyalty_rewards` (admin at `/admin/loyalty`); fallback seed in `lib/loyalty-rewards.js`
- Required SQL (order): `add_loyalty_system.sql` → `harden_loyalty_rls.sql` → `harden_loyalty_writes.sql` → `add_loyalty_indexes.sql` → `harden_loyalty_reads.sql` → `add_loyalty_rewards.sql`
- Business analytics speed (optional): `add_analytics_range_kpis.sql` → RPC `get_months_kpis`
- Earn requires: linked `staff_profiles`, branch, receipt, points 1–100
- Multi-branch applies to loyalty only — sales/expenses/OPEX remain single-shop
