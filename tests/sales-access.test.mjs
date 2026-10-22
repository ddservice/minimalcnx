import test from 'node:test';
import assert from 'node:assert/strict';
import { bangkokToday, salesDateError, validBusinessDate } from '../lib/sales-policy.js';
import { homePathForRole, salesOnlyStaffPerms, canAccess } from '../lib/perms.js';

test('Thai day switches at 17:00 UTC including year boundary', () => {
  assert.equal(bangkokToday(new Date('2026-12-31T16:59:59Z')), '2026-12-31');
  assert.equal(bangkokToday(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
});
test('staff date is today only, managers can correct prior days', () => {
  const now = new Date('2026-10-22T18:00:00Z');
  assert.equal(salesDateError('staff','2026-10-23',now),null);
  assert.ok(salesDateError('staff','2026-10-22',now));
  assert.ok(salesDateError('staff','2026-10-24',now));
  assert.equal(salesDateError('manager','2026-10-22',now),null);
  assert.equal(validBusinessDate('2026-02-30'),false);
  assert.equal(validBusinessDate('2028-02-29'),true);
});
test('sales-only preset reaches sales; all denied reaches no-access without loop', () => {
  const perms = salesOnlyStaffPerms({ manager: { '/sales':'edit' } });
  assert.equal(homePathForRole('staff',perms),'/sales');
  assert.equal(canAccess('staff','/reports','view',perms),false);
  assert.equal(canAccess('staff','/sales','create',perms),true);
  assert.equal(canAccess('staff','/sales','edit',perms),false);
  assert.equal(perms.manager['/sales'],'edit');
  assert.equal(homePathForRole('staff',{staff:{...perms.staff,'/sales':'none'}}),'/no-access');
  assert.equal(homePathForRole('admin',perms),'/dashboard');
  assert.equal(homePathForRole('loyalty_staff',perms),'/loyalty');
});


test('same-day edit requires the individual grant AND sales create access', async () => {
  const { canEditExistingSales } = await import('../lib/sales-policy.js');
  assert.equal(canEditExistingSales('staff', { create: true, edit: true }, false), false);
  assert.equal(canEditExistingSales('staff', { create: true, edit: false }, true), true);
  assert.equal(canEditExistingSales('staff', { create: false, edit: true }, true), false);
  assert.equal(canEditExistingSales('staff', { create: true }, null), false);
  assert.equal(canEditExistingSales('manager', { create: true, edit: true }, false), true);
  assert.equal(canEditExistingSales('manager', { create: true, edit: false }, true), false);
});
