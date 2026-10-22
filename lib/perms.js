// สิทธิ์ต่อหน้าแบบระดับ (ไม่ใช่แค่ซ่อนเมนู)
// none < view < create < edit — ระดับสูงรวมระดับล่างเสมอ
// ด่านข้อมูลจริงยังเป็น RLS; ค่าในนี้จำกัด UI + Server Action เพิ่ม ไม่ได้ขยายเกิน RLS

export const NAV_TABS = [
  { href: '/dashboard', label: 'ภาพรวม', icon: 'ti-layout-dashboard' },
  { href: '/sales', label: 'ยอดขาย', icon: 'ti-cash' },
  { href: '/expenses', label: 'รายจ่าย', icon: 'ti-receipt' },
  { href: '/opex', label: 'ค่าดำเนินการ', icon: 'ti-building-store' },
  { href: '/loyalty', label: 'สะสมแต้ม', icon: 'ti-gift' },
  { href: '/reports', label: 'สรุป', icon: 'ti-chart-bar' },
  { href: '/analytics', label: 'วิเคราะห์', icon: 'ti-chart-line' },
  { href: '/settings', label: 'ตั้งค่า', icon: 'ti-settings' },
];

export const MANAGED_ROLES = [
  { value: 'co-admin', label: 'Co-Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'staff', label: 'Staff' },
  { value: 'loyalty_staff', label: 'Loyalty only' },
];

export const ACCESS_LEVELS = ['none', 'view', 'create', 'edit'];
export const ACCESS_RANK = { none: 0, view: 1, create: 2, edit: 3 };
export const ACCESS_LABEL = {
  none: 'ซ่อน',
  view: 'ดูอย่างเดียว',
  create: 'กรอกอย่างเดียว',
  edit: 'แก้ได้',
};
export const ACCESS_HINT = {
  none: 'ไม่เห็นเมนูนี้',
  view: 'เปิดดูได้ แต่บันทึก / แก้ไข / ลบไม่ได้',
  create: 'เพิ่มรายการใหม่ได้ แต่แก้หรือลบของเดิมไม่ได้',
  edit: 'กรอกของใหม่ และแก้ไข/ลบของเดิมได้ (ในขอบเขตที่ RLS อนุญาต)',
};

// หน้าอ่านอย่างเดียวไม่มีกรอก/แก้ไข — settings ไม่มี "กรอก" (ไม่มีรายการใหม่)
export const PAGE_LEVELS = {
  '/dashboard': ['none', 'view'],
  '/sales': ['none', 'view', 'create', 'edit'],
  '/expenses': ['none', 'view', 'create', 'edit'],
  '/opex': ['none', 'view', 'create', 'edit'],
  '/loyalty': ['none', 'view', 'create', 'edit'],
  '/reports': ['none', 'view'],
  '/analytics': ['none', 'view'],
  '/settings': ['none', 'view', 'edit'],
};

export function isLoyaltyOnlyRole(role) {
  return role === 'loyalty_staff';
}

export function homePathForRole(role, perms) {
  const preferred = isLoyaltyOnlyRole(role) ? '/loyalty' : '/dashboard';
  return canAccess(role, preferred, 'view', perms)
    ? preferred : allowedHrefs(role, perms)[0] || '/no-access';
}

export function salesOnlyStaffPerms(perms = {}) {
  return { ...perms, staff: Object.fromEntries(NAV_TABS.map(({ href }) =>
    [href, href === '/sales' ? 'create' : 'none'])) };
}

export function isLoyaltyStaffPath(pathname) {
  const p = pathname || '';
  return p === '/loyalty' || p.startsWith('/loyalty/');
}

export function maxLevelFor(href) {
  const lvls = PAGE_LEVELS[href] || ['none', 'view'];
  return lvls[lvls.length - 1];
}

export function clampLevel(href, level) {
  const lvls = PAGE_LEVELS[href] || ['none', 'view'];
  if (lvls.includes(level)) return level;
  const rank = ACCESS_RANK[level] || 0;
  let best = 'none';
  lvls.forEach((l) => {
    if (ACCESS_RANK[l] <= rank && ACCESS_RANK[l] > ACCESS_RANK[best]) best = l;
  });
  return best;
}

/** ค่าเริ่มต้นเมื่อยังไม่เคยบันทึก role_perms — staff กรอก, ผู้จัดการขึ้นไปแก้ไข */
export function defaultLevel(role, href) {
  if (role === 'admin') return maxLevelFor(href);
  if (isLoyaltyOnlyRole(role)) return href === '/loyalty' ? 'create' : 'none';
  const max = maxLevelFor(href);
  if (max === 'view') return 'view';
  if (role === 'staff') {
    if ((PAGE_LEVELS[href] || []).includes('create')) return 'create';
    return 'view';
  }
  return max;
}

function storedRaw(perms, role, href) {
  const rp = perms?.[role];
  if (!rp || !Object.prototype.hasOwnProperty.call(rp, href)) return undefined;
  return rp[href];
}

export function parseStoredLevel(raw, href, role) {
  if (role === 'admin') return maxLevelFor(href);
  if (isLoyaltyOnlyRole(role) && href !== '/loyalty') return 'none';
  if (raw === undefined) return defaultLevel(role, href);
  if (raw === false) return 'none';
  // ของเก่า true = เห็นเมนู — staff ได้แค่กรอก (ตรงกับ RLS: insert ได้ update ไม่ได้)
  if (raw === true) {
    if (role === 'staff' && (PAGE_LEVELS[href] || []).includes('create')) return 'create';
    return maxLevelFor(href);
  }
  if (typeof raw === 'string' && ACCESS_RANK[raw] != null) return clampLevel(href, raw);
  return defaultLevel(role, href);
}

export function pageLevel(role, href, perms) {
  return parseStoredLevel(storedRaw(perms, role, href), href, role);
}

export function canAccess(role, href, action, perms) {
  const level = pageLevel(role, href, perms);
  const need = action === 'edit' ? 'edit' : action === 'create' ? 'create' : 'view';
  return ACCESS_RANK[level] >= ACCESS_RANK[need];
}

export function capsFor(href, role, perms) {
  const level = pageLevel(role, href, perms);
  return {
    level,
    view: ACCESS_RANK[level] >= 1,
    create: ACCESS_RANK[level] >= 2,
    edit: ACCESS_RANK[level] >= 3,
  };
}

export function capsForRole(role, perms) {
  const caps = {};
  NAV_TABS.forEach((t) => { caps[t.href] = capsFor(t.href, role, perms); });
  return caps;
}

export function allowedHrefs(role, perms) {
  if (role === 'admin') return NAV_TABS.map((t) => t.href);
  return NAV_TABS.filter((t) => pageLevel(role, t.href, perms) !== 'none').map((t) => t.href);
}

/** ลบรายการ — ต้องมีสิทธิ์แก้ไขหน้า และผ่านเพดาน RLS เดิม */
export function canDeleteOnPage(role, href, perms) {
  if (!canAccess(role, href, 'edit', perms)) return false;
  if (href === '/sales') return role === 'admin';
  if (href === '/expenses') return role === 'admin' || role === 'co-admin' || role === 'manager';
  return true;
}

export function normalizeRolePerms(input) {
  const out = {};
  MANAGED_ROLES.forEach((r) => {
    out[r.value] = {};
    NAV_TABS.forEach((t) => {
      out[r.value][t.href] = parseStoredLevel(storedRaw(input, r.value, t.href), t.href, r.value);
    });
  });
  return out;
}

export function recommendedPerms() {
  const out = {};
  MANAGED_ROLES.forEach((r) => {
    out[r.value] = {};
    NAV_TABS.forEach((t) => { out[r.value][t.href] = defaultLevel(r.value, t.href); });
  });
  return out;
}

export function denyMessage(action) {
  if (action === 'edit') return 'ไม่มีสิทธิ์แก้ไขหน้านี้ — ติดต่อ Admin';
  if (action === 'create') return 'ไม่มีสิทธิ์กรอกข้อมูลหน้านี้ — ติดต่อ Admin';
  return 'ไม่มีสิทธิ์เข้าถึงหน้านี้';
}
