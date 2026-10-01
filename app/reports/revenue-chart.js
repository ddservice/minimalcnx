'use client';

import { useState } from 'react';
import { fmtMoney } from '../../lib/format';

const thShortDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });

// กราฟแท่งยอดขายสุทธิรายวัน — single series (magnitude/time) → สีเดียวไล่โทน (เขียว = รายได้ ตามธรรมเนียม
// เดียวกับการ์ด KPI ในแอป), ไม่มี legend (ซีรีส์เดียว). hover แสดง tooltip กำหนดเอง + ไฮไลต์แท่ง/คอลัมน์
export default function RevenueChart({ sales }) {
  const [hover, setHover] = useState(null); // index ที่ hover อยู่ หรือ null

  const days = (sales || [])
    .map((s) => ({ date: String(s.date), v: Number(s.net_revenue || 0) }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!days.length) return null;

  const W = 720;
  const H = 220;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const baseY = padT + plotH;

  const maxV = Math.max(...days.map((d) => d.v), 1);
  const n = days.length;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(40, slot - 2)); // gap 2px ระหว่างแท่ง
  const rx = Math.min(3, barW / 2);
  const labelEvery = n <= 16 ? 1 : Math.ceil(n / 16);

  const hoverDay = hover != null ? days[hover] : null;
  const tipW = 128;
  const tipH = 40;
  const tipX = hoverDay
    ? Math.min(Math.max(padL + hover * slot + slot / 2 - tipW / 2, padL), W - padR - tipW)
    : 0;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, background: 'var(--surface)', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-lg)' }}>ยอดขายสุทธิรายวัน</h2>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>สูงสุด {fmtMoney(maxV)} ฿</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="กราฟยอดขายสุทธิรายวัน" style={{ display: 'block', minWidth: 320, overflow: 'visible' }}>
          <defs>
            <linearGradient id="revenueBarFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a9b78" />
              <stop offset="100%" stopColor="#2e6e52" />
            </linearGradient>
            <linearGradient id="revenueBarFillHover" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5db98e" />
              <stop offset="100%" stopColor="#357a5c" />
            </linearGradient>
          </defs>

          {/* baseline (แกนจาง) */}
          <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--border)" strokeWidth="1" />

          {days.map((d, i) => {
            const h = maxV > 0 ? (d.v / maxV) * plotH : 0;
            const x = padL + i * slot + (slot - barW) / 2;
            const y = baseY - h;
            const day = Number(d.date.slice(8, 10));
            const isHover = hover === i;
            return (
              <g
                key={d.date}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h2) => (h2 === i ? null : h2))}
                onTouchStart={() => setHover(i)}
                style={{ cursor: 'pointer' }}
              >
                {/* คอลัมน์ไฮไลต์เต็มความสูงตอน hover — ช่วยลากสายตาจากแท่งไปแกนวันที่ */}
                <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="var(--taupe)" opacity={isHover ? 0.08 : 0} />
                <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx={rx} fill={isHover ? 'url(#revenueBarFillHover)' : 'url(#revenueBarFill)'}>
                  <title>{`${d.date} — ${fmtMoney(d.v)} ฿`}</title>
                </rect>
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={baseY + 15} textAnchor="middle" fontSize="10" fill={isHover ? 'var(--text)' : 'var(--muted)'} fontWeight={isHover ? 700 : 400}>
                    {day}
                  </text>
                )}
              </g>
            );
          })}

          {hoverDay && (
            <foreignObject x={tipX} y={Math.max(baseY - ((hoverDay.v / maxV) * plotH) - tipH - 10, padT)} width={tipW} height={tipH} style={{ pointerEvents: 'none' }}>
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  background: 'var(--coffee)', color: '#fff', borderRadius: 8, padding: '6px 10px',
                  fontSize: 'var(--fs-xs)', lineHeight: 1.4, boxShadow: 'var(--shadow-md)', textAlign: 'center',
                }}
              >
                <div style={{ opacity: 0.8 }}>{thShortDate(hoverDay.date)}</div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>{fmtMoney(hoverDay.v)} ฿</div>
              </div>
            </foreignObject>
          )}
        </svg>
        </div>
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 4 }}>วันที่ในเดือน · เลื่อนชี้ที่แท่งเพื่อดูยอด</div>
    </div>
  );
}
