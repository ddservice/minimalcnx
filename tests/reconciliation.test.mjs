import test from 'node:test';
import assert from 'node:assert/strict';
import { money, closingTotals, statementNet, settlementStatus, validateReconciliation, salesSnapshot } from '../lib/reconciliation.js';
import { readClosing, readSettlements } from '../lib/reconciliation-store.js';

const id='00000000-0000-4000-8000-000000000001';
const today='2026-11-20';
const sales={ cash_amount:1000.15,kshop_amount:2000.20,lineman_before_gp:300.30,grab_before_gp:55.55,shopee_before_gp:33.33 };
const close={ date:today,version:0,sales_snapshot:sales,printed_pos:3300.65,opening_float:500,cash_count:1480.15,cash_in:30,cash_out:50,note:'drawer float correction' };
const statement={ platform:'grab',version:0,period_from:'2026-11-01',period_to:today,reference:'GR-001',gross:1000.10,
  commission:300.03,fees:5.01,discounts:20.02,refunds:10.03,withholding:3,additions:15.04,deductions:2.05 };

test('closing reconciles counted cash with float and separate cash movements in whole satang',()=>{
  assert.deepEqual(closingTotals(sales,close),{ expected_pos:3300.65,expected_cash:1480.15,pos_difference:0,cash_difference:0 });
  assert.equal(closingTotals(sales,{ ...close,cash_count:1479.90 }).cash_difference,-.25);
  assert.equal(closingTotals(sales,{ ...close,printed_pos:3301 }).pos_difference,.35);
});
test('money rejects blank, nonfinite, exponent, negative, excessive precision and oversized amounts',()=>{
  for(const v of ['',null,undefined,'NaN',Infinity,-1,'1e3','0x12','1,000','1.001','1000000000']) assert.throws(()=>money(v,'amount'));
  assert.equal(money('0','amount'),0); assert.equal(money('999999999.99','amount'),999999999.99);
  assert.equal(money('','optional',true),0);
});
test('closing keeps actual zero distinct from uncounted and requires explanations',()=>{
  assert.throws(()=>validateReconciliation('close.save',{ ...close,cash_count:'' },today));
  assert.throws(()=>validateReconciliation('close.save',{ ...close,note:'' },today));
  assert.throws(()=>validateReconciliation('close.save',{ ...close,cash_out:2000 },today));
  const p=validateReconciliation('close.save',{ ...close,cash_count:0,note:'count shortage' },today);
  assert.equal(p.cash_count,0); assert.deepEqual(p.sales_snapshot,salesSnapshot(sales));
  assert.throws(()=>validateReconciliation('close.save',{ ...close,date:'2026-02-30' },today));
  assert.throws(()=>validateReconciliation('close.save',{ ...close,version:-1 },today));
});
test('statement uses actual deductions once, no automatic GP or tax, retains satang',()=>{
  assert.equal(statementNet(statement),675);
  const p=validateReconciliation('settlement.save',statement,today);
  assert.equal(p.gross,1000.1); assert.equal(p.due_date,null);
  assert.equal(statementNet({ gross:1000,commission:321 }),679);
  assert.throws(()=>validateReconciliation('settlement.save',{ ...statement,deductions:9999 },today));
  assert.throws(()=>validateReconciliation('settlement.save',{ ...statement,version:1 },today));
});
test('statement validates platform, real dates, bounded completed period and required reference',()=>{
  for(const p of [{ platform:'unknown' },{ platform:'__proto__' },{ period_from:'2026-11-21' },{ period_to:'2026-11-21' },
    { period_from:'2025-01-01' },{ period_to:'2026-02-30' },{ reference:' ' },{ due_date:'2026-11-31' }]) {
    assert.throws(()=>validateReconciliation('settlement.save',{ ...statement,...p },today));
  }
});
test('payment requires positive actual receipt, bank reference and real nonfuture date',()=>{
  const receipt={ settlement_id:id,version:2,amount:250.50,received_date:today,bank_reference:'BANK-01' };
  assert.equal(validateReconciliation('payment.add',receipt,today).amount,250.5);
  for(const p of [{ amount:0 },{ amount:'1.000' },{ bank_reference:' ' },{ received_date:'2026-11-21' },{ settlement_id:'bad' }])
    assert.throws(()=>validateReconciliation('payment.add',{ ...receipt,...p },today));
  assert.throws(()=>validateReconciliation('payment.void',{ id,version:2,reason:'' },today));
  assert.equal(validateReconciliation('payment.void',{ id,version:2,reason:'duplicate entry' },today).reason,'duplicate entry');
});
test('settlement status separates waiting, partial, overdue, overpaid, incomplete sales and voids',()=>{
  const row={ expected_net:675,received_total:0,sales_difference:0,missing_days:0 };
  assert.equal(settlementStatus(row,today).label,'รอรับเงิน');
  assert.equal(settlementStatus({ ...row,received_total:300 },today).label,'รับบางส่วน');
  assert.equal(settlementStatus({ ...row,due_date:'2026-11-19' },today).label,'เลยกำหนดรับเงิน');
  assert.equal(settlementStatus({ ...row,received_total:676 },today).label,'รับเกินใบสรุป');
  assert.equal(settlementStatus({ ...row,received_total:675 },today).label,'ตรงกันครบ');
  assert.equal(settlementStatus({ ...row,received_total:675,missing_days:1 },today).label,'เงินครบ · ตรวจยอดขายต่อ');
  assert.equal(settlementStatus({ ...row,received_total:675,sales_difference:.01 },today).label,'เงินครบ · ตรวจยอดขายต่อ');
  assert.equal(settlementStatus({ ...row,voided_at:today },today).label,'ยกเลิก');
});
test('unapplied migrations remain unavailable, never pretend an empty successful closing',async()=>{
  const missing={ rpc:async()=>({ error:{ code:'PGRST202' } }) };
  assert.deepEqual(await readClosing(missing,today),{ ready:false });
  assert.deepEqual(await readSettlements(missing,'2026-11'),{ ready:false,rows:[] });
  const failed={ rpc:async()=>({ error:{ code:'42501' } }) };
  assert.ok((await readClosing(failed,today)).error);
  const ok={ rpc:async()=>({ data:{ closing:{ id },stale:true } }) };
  assert.equal((await readClosing(ok,today)).stale,true);
});
