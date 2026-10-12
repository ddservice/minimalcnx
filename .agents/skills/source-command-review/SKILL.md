---
name: "source-command-review"
description: "Migrated source command `review`"
---

# source-command-review

Use this skill when the user asks to run the migrated source command `review`.

## Command Template

Review the current uncommitted changes (or the latest commit if clean) for:

1. Spec match — does it solve the intended problem?
2. Security — RLS, Server Actions, client trust, secrets
3. Performance — unbounded queries, N+1, heavy client bundles
4. Design tokens — no hardcoded colors/radius

Return findings as a short checklist with file paths. Do not commit.
