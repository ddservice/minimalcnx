# Testing — minimalcnx

- **`npm test` first, then `npm run build`.** Both must pass before commit.
- `npm test` = `node --test "tests/*.test.mjs"` — Node's built-in runner, **no Jest/Vitest/dependency**. Keep it that way.
- What `tests/` covers: the pure money/domain functions where a wrong number is silent and expensive — `computePayslip()`, `gpNet()`/`computeNetRevenue()`, `computeEffectiveOpex()`, `sanitizeNumberString()`/`groupNumberString()`, `computeRfmSegment()`, `suggestPointsFromSpend()`. Add a case here whenever you touch a formula.
- Test files are `.mjs` and import lib modules **with the `.js` extension** (`../lib/payslip.js`) — Node's ESM resolver has no extensionless resolution. If a `lib/` module imports another `lib/` module, that import needs the extension too, or the test can't load it (bundlers accept the explicit extension fine).
- Do not test React components or Server Actions here — they need a DB/session. Those stay manual smoke tests.
- After loyalty SQL changes: manually smoke earn → redeem → void on `/loyalty` + `/loyalty/history`, and re-issue the **same receipt number** once to confirm it is rejected.
- After analytics RPC: open `/analytics` with a multi-month range; confirm income/expense/profit still match `/reports` for one month.
