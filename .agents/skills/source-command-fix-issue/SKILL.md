---
name: "source-command-fix-issue"
description: "Migrated source command `fix-issue`"
---

# source-command-fix-issue

Use this skill when the user asks to run the migrated source command `fix-issue`.

## Command Template

Diagnose and fix the reported issue.

1. Reproduce or identify the failing path
2. Find root cause in code/SQL (cite paths)
3. Implement the smallest correct fix
4. Update `AGENTS.md` if behavior/migrations changed
5. Run `npm run build` when the change touches app code
6. Summarize what changed and any SQL the user must run on Supabase

Do not commit unless the user asks.
