'use client';
import Icon from '../../components/icon';

import { useState } from 'react';
import { fmtMoney } from '../../lib/format';

// กราฟกำไร/ขาดทุนรายเดือน — แท่งบวกขึ้น (เขียว) / ลบลง (แดง) จากเส้นศูนย์กลาง
// เดือนที่ยังไม่มีข้อมูล (ยังไม่ถึง หรือยังไม่ได้บันทึก) แสดงเป็นแท่งเทาบางๆ ที่เส้นศูนย์ — ไม่ตัดออก
// เพื่อให้จำนวนแท่งคงที่ตามช่วงที่เลือกเสมอ (ไม่ใช่แค่เท่าที่มีข้อมูล ซึ่งทำให้กราฟยืด/หดรูปร่างเปลี่ยนทุกเดือน)
export default function ProfitChart({ data }) {
  const [hover, setHover] = useState(null);

  const rows = data || [];
  if (!rows.length) return null;

  const W = 720, H = 240, padL = 10, padR = 10, padT = 16, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const half = plotH / 2;
  const zeroY = padT + half;
  const maxAbs = Math.max(...rows.filter((d) => d.hasData).map((d) => Math.abs(d.profit)), 1);
  const n = rows.length;
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(40, slot - 8));
  const rx = Math.min(3, barW / 2);

  const hoverRow = hover != null ? rows[hover] : null;
  const tipW = 132;
  const tipH = 42;
  const tipX = hoverRow
    ? Math.min(Math.max(padL + hover * slot + slot / 2 - tipW / 2, padL), W - padR - tipW)
    : 0;
  const hoverH = hoverRow?.hasData ? (Math.abs(hoverRow.profit) / maxAbs) * (half - 4) : 0;
  const tipY = hoverRow
    ? (hoverRow.hasData && hoverRow.profit < 0 ? zeroY + hoverH + 10 : Math.max(zeroY - hoverH - tipH - 10, padT))
    : 0;

  return (
    <div className="card">
      <div className="card-head"><Icon name="ti-chart-line" /><h2>แนวโน้มกำไร/ขาดทุนรายเดือน</h2></div>
      <div className="card-body" style={{ overflowX: 'auto' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="กราฟกำไรขาดทุนรายเดือน" style={{ display: 'block', minWidth: 320, overflow: 'visible' }}>
            <defs>
              <linearGradient id="profitBarUp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#4a9b78" />
                <stop offset="100%" stopColor="#2e6e52" />
              </linearGradient>
              <linearGradient id="profitBarUpHover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5db98e" />
                <stop offset="100%" stopColor="#357a5c" />
              </linearGradient>
              <linearGradient id="profitBarDown" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#c14f41" />
                <stop offset="100%" stopColor="#b23a2e" />
              </linearGradient>
              <linearGradient id="profitBarDownHover" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#d4685a" />
                <stop offset="100%" stopColor="#c14a3d" />
              </linearGradient>
            </defs>

            <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--border)" strokeWidth="1" />

            {rows.map((d, i) => {
              const x = padL + i * slot + (slot - barW) / 2;
              const isHover = hover === i;
              const mm = d.label.slice(0, 2);

              if (!d.hasData) {
                return (
                  <g
                    key={d.label}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover((h2) => (h2 === i ? null : h2))}
                    onTouchStart={() => setHover(i)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="var(--taupe)" opacity={isHover ? 0.06 : 0} />
                    <rect x={x} y={zeroY - 1.5} width={barW} height={3} rx={1.5} fill="var(--border)" />
                    <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize="10" fill={isHover ? 'var(--text)' : 'var(--muted)'}>{mm}</text>
                  </g>
                );
              }

              const h = (Math.abs(d.profit) / maxAbs) * (half - 4);
              const y = d.profit >= 0 ? zeroY - h : zeroY;
              const up = d.profit >= 0;
              const fill = isHover ? (up ? 'url(#profitBarUpHover)' : 'url(#profitBarDownHover)') : (up ? 'url(#profitBarUp)' : 'url(#profitBarDown)');
              return (
                <g
                  key={d.label}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover((h2) => (h2 === i ? null : h2))}
                  onTouchStart={() => setHover(i)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="var(--taupe)" opacity={isHover ? 0.06 : 0} />
                  <rect x={x} y={y} width={barW} height={Math.max(h, 0.5)} rx={rx} fill={fill} />
                  <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize="10" fill={isHover ? 'var(--text)' : 'var(--muted)'} fontWeight={isHover ? 700 : 400}>{mm}</text>
                </g>
              );
            })}

            {hoverRow && (
              <foreignObject x={tipX} y={tipY} width={tipW} height={tipH} style={{ pointerEvents: 'none' }}>
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{
                    background: 'var(--coffee)', color: '#fff', borderRadius: 8, padding: '6px 10px',
                    fontSize: 'var(--fs-xs)', lineHeight: 1.4, boxShadow: 'var(--shadow-md)', textAlign: 'center',
                  }}
                >
                  <div style={{ opacity: 0.8 }}>{hoverRow.label}</div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                    {hoverRow.hasData ? `${hoverRow.profit >= 0 ? 'กำไร' : 'ขาดทุน'} ${fmtMoney(hoverRow.profit)} ฿` : 'ยังไม่มีข้อมูล'}
                  </div>
                </div>
              </foreignObject>
            )}
          </svg>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginTop: 4 }}>เดือน (MM) · เลื่อนชี้ที่แท่งเพื่อดูยอด</div>
      </div>
    </div>
  );
}
