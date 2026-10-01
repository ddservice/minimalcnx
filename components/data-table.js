// ตารางข้อมูลแบบ responsive — เดสก์ท็อปเป็นตารางปกติ, มือถือแปลงเป็นการ์ดวางซ้อน
// อัตโนมัติด้วย CSS ล้วน (ไม่ใช้ JS ตรวจ breakpoint) — ดู .rtable ใน globals.css
//
// columns: [{ key, label, align: 'left'|'right', render?: (row) => node }]
// rows: array of objects; ต้องมี rowKey(row) คืนค่า unique key
export default function DataTable({ columns, rows, rowKey, emptyText = 'ไม่มีข้อมูล' }) {
  if (!rows?.length) {
    return <p className="muted" style={{ fontSize: 'var(--fs-base)', margin: 0 }}>{emptyText}</p>;
  }
  return (
    <div className="rtable-wrap">
      <table className="rtable">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} data-align={c.align === 'right' ? 'right' : undefined}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} data-label={c.label} data-align={c.align === 'right' ? 'right' : undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
