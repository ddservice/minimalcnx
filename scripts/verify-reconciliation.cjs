// Run with PGLITE_MODULE_PATH pointing to an external PGlite installation.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');

async function main() {
  const db = new PGlite();
  const staff = randomUUID();
  const manager = randomUUID();
  try {
    await db.exec(`
      create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.profiles(id uuid primary key, role text, is_active boolean);
      create table public.sales_daily(date date primary key, recorded_by uuid,
        cash_amount numeric, kshop_amount numeric, lineman_before_gp numeric,
        shopee_before_gp numeric, grab_before_gp numeric);
      create function public.fn_page_cap(text,text) returns boolean language sql stable as $$
        select $1 = '/sales' or exists (
          select 1 from public.profiles where id = auth.uid() and role = 'manager'
        ) $$;
      create function public.fn_can_edit_sales_today() returns boolean language sql as $$ select false $$;
      create function public.fn_audit_log() returns trigger language plpgsql as $$ begin return null; end $$;
    `);
    const migration = readFileSync('sql/add_sales_reconciliation.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const value = async (sql, params) => (await db.query(sql, params)).rows[0].result;
    const date = await value("select ((now() at time zone 'Asia/Bangkok')::date)::text as result");
    await db.query("insert into profiles values ($1,'staff',true), ($2,'manager',true)", [staff, manager]);
    await db.query('insert into sales_daily values ($1,$2,100,200,25,0,0)', [date, staff]);
    const snapshot = await value('select fn_reconciliation_snapshot(s) as result from sales_daily s');
    const signIn = async (actor) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
      await db.exec('set role authenticated');
    };
    const command = (name, payload, request = randomUUID()) =>
      value('select reconciliation_command($1,$2::jsonb,$3) as result', [name, JSON.stringify(payload), request]);
    const closing = { date, version: 0, sales_snapshot: snapshot, printed_pos: 325,
      opening_float: 50, cash_count: 150, cash_in: 0, cash_out: 0 };
    await signIn(staff);
    await assert.rejects(command('close.save', { ...closing, cash_count: 149 }));
    const request = randomUUID();
    const saved = await command('close.save', closing, request);
    assert.equal(Number(saved.closing.cash_difference), 0);
    assert.deepEqual(await command('close.save', closing, request), saved);
    await assert.rejects(command('close.save', { ...closing, version: saved.version, note: 'retry' }));
    await assert.rejects(value('select platform_reconciliation_state($1) as result', [date]));

    await db.exec('reset role');
    await db.exec('update sales_daily set cash_amount = 110');
    await signIn(manager);
    assert.equal((await value('select sales_closing_state($1) as result', [date])).stale, true);
    const statement = { version: 0, platform: 'grab',
      period_from: date, period_to: date, reference: 'TEST-STATEMENT', gross: 100,
      commission: 10, fees: 0, discounts: 0, refunds: 0, withholding: 0, additions: 0, deductions: 0 };
    const created = await command('settlement.save', statement);
    const settlement = await command('settlement.save', { ...statement, ...created, note: 'Verified' });
    assert.equal(settlement.version, created.version + 1);
    const payment = await command('payment.add', { version: settlement.version,
      settlement_id: settlement.id, received_date: date, amount: 90, bank_reference: 'TEST-BANK' });
    assert.equal(payment.version, settlement.version + 1);
    await db.exec('reset role');
    assert.equal(await value('select sum(amount)::int as result from platform_receipts'), 90);
    console.log('PASS migration replay, closing, retry, role boundaries, stale closing, and platform receipt');
  } finally {
    await db.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
