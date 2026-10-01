import { fmtMoney } from '../../lib/format';

// สัดส่วนรายจ่าย — categorical 4 หมวด (stacked bar) สีจากพาเลตที่ validate แล้ว
// (relief rule: contrast บางสีต่ำ → มี label ตรง + % กำกับเสมอ)
// อ่านข้อมูลอย่างเดียว ไม่แก้ DB
const SEGMENTS = [
  { key: 'mat', label: 'วัตถุดิบ', color: '#2a78d6' }, // slot 1 blue
  { key: 'bak', label: 'ขนม', color: '#008300' }, // slot 2 green
  { key: 'misc', label: 'จิปาถะ', color: '#e87ba4' }, // slot 3 magenta
  { key: 'opex', label: 'ค่าดำเนินการ', color: '#eda100' }, // slot 4 yellow
];

export default function ExpenseChart({ mat, bak, misc, opex }) {
  const vals = { mat, bak, misc, opex };
  const total = SEGMENTS.reduce((a, s) => a + Number(vals[s.key] || 0), 0);
  if (total <= 0) return null;

  const parts = SEGMENTS.map((s) => {
    const v = Number(vals[s.key] || 0);
    return { ...s, v, pct: (v / total) * 100 };
  }).filter((p) => p.v > 0);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--surface)', marginBottom: 12 }}>
      <h2 style={{ marginTop: 0, fontSize: 'var(--fs-lg)', marginBottom: 12 }}>สัดส่วนรายจ่าย</h2>

      {/* stacked bar — gap 2px ระหว่าง segment, ปลายโค้งจาก container */}
      <div style={{ display: 'flex', gap: 2, height: 26, borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        {parts.map((p) => (
          <div key={p.key} style={{ width: `${p.pct}%`, background: p.color }} title={`${p.label} — ${fmtMoney(p.v)} ฿ (${p.pct.toFixed(1)}%)`} />
        ))}
      </div>

      {/* legend + direct labels (identity = swatch, ตัวเลข = ink token) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginTop: 12 }}>
        {parts.map((p) => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-base)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text)' }}>{p.label}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
              {fmtMoney(p.v)} ฿ · {p.pct.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
