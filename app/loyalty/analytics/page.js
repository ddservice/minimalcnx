import Icon from '../../../components/icon';
import { redirect } from 'next/navigation';
import { requirePage } from '../../../lib/session';
import AppShell from '../../../components/app-shell';
import PageHeader from '../../../components/page-header';
import Kpi from '../../../components/kpi';
import DataTable from '../../../components/data-table';
import { getLoyaltyAnalyticsAction } from '../actions';
import PointDistributionChart from './distribution-chart';
import Link from 'next/link';

const CAN_VIEW = new Set(['admin', 'co-admin', 'manager']);

export default async function LoyaltyAnalyticsPage() {
  const { role, name, isAdmin, allowed } = await requirePage('/loyalty');
  if (!CAN_VIEW.has(role)) redirect('/loyalty');

  const res = await getLoyaltyAnalyticsAction();
  const { transactions = [], customerStats, branches = [], auditLogs = [] } = res?.data || {};
  const stats = customerStats || { total: 0, pointsOutstanding: 0, segments: {}, live: false };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // 1. คำนวณ KPI รวม
  const totalIssued = transactions.filter((t) => t.points > 0).reduce((a, t) => a + t.points, 0);
  const totalRedeemed = Math.abs(transactions.filter((t) => t.points < 0 && t.transaction_type === 'redeem').reduce((a, t) => a + t.points, 0));
  const activeCustomers = stats.total;
  const fraudAlertsCount = auditLogs.filter((l) => l.action_type?.startsWith('FRAUD_ALERT')).length;

  // 2. แยกแต้มตามสาขา (ทั้งหมด + เดือนนี้)
  const branchMap = {};
  branches.forEach((b) => {
    branchMap[b.id] = { id: b.id, name: b.name, code: b.code, issued: 0, redeemed: 0, monthIssued: 0, monthRedeemed: 0 };
  });
  transactions.forEach((t) => {
    if (!t.branch_id || !branchMap[t.branch_id]) return;
    const isMonth = t.created_at >= monthStart;
    if (t.transaction_type === 'earn') {
      branchMap[t.branch_id].issued += t.points;
      if (isMonth) branchMap[t.branch_id].monthIssued += t.points;
    } else if (t.transaction_type === 'redeem') {
      const abs = Math.abs(t.points);
      branchMap[t.branch_id].redeemed += abs;
      if (isMonth) branchMap[t.branch_id].monthRedeemed += abs;
    }
  });
  const branchMetrics = Object.values(branchMap);

  // แลกข้ามสาขาโดยประมาณ: ลูกค้าที่เคย earn ที่สาขา A แล้ว redeem ที่สาขา B
  const earnBranchesByCustomer = {};
  transactions.filter((t) => t.transaction_type === 'earn' && t.branch_id).forEach((t) => {
    if (!earnBranchesByCustomer[t.customer_id]) earnBranchesByCustomer[t.customer_id] = new Set();
    earnBranchesByCustomer[t.customer_id].add(t.branch_id);
  });
  const crossBranchRedeems = transactions.filter((t) => {
    if (t.transaction_type !== 'redeem' || !t.branch_id) return false;
    const earnedAt = earnBranchesByCustomer[t.customer_id];
    if (!earnedAt || earnedAt.size === 0) return false;
    return !earnedAt.has(t.branch_id) || earnedAt.size > 1;
  }).slice(0, 30);

  // 3. ผลงานพนักงานและการตรวจสอบการแจกแต้ม (Staff Performance)
  const staffMap = {};
  transactions.forEach((t) => {
    const sName = t.profiles?.full_name || t.profiles?.nickname || 'บาริสต้า/พนักงาน';
    const sId = t.staff_id || 'unknown';
    if (!staffMap[sId]) staffMap[sId] = { id: sId, name: sName, issued: 0, redeemed: 0, txCount: 0 };
    if (t.points > 0) staffMap[sId].issued += t.points;
    else staffMap[sId].redeemed += Math.abs(t.points);
    staffMap[sId].txCount += 1;
  });
  const staffRows = Object.values(staffMap).sort((a, b) => b.issued - a.issued);

  // 4. กลุ่มลูกค้า CDP (RFM Segments Breakdown)
  // นับมาจาก DB แล้ว (RFM คำนวณสดจากวันที่มาล่าสุด ไม่ใช่คอลัมน์ที่ค้าง)
  const rfmCounts = { Champions: 0, Loyal: 0, Potential: 0, 'At-Risk': 0, Lost: 0, New: 0 };
  Object.entries(stats.segments || {}).forEach(([seg, cnt]) => {
    rfmCounts[seg] = (rfmCounts[seg] || 0) + Number(cnt || 0);
  });

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-chart-bar" title="แดชบอร์ดวิเคราะห์สถิติแต้ม & CDP">
        <Link href="/loyalty" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <Icon name="ti-arrow-left" /> กลับหน้าสะสมแต้ม
        </Link>
        <Link href="/loyalty/history" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
          <Icon name="ti-history" /> ประวัติธุรกรรม
        </Link>
      </PageHeader>

      <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
        สถิติธุรกรรมแสดงย้อนหลัง 90 วัน (เพื่อความเร็ว) · สมาชิก/RFM เป็นข้อมูลปัจจุบันทั้งระบบ
        {!stats.live && ' · ยังไม่ได้รัน sql/harden_loyalty_integrity.sql — กำลังนับฝั่งแอปแทน'}
      </p>

      {/* KPI Tiles */}
      <div className="kpis">
        <Kpi icon="ti-gift" label="แต้มที่แจก (90 วัน)" value={totalIssued.toLocaleString()} sub="แต้ม" cls="green" />
        <Kpi icon="ti-trophy" label="แต้มที่แลก (90 วัน)" value={totalRedeemed.toLocaleString()} sub="แต้ม" cls="blue" />
        <Kpi icon="ti-users" label="สมาชิกทั้งหมด" value={activeCustomers.toLocaleString()} sub="คน" plain />
        <Kpi icon="ti-wallet" label="แต้มคงค้างทั้งระบบ" value={stats.pointsOutstanding.toLocaleString()} sub="แต้มที่ลูกค้ายังไม่ได้ใช้" cls="blue" />
        <Kpi icon="ti-alert-triangle" label="การแจ้งเตือนสุ่มเสี่ยง (Anti-Fraud)" value={fraudAlertsCount.toLocaleString()} sub="ครั้ง" cls={fraudAlertsCount > 0 ? 'red' : 'green'} />
      </div>

      {/* กราฟแจก vs แลกแต้มแยกตามสาขา */}
      <div className="card">
        <div className="card-head">
          <Icon name="ti-chart-bar" /> <h2>สถิติการแจก vs แลกแต้ม แยกตามสาขา</h2>
        </div>
        <div className="card-body">
          <PointDistributionChart branchMetrics={branchMetrics} />
        </div>
      </div>

      {/* รายงานสาขา — ทั้งหมด vs เดือนนี้ */}
      <div className="card">
        <div className="card-head">
          <Icon name="ti-building-store" /> <h2>รายงานสาขา (ทั้งหมด / เดือนนี้)</h2>
        </div>
        <div className="card-body">
          <DataTable
            rows={branchMetrics}
            rowKey={(r) => r.id}
            emptyText="ยังไม่มีข้อมูลสาขา"
            columns={[
              { key: 'name', label: 'สาขา', render: (r) => <span><strong>{r.code}</strong> {r.name}</span> },
              { key: 'issued', label: 'แจกทั้งหมด', align: 'right', render: (r) => <strong style={{ color: '#16a34a' }}>+{r.issued.toLocaleString()}</strong> },
              { key: 'redeemed', label: 'แลกทั้งหมด', align: 'right', render: (r) => <strong style={{ color: '#ea580c' }}>-{r.redeemed.toLocaleString()}</strong> },
              { key: 'monthIssued', label: 'แจกเดือนนี้', align: 'right', render: (r) => `+${r.monthIssued.toLocaleString()}` },
              { key: 'monthRedeemed', label: 'แลกเดือนนี้', align: 'right', render: (r) => `-${r.monthRedeemed.toLocaleString()}` },
            ]}
          />
        </div>
      </div>

      {/* แลกข้ามสาขา */}
      <div className="card">
        <div className="card-head">
          <Icon name="ti-arrows-exchange" /> <h2>การแลกรางวัลที่อาจข้ามสาขา (ล่าสุด)</h2>
        </div>
        <div className="card-body">
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            แสดงรายการแลกของลูกค้าที่เคยได้รับแต้มจากสาขาอื่นด้วย — ใช้ไล่ว่า “ให้ที่ไหน / ใช้ที่ไหน”
          </p>
          <DataTable
            rows={crossBranchRedeems}
            rowKey={(r) => r.id}
            emptyText="ยังไม่พบการแลกข้ามสาขา"
            columns={[
              { key: 'created_at', label: 'เวลา', render: (r) => new Date(r.created_at).toLocaleString('th-TH') },
              { key: 'customer', label: 'ลูกค้า', render: (r) => `${r.customers?.name || '—'} (${r.customers?.phone || ''})` },
              { key: 'branch', label: 'แลกที่สาขา', render: (r) => r.branches?.name || '—' },
              { key: 'staff', label: 'พนักงานผู้แลก', render: (r) => r.profiles?.full_name || r.profiles?.nickname || '—' },
              { key: 'points', label: 'แต้ม', align: 'right', render: (r) => Math.abs(r.points) },
              { key: 'note', label: 'รายละเอียด', render: (r) => r.note || '—' },
            ]}
          />
        </div>
      </div>

      {/* กลุ่มพฤติกรรมลูกค้า (CDP / RFM Segmentation) */}
      <div className="card">
        <div className="card-head">
          <Icon name="ti-user-check" /> <h2>การแบ่งกลุ่มลูกค้าตามพฤติกรรม (AI CDP / RFM Segments)</h2>
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <RfmTile label="Champions (ลูกค้าประจำชื่นชอบมาก)" count={rfmCounts.Champions} color="#16a34a" />
            <RfmTile label="Loyal (ลูกค้ามาสม่ำเสมอ)" count={rfmCounts.Loyal} color="#2563eb" />
            <RfmTile label="Potential (มีโอกาสเป็นลูกค้าประจำ)" count={rfmCounts.Potential} color="#d97706" />
            <RfmTile label="At-Risk (เริ่มห่างหาย >30 วัน)" count={rfmCounts['At-Risk']} color="#dc2626" />
            <RfmTile label="Lost (ขาดยาว >60 วัน)" count={rfmCounts.Lost} color="#6b7280" />
            <RfmTile label="New (สมาชิกใหม่)" count={rfmCounts.New} color="#8b5cf6" />
          </div>
        </div>
      </div>

      {/* รายงานผลงานพนักงาน (Staff Performance & Fraud Audit) */}
      <div className="card">
        <div className="card-head">
          <Icon name="ti-user-star" /> <h2>รายงานการออกแต้มแยกตามบาริสต้า/พนักงาน (Staff Performance)</h2>
        </div>
        <div className="card-body">
          <DataTable
            rows={staffRows}
            rowKey={(r) => r.id}
            emptyText="ยังไม่มีข้อมูลการออกแต้มของพนักงาน"
            columns={[
              { key: 'name', label: 'พนักงาน / บาริสต้า' },
              { key: 'txCount', label: 'จำนวนรายการทำ', align: 'right', render: (r) => `${r.txCount} รายการ` },
              { key: 'issued', label: 'แต้มที่แจก (+Earned)', align: 'right', render: (r) => <strong style={{ color: '#16a34a' }}>+{r.issued.toLocaleString()}</strong> },
              { key: 'redeemed', label: 'แต้มที่แลก (-Redeemed)', align: 'right', render: (r) => <strong style={{ color: '#ea580c' }}>-{r.redeemed.toLocaleString()}</strong> },
            ]}
          />
        </div>
      </div>

      {/* บันทึก Audit Log ป้องกันทุจริตล่าสุด */}
      <div className="card">
        <div className="card-head">
          <Icon name="ti-shield-alert" /> <h2>บันทึกตรวจสอบย้อนหลังล่าสุด (Anti-Fraud Audit Logs)</h2>
        </div>
        <div className="card-body">
          <DataTable
            rows={auditLogs}
            rowKey={(r) => r.id}
            emptyText="ยังไม่มีรายการบันทึก Audit"
            columns={[
              { key: 'created_at', label: 'เวลา', render: (r) => new Date(r.created_at).toLocaleString('th-TH') },
              {
                key: 'action_type',
                label: 'ประเภทแอ็กชัน',
                render: (r) => (
                  <span
                    style={{
                      fontWeight: 700,
                      color: r.action_type.startsWith('FRAUD_ALERT') ? '#dc2626' : 'var(--color-primary)',
                    }}
                  >
                    {r.action_type}
                  </span>
                ),
              },
              { key: 'staff', label: 'พนักงานผู้ทำรายการ', render: (r) => r.profiles?.full_name || r.profiles?.nickname || 'ระบบ' },
              { key: 'details', label: 'รายละเอียด', render: (r) => JSON.stringify(r.details) },
            ]}
          />
        </div>
      </div>
    </AppShell>
  );
}

function RfmTile({ label, count, color }) {
  return (
    <div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4 }}>{count || 0} <span style={{ fontSize: 12, fontWeight: 600 }}>คน</span></div>
    </div>
  );
}
