'use client';
import Icon from '../../../components/icon';

import { useEffect, useState, useTransition } from 'react';
import { listTransactionsAction, voidTransactionAction } from '../actions';
import { digitsOnly } from '../../../lib/format';
import DateField from '../../../components/date-field';
import DataTable from '../../../components/data-table';

const TYPE_LABEL = {
  earn: 'แจกแต้ม',
  redeem: 'แลกรางวัล',
  adjust: 'ปรับ/ยกเลิก',
};

export default function HistoryClient({
  branches = [],
  staffOptions = [],
  canVoid = false,
  initialBranchId = '',
}) {
  const [filters, setFilters] = useState({
    branch_id: initialBranchId || '',
    staff_id: '',
    transaction_type: '',
    phone: '',
    date_from: '',
    date_to: '',
  });
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState(null);
  const [isPending, startTransition] = useTransition();

  function load(nextFilters = filters) {
    setMsg(null);
    startTransition(async () => {
      const res = await listTransactionsAction(nextFilters);
      if (res.status === 'ok') setRows(res.transactions || []);
      else setMsg({ text: res.message, type: 'err' });
    });
  }

  useEffect(() => {
    load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFilterSubmit(e) {
    e.preventDefault();
    load(filters);
  }

  async function onVoid(tx) {
    if (!canVoid) return;
    if (tx.transaction_type === 'adjust' && String(tx.note || '').startsWith('VOID:')) {
      setMsg({ text: 'รายการนี้เป็นรายการยกเลิกอยู่แล้ว', type: 'err' });
      return;
    }
    const reason = window.prompt(`เหตุผลการยกเลิกธุรกรรม ${tx.points > 0 ? '+' : ''}${tx.points} แต้ม ของ ${tx.customers?.name || ''}`);
    if (reason == null) return;
    startTransition(async () => {
      const res = await voidTransactionAction({ tx_id: tx.id, reason });
      setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
      if (res.status === 'ok') load(filters);
    });
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card">
        <div className="card-head">
          <Icon name="ti-filter" /> <h2>กรองธุรกรรม</h2>
        </div>
        <div className="card-body">
          <form
            onSubmit={onFilterSubmit}
            style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}
          >
            <label style={lbl}>
              <span>สาขา</span>
              <select className="input" value={filters.branch_id} onChange={(e) => setFilters((f) => ({ ...f, branch_id: e.target.value }))}>
                <option value="">ทุกสาขา</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label style={lbl}>
              <span>พนักงาน</span>
              <select className="input" value={filters.staff_id} onChange={(e) => setFilters((f) => ({ ...f, staff_id: e.target.value }))}>
                <option value="">ทุกคน</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label style={lbl}>
              <span>ประเภท</span>
              <select className="input" value={filters.transaction_type} onChange={(e) => setFilters((f) => ({ ...f, transaction_type: e.target.value }))}>
                <option value="">ทั้งหมด</option>
                <option value="earn">แจกแต้ม</option>
                <option value="redeem">แลกรางวัล</option>
                <option value="adjust">ปรับ/ยกเลิก</option>
              </select>
            </label>
            <label style={lbl}>
              <span>เบอร์ลูกค้า</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="08..."
                value={filters.phone}
                onChange={(e) => setFilters((f) => ({ ...f, phone: digitsOnly(e.target.value) }))}
              />
            </label>
            <label style={lbl}>
              <span>จากวันที่</span>
              <DateField type="date" value={filters.date_from} onChange={(v) => setFilters((f) => ({ ...f, date_from: v }))} />
            </label>
            <label style={lbl}>
              <span>ถึงวันที่</span>
              <DateField type="date" value={filters.date_to} onChange={(v) => setFilters((f) => ({ ...f, date_to: v }))} />
            </label>
            <button className="btn btn-coffee" type="submit" disabled={isPending}>
              <Icon name="ti-search" /> {isPending ? 'กำลังโหลด...' : 'ค้นหา'}
            </button>
          </form>
          {msg && (
            <div style={{ marginTop: 12, color: msg.type === 'ok' ? '#1e7e34' : '#c0392b', fontSize: 'var(--fs-md)' }}>
              {msg.text}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <Icon name="ti-list" /> <h2>รายการ ({rows.length})</h2>
        </div>
        <div className="card-body">
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            emptyText="ไม่พบธุรกรรมตามเงื่อนไข"
            columns={[
              {
                key: 'created_at',
                label: 'เวลา',
                render: (r) => new Date(r.created_at).toLocaleString('th-TH'),
              },
              {
                key: 'type',
                label: 'ประเภท',
                render: (r) => TYPE_LABEL[r.transaction_type] || r.transaction_type,
              },
              {
                key: 'points',
                label: 'แต้ม',
                align: 'right',
                render: (r) => (
                  <strong style={{ color: r.points >= 0 ? '#16a34a' : '#ea580c' }}>
                    {r.points > 0 ? '+' : ''}{r.points}
                  </strong>
                ),
              },
              {
                key: 'customer',
                label: 'ลูกค้า',
                render: (r) => (
                  <span>
                    {r.customers?.name || '—'}
                    <br />
                    <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{r.customers?.phone}</span>
                  </span>
                ),
              },
              {
                key: 'branch',
                label: 'สาขา',
                render: (r) => r.branches?.name || <span className="muted">ไม่ระบุ</span>,
              },
              {
                key: 'staff',
                label: 'พนักงาน',
                render: (r) => r.profiles?.full_name || r.profiles?.nickname || '—',
              },
              {
                key: 'receipt',
                label: 'ใบเสร็จ / หมายเหตุ',
                render: (r) => (
                  <span style={{ fontSize: 'var(--fs-sm)' }}>
                    {r.receipt_number || '—'}
                    {r.note ? <><br /><span className="muted">{r.note}</span></> : null}
                  </span>
                ),
              },
              ...(canVoid
                ? [{
                    key: 'actions',
                    label: '',
                    render: (r) => (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: 'var(--fs-xs)', padding: '4px 8px' }}
                        disabled={isPending || (r.transaction_type === 'adjust' && String(r.note || '').startsWith('VOID:'))}
                        onClick={() => onVoid(r)}
                      >
                        ยกเลิก
                      </button>
                    ),
                  }]
                : []),
            ]}
          />
        </div>
      </div>
    </div>
  );
}

const lbl = { display: 'grid', gap: 4, fontSize: 'var(--fs-sm)', fontWeight: 600 };
