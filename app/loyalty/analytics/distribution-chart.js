'use client';

import { fmtMoney } from '../../../lib/format';

export default function PointDistributionChart({ branchMetrics = [] }) {
  if (!branchMetrics.length) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 'var(--fs-base)' }}>
        ยังไม่มีข้อมูลการออกแต้มแยกตามสาขา
      </div>
    );
  }

  const maxVal = Math.max(...branchMetrics.map((b) => Math.max(b.issued, b.redeemed)), 10);
  const W = 600, H = 200, padL = 40, padR = 20, padT = 20, padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slotW = plotW / branchMetrics.length;
  const groupW = Math.min(60, slotW * 0.7);
  const barW = groupW / 2 - 2;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="กราฟเปรียบเทียบแต้มแยกตามสาขา" style={{ minWidth: 320 }}>
        {/* เส้น Grid */}
        <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="var(--border)" strokeDasharray="3 3" opacity={0.5} />
        <line x1={padL} y1={padT + plotH / 2} x2={padL + plotW} y2={padT + plotH / 2} stroke="var(--border)" strokeDasharray="3 3" opacity={0.5} />
        <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="var(--border)" strokeWidth="1" />

        {branchMetrics.map((b, i) => {
          const groupX = padL + i * slotW + (slotW - groupW) / 2;
          const issuedH = (b.issued / maxVal) * plotH;
          const redeemedH = (b.redeemed / maxVal) * plotH;

          return (
            <g key={b.name}>
              {/* แท่งแจกแต้ม (Earned - สีเขียว) */}
              <rect
                x={groupX}
                y={padT + plotH - issuedH}
                width={barW}
                height={Math.max(issuedH, 1)}
                rx={3}
                fill="#16a34a"
              />
              <text
                x={groupX + barW / 2}
                y={padT + plotH - issuedH - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#16a34a"
                fontWeight="700"
              >
                {b.issued}
              </text>

              {/* แท่งแลกแต้ม (Redeemed - สีส้ม) */}
              <rect
                x={groupX + barW + 4}
                y={padT + plotH - redeemedH}
                width={barW}
                height={Math.max(redeemedH, 1)}
                rx={3}
                fill="#ea580c"
              />
              <text
                x={groupX + barW + 4 + barW / 2}
                y={padT + plotH - redeemedH - 4}
                textAnchor="middle"
                fontSize="9"
                fill="#ea580c"
                fontWeight="700"
              >
                {b.redeemed}
              </text>

              {/* ชื่อสาขา */}
              <text
                x={groupX + groupW / 2}
                y={H - 12}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text)"
                fontWeight="600"
              >
                {b.name.length > 10 ? `${b.name.slice(0, 10)}...` : b.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 'var(--fs-sm)', marginTop: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#16a34a' }} /> แจกแต้ม (Earned)</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#ea580c' }} /> แลดแต้ม (Redeemed)</span>
      </div>
    </div>
  );
}
