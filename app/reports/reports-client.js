'use client';

import { useState, useEffect, useMemo } from 'react';
import Icon from '../../components/icon';
import AppShell from '../../components/app-shell';
import PageHeader from '../../components/page-header';
import { fmtMoney } from '../../lib/format';
import { monthInputToLabel, computeEffectiveOpex } from '../../lib/opex';
import { EXPENSE_CATEGORIES } from '../../lib/expense-categories';
import RevenueChart from './revenue-chart';
import ExpenseChart from './expense-chart';
import DataTable from '../../components/data-table';
import Kpi from '../../components/kpi';
import DateField from '../../components/date-field';
import { getMonthlyReportAction } from './actions';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 'all'];

function getPrevMonths(monthStr, count = 3) {
  const [yStr, mStr] = String(monthStr).split('-');
  let y = Number(yStr) || 2026;
  let m = Number(mStr) || 8;
  const list = [];
  for (let i = 0; i < count; i++) {
    m--;
    if (m < 1) {
      m = 12;
      y--;
    }
    list.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return list;
}

export default function ReportsClient({ initialMonth, initialData, role, name, isAdmin, allowed }) {
  const [month, setMonth] = useState(initialMonth);
  const [cache, setCache] = useState({ [initialMonth]: initialData });
  const [isLoading, setIsLoading] = useState(false);

  // Table controls
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);

  // Background prefetch
  useEffect(() => {
    const toPrefetch = getPrevMonths(month, 3);
    toPrefetch.forEach((m) => {
      if (!cache[m]) {
        getMonthlyReportAction(m).then((res) => {
          if (res && !res.error) {
            setCache((prev) => ({ ...prev, [m]: res }));
          }
        }).catch(() => {});
      }
    });
  }, [month]);

  // เปลี่ยนเดือน
  async function handleMonthChange(newMonth) {
    if (!/^\d{4}-\d{2}$/.test(newMonth) || newMonth === month) return;

    setMonth(newMonth);
    setSearch('');
    setCatFilter('');
    setCurrentPage(1);
    window.history.replaceState(null, '', `/reports?month=${newMonth}`);

    if (cache[newMonth]) {
      return; // 0ms Instant render from cache
    }

    setIsLoading(true);
    try {
      const res = await getMonthlyReportAction(newMonth);
      if (res && !res.error) {
        setCache((prev) => ({ ...prev, [newMonth]: res }));
      }
    } finally {
      setIsLoading(false);
    }
  }

  const currentData = cache[month] || initialData || { sales: [], expenses: [], opexDefaults: {} };
  const sales = currentData.sales || [];
  const expenses = currentData.expenses || [];
  const opexDefaults = currentData.opexDefaults || {};

  const monthLabel = monthInputToLabel(month);

  const income = useMemo(
    () => sales.reduce((a, s) => a + Number(s.net_revenue || 0), 0),
    [sales]
  );

  const catSum = (c) =>
    expenses.filter((e) => !e.item_key && e.category === c).reduce((a, e) => a + Number(e.total_amount || 0), 0);
  const matTotal = catSum('ต้นทุนวัตถุดิบ');
  const bakTotal = catSum('ต้นทุนขนมหน้าร้าน');
  const miscTotal = catSum('รายจ่ายจิปาถะ');
  const opexTotal = computeEffectiveOpex(expenses, opexDefaults);
  const totalExp = matTotal + bakTotal + miscTotal + opexTotal;
  const profit = income - totalExp;

  const totalCups = sales.reduce((a, s) => a + Number(s.total_cups || 0), 0);
  const pastryRev = sales.reduce((a, s) => a + Number(s.pastry_revenue || 0), 0);
  const freeCups = sales.reduce((a, s) => a + Number(s.free_cups || 0), 0);
  const daysRecorded = sales.length;

  const expRows = [
    { label: 'ต้นทุนวัตถุดิบ', v: matTotal },
    { label: 'ต้นทุนขนม', v: bakTotal },
    { label: 'รายจ่ายจิปาถะ', v: miscTotal },
    { label: 'ค่าดำเนินการ', v: opexTotal },
    { label: 'รวมรายจ่าย', v: totalExp, total: true },
  ];
  const expCols = [
    { key: 'label', label: 'หมวด', render: (r) => <span style={{ fontWeight: r.total ? 700 : 400 }}>{r.label}</span> },
    { key: 'v', label: 'จำนวนเงิน', align: 'right', render: (r) => (
      <strong style={{ fontWeight: r.total ? 700 : 600, color: r.total ? 'var(--danger)' : 'var(--text)' }}>{fmtMoney(r.v)} ฿</strong>
    ) },
  ];

  // รายการรายจ่ายทั้งเดือนแบบละเอียด
  const catLabel = useMemo(() => {
    const map = {};
    EXPENSE_CATEGORIES.forEach((c) => { map[c.value] = c.label; });
    return map;
  }, []);

  const allItemRows = useMemo(() => {
    return expenses
      .filter((e) => !e.item_key)
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [expenses]);

  // กรองตามหมวด + คำค้นหา
  const filteredRows = useMemo(() => {
    let list = allItemRows;
    if (catFilter) {
      list = list.filter((r) => r.category === catFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) =>
        (r.item_name || '').toLowerCase().includes(q) ||
        (r.subcategory || '').toLowerCase().includes(q) ||
        (r.category || '').toLowerCase().includes(q) ||
        (r.date || '').includes(q)
      );
    }
    return list;
  }, [allItemRows, catFilter, search]);

  // คำนวณหน้า Pagination
  const numericLimit = pageSize === 'all' ? filteredRows.length || 1 : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / numericLimit));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  const paginatedRows = useMemo(() => {
    if (pageSize === 'all') return filteredRows;
    const start = (safePage - 1) * numericLimit;
    return filteredRows.slice(start, start + numericLimit);
  }, [filteredRows, safePage, numericLimit, pageSize]);

  const startRecord = filteredRows.length === 0 ? 0 : (safePage - 1) * numericLimit + 1;
  const endRecord = pageSize === 'all' ? filteredRows.length : Math.min(safePage * numericLimit, filteredRows.length);

  const itemCols = [
    { key: 'date', label: 'วันที่' },
    { key: 'category', label: 'หมวด', render: (r) => catLabel[r.category] || r.category },
    { key: 'item_name', label: 'รายการ' },
    { key: 'subcategory', label: 'ผู้ขาย/ซัพพลายเออร์', render: (r) => r.subcategory || '—' },
    { key: 'quantity', label: 'จำนวน', align: 'right', render: (r) => `${fmtMoney(r.quantity)} ${r.unit || ''}` },
    { key: 'unit_price', label: 'ราคา/หน่วย', align: 'right', render: (r) => `${fmtMoney(r.unit_price)} ฿` },
    { key: 'payment_method', label: 'ชำระด้วย' },
    { key: 'total_amount', label: 'รวม', align: 'right', render: (r) => <strong>{fmtMoney(r.total_amount)} ฿</strong> },
  ];

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-chart-bar" title="สรุปรายเดือน">
        <div style={{ minWidth: 160 }}>
          <DateField
            type="month"
            value={month}
            loading={isLoading}
            onChange={handleMonthChange}
          />
        </div>
        <a className="link-btn" href={`/export?month=${month}`}>
          <Icon name="ti-download" /> Excel
        </a>
      </PageHeader>

      <div className="kpis">
        <Kpi label="รายรับสุทธิ (หัก GP)" value={fmtMoney(income)} sub="บาท" cls="green" icon="ti-trending-up" />
        <Kpi label="รายจ่ายรวม" value={fmtMoney(totalExp)} sub="บาท" cls="red" icon="ti-trending-down" />
        <Kpi label={profit >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} value={fmtMoney(profit)} sub="บาท" cls={profit >= 0 ? 'blue' : 'red'} icon="ti-scale" />
      </div>

      <RevenueChart sales={sales} />
      <ExpenseChart mat={matTotal} bak={bakTotal} misc={miscTotal} opex={opexTotal} />

      <div className="card">
        <div className="card-head"><Icon name="ti-list-details" /><h2>รายจ่ายแยกหมวด — {monthLabel}</h2></div>
        <div className="card-body">
          <DataTable columns={expCols} rows={expRows} rowKey={(r) => r.label} />
        </div>
      </div>

      {/* รายการรายจ่ายทั้งเดือน */}
      <div className="card">
        <div className="card-head" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="ti-receipt-2" />
            <h2>รายการรายจ่ายทั้งเดือน — {monthLabel}</h2>
            <span className="chip" style={{ background: 'var(--coffee)', fontSize: 11 }}>
              {allItemRows.length} รายการ
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ width: 'auto', minWidth: 130, padding: '6px 10px', fontSize: 12 }}
              value={catFilter}
              onChange={(e) => {
                setCatFilter(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="กรองหมวดหมู่"
            >
              <option value="">ทุกหมวดหมู่</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            <input
              type="text"
              className="input"
              placeholder="ค้นหารายการ / ผู้ขาย..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              style={{ width: 'min(200px, 100%)', padding: '6px 10px', fontSize: 12 }}
            />
          </div>
        </div>

        <div className="card-body">
          <DataTable
            columns={itemCols}
            rows={paginatedRows}
            rowKey={(r) => r.id}
            emptyText={allItemRows.length === 0 ? 'ยังไม่มีรายจ่ายในเดือนนี้' : 'ไม่พบรายการที่ตรงกับเงื่อนไขค้นหา'}
          />

          {/* แถบควบคุม Pagination */}
          {filteredRows.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                marginTop: 16,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
                fontSize: 13,
              }}
            >
              <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>แสดง {startRecord}–{endRecord} จากทั้งหมด {filteredRows.length} รายการ</span>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                  <span>หน้าละ:</span>
                  <select
                    className="input"
                    style={{ width: 'auto', padding: '4px 8px', fontSize: 12, fontWeight: 600 }}
                    value={pageSize}
                    onChange={(e) => {
                      const v = e.target.value === 'all' ? 'all' : Number(e.target.value);
                      setPageSize(v);
                      setCurrentPage(1);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === 'all' ? 'ทั้งหมด' : opt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {pageSize !== 'all' && totalPages > 1 && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '5px 10px', fontSize: 12 }}
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <Icon name="ti-chevron-left" /> ก่อนหน้า
                  </button>

                  <span style={{ padding: '0 8px', fontWeight: 600, fontSize: 12 }}>
                    หน้า {safePage} / {totalPages}
                  </span>

                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '5px 10px', fontSize: 12 }}
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    ถัดไป <Icon name="ti-chevron-right" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><Icon name="ti-cup" /><h2>สถิติการขาย</h2></div>
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <Mini label="วันที่บันทึก" value={`${daysRecorded} วัน`} />
          <Mini label="ยอดขายรวม" value={`${fmtMoney(totalCups)} แก้ว`} />
          <Mini label="รายได้ขนม" value={`${fmtMoney(pastryRev)} ฿`} />
          <Mini label="แก้วฟรี" value={`${fmtMoney(freeCups)} แก้ว`} />
        </div>
      </div>

      {daysRecorded === 0 && <p className="muted" style={{ fontSize: 13 }}>ยังไม่มีข้อมูลยอดขายในเดือนนี้</p>}
    </AppShell>
  );
}

function Mini({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
