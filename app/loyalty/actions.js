'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '../../lib/supabase/server';
import { getRewardFromDb } from '../../lib/loyalty-rewards';
import { PRIVACY_CONSENT_VERSION } from '../../lib/privacy';
import { requireCap } from '../../lib/access';
import { customerSegment } from '../../lib/rfm';

const ANALYTICS_ROLES = new Set(['admin', 'co-admin', 'manager']);
const VOID_ROLES = new Set(['admin', 'co-admin', 'manager']);

function revalidateLoyalty() {
  revalidatePath('/loyalty');
  revalidatePath('/loyalty/analytics');
  revalidatePath('/loyalty/history');
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, nickname')
    .eq('id', user.id)
    .maybeSingle();
  return { supabase, user, profile };
}

/** บังคับมี staff_profiles — staff ใช้ได้แค่สาขาที่ผูก; manager+ เลือกสาขาอื่นที่เปิดใช้ได้ */
async function resolveStaffContext(supabase, userId, branchId, role) {
  const { data: staffProfile } = await supabase
    .from('staff_profiles')
    .select('id, branch_id, staff_code, branches(id, code, name)')
    .eq('user_id', userId)
    .maybeSingle();

  if (!staffProfile) {
    return {
      ok: false,
      message: 'บัญชียังไม่ได้ผูกกับสาขา — ให้ Admin ตั้งค่าที่ /admin/loyalty ก่อนใช้งาน',
    };
  }

  const canPickBranch = role === 'admin' || role === 'co-admin' || role === 'manager';
  // staff บังคับสาขาที่ผูก — กัน spoof สาขาอื่นผ่าน client
  const targetBranch = canPickBranch
    ? (branchId || staffProfile.branch_id)
    : staffProfile.branch_id;

  if (!targetBranch) {
    return { ok: false, message: 'กรุณาเลือกสาขาที่ทำรายการ' };
  }

  const { data: branch } = await supabase
    .from('branches')
    .select('id, code, name, is_active')
    .eq('id', targetBranch)
    .maybeSingle();

  if (!branch || branch.is_active === false) {
    return { ok: false, message: 'สาขาที่เลือกไม่พร้อมใช้งาน' };
  }

  return { ok: true, staffProfile, branchId: branch.id, branch };
}

// 1. ค้นหาลูกค้าด้วยเบอร์โทรศัพท์ หรือ LINE User ID
export async function searchCustomerAction(query) {
  const acc = await requireCap('/loyalty', 'view');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase } = acc;

  const raw = String(query || '').trim();
  if (!raw) return { status: 'error', message: 'กรุณากรอกเบอร์โทรศัพท์หรือ LINE User ID' };

  const digits = raw.replace(/\D/g, '');
  const SELECT = '*, branches(name)';

  // แยกเป็นสองคิวรี แทนการต่อสตริงเข้า .or() — .or() รับ filter เป็นสตริงดิบ ค่าที่มี , หรือ .
  // ปนเข้ามาจะทำให้เงื่อนไขเพี้ยนและคืน "ลูกค้าผิดคน" (แต้มไปเข้าคนอื่นโดยไม่มีใครรู้)
  let found = null;

  if (digits.length >= 9) {
    const { data, error } = await supabase
      .from('customers').select(SELECT).eq('phone', digits).maybeSingle();
    if (error) return { status: 'error', message: error.message };
    found = data;
  }

  if (!found) {
    const { data, error } = await supabase
      .from('customers').select(SELECT).eq('line_user_id', raw).maybeSingle();
    if (error) return { status: 'error', message: error.message };
    found = data;
  }

  if (found) return { status: 'ok', customer: found };

  return { status: 'not_found', query: digits.length >= 9 ? digits : raw };
}

// 2. ลงทะเบียนลูกค้าใหม่ (บังคับความยินยอม PDPA)
export async function registerCustomerAction({ phone, line_user_id, name, privacy_consent }) {
  const acc = await requireCap('/loyalty', 'create');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase } = acc;

  if (!privacy_consent) {
    return { status: 'error', message: 'กรุณายืนยันความยินยอมเก็บข้อมูลส่วนบุคคลก่อนสมัครสมาชิก' };
  }

  const cleanPhone = String(phone || '').replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 9) {
    return { status: 'error', message: 'เบอร์โทรศัพท์ไม่ถูกต้อง (อย่างน้อย 9 หลัก)' };
  }

  const row = {
    phone: cleanPhone,
    line_user_id: line_user_id ? String(line_user_id).trim() : null,
    name: name ? String(name).trim() : `ลูกค้า (${cleanPhone.slice(-4)})`,
    rfm_segment: 'New',
    privacy_consent_at: new Date().toISOString(),
    privacy_consent_version: PRIVACY_CONSENT_VERSION,
  };

  const { data: customer, error } = await supabase
    .from('customers')
    .insert(row)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return { status: 'error', message: 'เบอร์โทรศัพท์หรือ LINE ID นี้ถูกลงทะเบียนไว้แล้ว' };
    // คอลัมน์ consent ยังไม่มี — insert ใหม่โดยไม่บันทึก consent (ยังบังคับติ๊กฝั่งแอป)
    if (error.message?.includes('privacy_consent') || error.code === '42703') {
      const { privacy_consent_at, privacy_consent_version, ...legacy } = row;
      const retry = await supabase.from('customers').insert(legacy).select().single();
      if (retry.error) {
        if (retry.error.code === '23505') {
          return { status: 'error', message: 'เบอร์โทรศัพท์หรือ LINE ID นี้ถูกลงทะเบียนไว้แล้ว' };
        }
        return { status: 'error', message: retry.error.message };
      }
      revalidateLoyalty();
      return {
        status: 'ok',
        customer: retry.data,
        message: 'ลงทะเบียนสำเร็จ (ยังไม่ได้รัน sql/add_customer_privacy_consent.sql — บันทึกเวลายินยอมในฐานข้อมูลไม่ได้)',
      };
    }
    return { status: 'error', message: error.message };
  }

  revalidateLoyalty();
  return { status: 'ok', customer, message: 'ลงทะเบียนลูกค้าสำเร็จ' };
}

// 3. แจกแต้มสะสม (บังคับสาขา + ใบเสร็จ + Anti-Fraud)
export async function issuePointsAction({ customer_id, points, receipt_number, branch_id }) {
  const acc = await requireCap('/loyalty', 'create');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase, user, profile } = acc;

  const pts = Number(points);
  if (!pts || pts <= 0 || !Number.isFinite(pts)) {
    return { status: 'error', message: 'จำนวนแต้มต้องมากกว่า 0' };
  }

  const receipt = String(receipt_number || '').trim();
  if (!receipt) {
    return { status: 'error', message: 'กรุณาระบุเลขที่ใบเสร็จ — ใช้ไล่ย้อนบิลเมื่อมีข้อสงสัย' };
  }

  const ctx = await resolveStaffContext(supabase, user.id, branch_id, profile?.role);
  if (!ctx.ok) return { status: 'error', message: ctx.message };

  // Anti-fraud: max 100 pts / issue
  if (pts > 100) {
    await supabase.from('loyalty_audit_logs').insert({
      action_type: 'FRAUD_ALERT_HIGH_POINTS',
      performed_by_staff_id: user.id,
      customer_id,
      branch_id: ctx.branchId,
      details: { attempted_points: pts, receipt_number: receipt, reason: 'แจกแต้มเกิน 100 แต้มในบิลเดียว' },
    });
    return { status: 'error', message: 'ปฏิเสธคำขอ: ไม่สามารถแจกแต้มเกิน 100 แต้มต่อครั้งได้ (บันทึกแจ้งเตือนแล้ว)' };
  }

  // Anti-fraud: rate limit
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('staff_id', user.id)
    .eq('customer_id', customer_id)
    .eq('transaction_type', 'earn')
    .gte('created_at', tenMinsAgo);

  if (count && count >= 5) {
    await supabase.from('loyalty_audit_logs').insert({
      action_type: 'FRAUD_ALERT_RATE_LIMIT',
      performed_by_staff_id: user.id,
      customer_id,
      branch_id: ctx.branchId,
      details: { recent_tx_count: count, attempted_points: pts, reason: 'แจกแต้มให้ลูกค้ารายเดิมเกิน 5 ครั้งใน 10 นาที' },
    });
    return { status: 'error', message: 'ปฏิเสธคำขอ: สุ่มเสี่ยงการแจกแต้มถี่ผิดปกติ (เกิน 5 ครั้งใน 10 นาที)' };
  }

  // Anti-fraud: ใบเสร็จใบเดียวแจกแต้มได้ครั้งเดียวต่อสาขา
  // ด่านจริงคือ unique index uidx_point_tx_earn_receipt (sql/harden_loyalty_integrity.sql)
  // ที่เช็คก่อนตรงนี้เพื่อให้ได้ข้อความบอกว่าใบนี้เคยใช้เมื่อไหร่/กับใคร แทน error 23505 ดิบๆ
  const { data: dupe } = await supabase
    .from('point_transactions')
    .select('id, created_at, points, customers(name, phone)')
    .eq('branch_id', ctx.branchId)
    .eq('transaction_type', 'earn')
    .eq('receipt_number', receipt)
    .limit(1)
    .maybeSingle();

  if (dupe) {
    await supabase.from('loyalty_audit_logs').insert({
      action_type: 'FRAUD_ALERT_DUPLICATE_RECEIPT',
      performed_by_staff_id: user.id,
      customer_id,
      branch_id: ctx.branchId,
      details: {
        receipt_number: receipt,
        attempted_points: pts,
        existing_tx_id: dupe.id,
        existing_at: dupe.created_at,
        reason: 'ใบเสร็จนี้ถูกใช้แจกแต้มที่สาขานี้ไปแล้ว',
      },
    });
    const when = new Date(dupe.created_at).toLocaleString('th-TH');
    const who = dupe.customers?.name ? ` ให้ ${dupe.customers.name}` : '';
    return {
      status: 'error',
      message: `ใบเสร็จเลขที่ ${receipt} ถูกใช้แจกแต้มที่สาขานี้ไปแล้ว (${when}${who}) — ถ้าแจกผิด ให้ผู้จัดการยกเลิกรายการเดิมที่หน้าประวัติก่อน`,
    };
  }

  const { data: tx, error } = await supabase
    .from('point_transactions')
    .insert({
      customer_id,
      staff_id: user.id,
      branch_id: ctx.branchId,
      points: pts,
      transaction_type: 'earn',
      receipt_number: receipt,
    })
    .select()
    .single();

  if (error) {
    // unique index จับได้ (เช่นพิมพ์ต่างตัวพิมพ์เล็กใหญ่ หรือยิงพร้อมกันสองเครื่อง)
    if (error.code === '23505') {
      return {
        status: 'error',
        message: `ใบเสร็จเลขที่ ${receipt} ถูกใช้แจกแต้มที่สาขานี้ไปแล้ว — ถ้าแจกผิด ให้ผู้จัดการยกเลิกรายการเดิมที่หน้าประวัติก่อน`,
      };
    }
    return { status: 'error', message: error.message };
  }

  await supabase.from('loyalty_audit_logs').insert({
    action_type: 'ISSUE_POINTS',
    performed_by_staff_id: user.id,
    customer_id,
    branch_id: ctx.branchId,
    details: { points: pts, receipt_number: receipt, tx_id: tx.id, staff_code: ctx.staffProfile.staff_code },
  });

  revalidateLoyalty();
  return { status: 'ok', message: `สะสมแต้มสำเร็จ +${pts} แต้ม (${ctx.branch.name})`, points: pts };
}

// 4. แลกของรางวัล
export async function redeemRewardAction({ customer_id, reward_id, branch_id }) {
  const acc = await requireCap('/loyalty', 'create');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase, user, profile } = acc;

  // เส้นทางหลัก: RPC อะตอมมิก — หักแต้ม + ลงประวัติแลก + audit จบในทรานแซกชันเดียว
  // และ lock แถวลูกค้า (for update) กันแลกซ้อนพร้อมกันสองเครื่อง
  const rpc = await supabase.rpc('loyalty_redeem_reward', {
    p_customer_id: customer_id,
    p_reward_id: reward_id,
    p_branch_id: branch_id || null,
  });

  if (!rpc.error) {
    if (rpc.data?.status === 'error') return { status: 'error', message: rpc.data.message };
    revalidateLoyalty();
    return {
      status: 'ok',
      message: rpc.data?.message || 'แลกของรางวัลสำเร็จ',
      points_used: rpc.data?.points_used,
    };
  }

  // ยังไม่ได้รัน sql/harden_loyalty_integrity.sql → ถอยไปใช้เส้นทางเดิม (ยังไม่อะตอมมิก)
  const rpcMissing = rpc.error.code === '42883' || rpc.error.message?.includes('loyalty_redeem_reward');
  if (!rpcMissing) return { status: 'error', message: rpc.error.message };

  const reward = await getRewardFromDb(supabase, reward_id);
  if (!reward) return { status: 'error', message: 'ไม่พบรางวัลนี้ในระบบ หรือถูกปิดใช้งาน' };
  const pts = reward.points;
  const reward_name = reward.name;

  const ctx = await resolveStaffContext(supabase, user.id, branch_id, profile?.role);
  if (!ctx.ok) return { status: 'error', message: ctx.message };

  const { data: customer } = await supabase
    .from('customers')
    .select('points_balance, name')
    .eq('id', customer_id)
    .single();

  if (!customer || (customer.points_balance || 0) < pts) {
    return { status: 'error', message: `แต้มสะสมไม่เพียงพอ (แต้มที่มี: ${customer?.points_balance || 0} แต้ม)` };
  }

  const { data: tx, error: txErr } = await supabase
    .from('point_transactions')
    .insert({
      customer_id,
      staff_id: user.id,
      branch_id: ctx.branchId,
      points: -pts,
      transaction_type: 'redeem',
      note: `แลกรางวัล: ${reward_name}`,
    })
    .select('id')
    .single();

  if (txErr) return { status: 'error', message: txErr.message };

  await supabase.from('redemption_history').insert({
    customer_id,
    reward_id: reward.id,
    reward_name,
    points_used: pts,
    branch_id: ctx.branchId,
    staff_id: user.id,
  });

  await supabase.from('loyalty_audit_logs').insert({
    action_type: 'REDEEM_REWARD',
    performed_by_staff_id: user.id,
    customer_id,
    branch_id: ctx.branchId,
    details: {
      reward_id: reward.id,
      reward_name,
      points_used: pts,
      tx_id: tx?.id,
      staff_code: ctx.staffProfile.staff_code,
    },
  });

  revalidateLoyalty();
  return {
    status: 'ok',
    message: `แลกของรางวัล "${reward_name}" สำเร็จ (-${pts} แต้ม) ที่${ctx.branch.name}`,
    points_used: pts,
  };
}

// 5. ยกเลิกธุรกรรม (สร้างแถว reverse — ไม่ลบของเดิม) manager+
export async function voidTransactionAction({ tx_id, reason }) {
  const acc = await requireCap('/loyalty', 'edit');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase, user, profile } = acc;
  if (!VOID_ROLES.has(profile?.role)) {
    return { status: 'error', message: 'เฉพาะ Manager / Co-Admin / Admin เท่านั้นที่ยกเลิกได้' };
  }

  const why = String(reason || '').trim();
  if (!why || why.length < 3) {
    return { status: 'error', message: 'กรุณาระบุเหตุผลการยกเลิก (อย่างน้อย 3 ตัวอักษร)' };
  }

  // ใช้ SECURITY DEFINER RPC — กัน client แทรก transaction_type=adjust ตรงๆ
  const { data, error } = await supabase.rpc('loyalty_void_transaction', {
    p_tx_id: tx_id,
    p_reason: why,
  });

  if (error) {
    // ถ้ายังไม่ได้รัน harden_loyalty_writes.sql → fallback แบบเดิม (จะพังเมื่อ RLS ปิด insert adjust)
    if (error.message?.includes('loyalty_void_transaction') || error.code === '42883') {
      return {
        status: 'error',
        message: 'ยังไม่ได้รัน sql/harden_loyalty_writes.sql บน Supabase — ยกเลิกธุรกรรมผ่าน RPC ไม่ได้',
      };
    }
    return { status: 'error', message: error.message };
  }
  if (data?.status === 'error') return { status: 'error', message: data.message };

  revalidateLoyalty();
  return { status: 'ok', message: data?.message || 'ยกเลิกธุรกรรมสำเร็จ (สร้างรายการย้อนกลับแล้ว)' };
}

// 6. ประวัติธุรกรรมแบบกรองได้ (ทุก role ที่ล็อกอิน — staff เห็นได้เพื่อไล่บิล)
export async function listTransactionsAction(filters = {}) {
  const acc = await requireCap('/loyalty', 'view');
  if (!acc.allowed) return { status: 'error', message: acc.message };
  const { supabase } = acc;

  const limit = Math.min(Number(filters.limit) || 100, 300);
  let q = supabase
    .from('point_transactions')
    .select('*, branches(name, code), profiles(full_name, nickname), customers(name, phone)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (filters.branch_id) q = q.eq('branch_id', filters.branch_id);
  if (filters.staff_id) q = q.eq('staff_id', filters.staff_id);
  if (filters.customer_id) q = q.eq('customer_id', filters.customer_id);
  if (filters.transaction_type) q = q.eq('transaction_type', filters.transaction_type);
  if (filters.date_from) q = q.gte('created_at', `${filters.date_from}T00:00:00`);
  if (filters.date_to) q = q.lte('created_at', `${filters.date_to}T23:59:59.999`);
  if (filters.phone) {
    const phone = String(filters.phone).replace(/\D/g, '');
    if (phone) {
      const { data: cust } = await supabase.from('customers').select('id').eq('phone', phone).maybeSingle();
      if (!cust) return { status: 'ok', transactions: [] };
      q = q.eq('customer_id', cust.id);
    }
  }

  const { data, error } = await q;
  if (error) return { status: 'error', message: error.message };
  return { status: 'ok', transactions: data || [] };
}

// 7. ดึงข้อมูลสถิติ CDP / สาขา
export async function getLoyaltyAnalyticsAction() {
  const { supabase, user, profile } = await requireUser();
  if (!user) return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
  if (!ANALYTICS_ROLES.has(profile?.role)) {
    return { status: 'error', message: 'ไม่มีสิทธิ์ดูแดชบอร์ดวิเคราะห์' };
  }

  // จำกัดช่วงเวลา — เดิมดึงทั้งตารางทำให้หน้า CDP ช้าเมื่อข้อมูลโต
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString();

  const [
    { data: txs },
    customerStats,
    { data: branches },
    { data: auditLogs },
    { data: staffProfiles },
  ] = await Promise.all([
    supabase
      .from('point_transactions')
      .select('id, customer_id, staff_id, branch_id, points, transaction_type, note, receipt_number, created_at, branches(name, code), profiles(full_name, nickname), customers(name, phone)')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(3000),
    // นับ RFM/แต้มคงค้างฝั่ง DB — เดิมดึง customers ทุกแถวมานับใน Node (ช้าเมื่อสมาชิกโต
    // และถ้าโปรเจกต์ตั้ง db-max-rows ไว้ ตัวเลขจะถูกตัดเงียบๆ โดยไม่มี error)
    loadCustomerStats(supabase),
    supabase.from('branches').select('id, code, name, is_active'),
    supabase
      .from('loyalty_audit_logs')
      .select('id, action_type, details, created_at, profiles(full_name, nickname), branches(name)')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('staff_profiles').select('user_id, staff_code, branch_id, profiles(full_name, nickname), branches(name)'),
  ]);

  return {
    status: 'ok',
    data: {
      transactions: txs || [],
      customerStats,
      branches: branches || [],
      auditLogs: auditLogs || [],
      staffProfiles: staffProfiles || [],
    },
  };
}

/**
 * สรุปฐานลูกค้า: จำนวนสมาชิก / แต้มคงค้างทั้งระบบ / จำนวนต่อกลุ่ม RFM
 * ใช้ RPC get_loyalty_segment_counts() ซึ่งคำนวณ RFM สดจาก last_visited_at ทุกครั้ง
 * ถ้ายังไม่ได้รัน sql/harden_loyalty_integrity.sql จะถอยไปนับฝั่ง Node แบบเดิม
 */
async function loadCustomerStats(supabase) {
  const { data, error } = await supabase.rpc('get_loyalty_segment_counts');
  if (!error && data) {
    return {
      total: Number(data.total) || 0,
      pointsOutstanding: Number(data.points_outstanding) || 0,
      segments: data.segments || {},
      live: true,
    };
  }

  const { data: rows } = await supabase
    .from('customers')
    .select('points_balance, visit_count, last_visited_at');

  const segments = {};
  let pointsOutstanding = 0;
  (rows || []).forEach((c) => {
    const seg = customerSegment(c);
    segments[seg] = (segments[seg] || 0) + 1;
    pointsOutstanding += Number(c.points_balance) || 0;
  });

  return { total: (rows || []).length, pointsOutstanding, segments, live: false };
}
