# Domain formulas (moved verbatim from CLAUDE.md 2026-10-12)

## Domain formulas (keep identical to legacy)

- Delivery GP rates: shopee 0.3424, grab/lineman 0.321. `net = raw × (1 − rate)`. (`lib/gp.js`)
- `sales_daily.net_revenue` = kshop + cash + delivery(after GP). Pastry & free-cup cost stored separately.
- Expense VAT 7%: `total = price × 1.07 × qty` when VAT on (baked into `total_amount`, not stored separately).
- OPEX rent WHT: pay owner 95%, withhold 5% (remit to Revenue Dept). Stored amount = full rent.
- OPEX VAT-auto suggestion = month net sales × 7%.
- Payroll (`payslip()` in `app/opex/opex-form.js`): SSO 5% of min(salary,15000) for employee AND company; commission = income × rate; commission tax 3%; gross = salary+position+commission+diligence; net transfer = salary−ssoEmp+position+diligence+(comm−commTax); **saved OPEX amount = companyCost = gross + companySSO**. **(2026-07-20) The per-employee OPEX amount is no longer a manually-typed field** — it used to require opening "คำนวณเงินเดือน" and clicking a separate "ใช้ยอดนี้" button to copy `companyCost` in, which was easy to forget (an employee's cost could silently stay at a stale/₿0 figure for a whole month). It's now computed live from `payslip(e, income).companyCost` on every render and at submit time — there is no independent `amount` state for employees anymore, so editing salary/position/commission/diligence updates the displayed and saved OPEX figure immediately with no extra step.
- **⚠️ Fixed 2026-08-25 — `computeEffectiveOpex()` had its own copy of the employee cost and it disagreed with the payslip.** The auto-filled default for emp1 was hardcoded `13000 + 1500 + 725`, i.e. SSO taken as 5% of 14,500 (salary + position), while `computePayslip()` correctly uses 5% of `min(salary, 15000)` = 13,000 → 650. emp2 happened to be right. Net effect: every month with no OPEX rows saved yet reported **75 ฿ more expense than `/opex` would actually save**, on `/dashboard`, `/reports` and `/analytics`. It now calls `computePayslip(...).companyCost`, so there is exactly one payroll formula in the codebase. `tests/opex.test.mjs` pins both employees' expected cost against the payslip, so the two can't drift again.
- Employee defaults (`DEFAULT_EMPLOYEES`, `lib/opex.js`): emp1 13000/1500, emp2 12000/0; salary_dir default 36000. Payslip inputs persist in `localStorage` (`mm69_emp_slip`).


