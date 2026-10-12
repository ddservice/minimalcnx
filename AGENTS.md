# AGENTS.md — minimalcnx coffee-shop system

This file is intentionally short. **`CLAUDE.md` is the single source of truth** for project rules — read it first; it applies to every agent, not only Claude.

- Core rules, commands and the app map: `CLAUDE.md`
- Detail by topic (security, formulas, design system, performance, features, migrations, backups, deploy): `docs/claude/*.md` — read the matching file before touching that area
- Topic rules: `.claude/rules/*.md`
- Staff guide: `LOYALTY-USER-GUIDE.md`

After every change: update the matching `docs/claude/` file, run `npm test` then `npm run build`, then commit → push → deploy. Do not copy `CLAUDE.md` content back into this file — a second copy drifted once already (it still described the deleted Sydney database as a rollback target).
