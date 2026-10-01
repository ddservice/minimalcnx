'use client';
import Icon from '../../components/icon';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import DateField from '../../components/date-field';
import { stripDigits, digitsOnly } from '../../lib/format';
import { saveForm50Payees } from './actions';

const fmt = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayISO = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

const ITEMS = [
  { id: 'rent', label: 'ค่าเช่าร้าน', rate: 0.05, rateLabel: '5%', incomeType: 'เงินได้ตามมาตรา 40(5) ก. ค่าเช่า' },
  { id: 'staff_sub', label: 'ค่าพนักงานแทน (รับเหมา)', rate: 0.03, rateLabel: '3%', incomeType: 'เงินได้ตามมาตรา 40(2) ค่าจ้าง / ค่าบริการ' },
];

// จำนวนเงินเป็นตัวอักษร (รองรับ ≤ 999,999.99 — เพียงพอสำหรับ WHT)
function bahtText(num) {
  const t = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const p = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const conv = (s) => {
    let out = '';
    const len = s.length;
    for (let i = 0; i < len; i++) {
      const d = +s[i];
      const place = len - i - 1;
      if (d === 0) continue;
      if (place === 1 && d === 1) out += 'สิบ';
      else if (place === 1 && d === 2) out += 'ยี่สิบ';
      else if (place === 0 && d === 1 && len > 1) out += 'เอ็ด';
      else out += t[d] + p[place];
    }
    return out;
  };
  const n = Math.round((Number(num) || 0) * 100) / 100;
  const [ip, dp] = n.toFixed(2).split('.');
  let s = (+ip === 0 ? 'ศูนย์' : conv(ip)) + 'บาท';
  s += dp === '00' ? 'ถ้วน' : conv(dp) + 'สตางค์';
  return s;
}

export default function Form50({ amounts, payees, bizInfo, monthLabel, canEdit = false, isAdmin = false }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState(null);
  const [state, setState] = useState(() => {
    const s = {};
    ITEMS.forEach((it) => {
      const pv = payees?.[it.id] || {};
      s[it.id] = { name: pv.name || '', taxid: pv.taxid || '', addr: pv.addr || '', date: pv.date || '', cond: pv.cond || '1' };
    });
    return s;
  });

  const set = (id, k, v) => setState((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));

  async function onSave() {
    setMsg(null);
    const res = await saveForm50Payees(state);
    setMsg({ text: res.message, type: res.status === 'ok' ? 'ok' : 'err' });
    if (res.status === 'ok') startTransition(() => router.refresh());
  }

  function print(it) {
    const amt = Number(amounts?.[it.id]) || 0;
    if (amt <= 0) { setMsg({ text: `ยังไม่มียอด${it.label}ในเดือนนี้ (บันทึกค่าดำเนินการก่อน)`, type: 'err' }); return; }
    const pv = state[it.id];
    const wht = Math.round(amt * it.rate);
    const biz = bizInfo || {};
    const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cond = { '1': 'หัก ณ ที่จ่าย', '2': 'ออกภาษีให้ครั้งเดียว', '3': 'ออกภาษีให้ตลอดไป' }[pv.cond] || 'หัก ณ ที่จ่าย';
    // ไม่ต้องเลือกวันทุกครั้ง — ใช้วันที่พิมพ์จริงเป็นค่าเริ่มต้นเสมอ เว้นแต่ admin ตั้งวันที่ตายตัวไว้ (pv.date)
    const printDate = new Date(`${pv.date || todayISO()}T00:00:00`).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const html = `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>50 ทวิ ${esc(it.label)} ${esc(monthLabel)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Sarabun','Segoe UI',sans-serif;font-size:13px;color:#000;padding:30px 40px;max-width:720px;margin:0 auto;line-height:1.6}
  h1{font-size:15px;text-align:center;font-weight:700}
  .sub{text-align:center;font-size:12px;margin-bottom:16px}
  .box{border:1px solid #000;padding:10px 12px;margin-bottom:10px}
  .lab{font-weight:700;font-size:12px;margin-bottom:2px}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  th,td{border:1px solid #000;padding:7px 10px;font-size:12px}
  .num{text-align:right}
  .foot{display:flex;justify-content:space-between;margin-top:36px}
  .sign{text-align:center;width:45%}
  .sign .l{border-top:1px solid #000;margin-top:34px;padding-top:4px}
  @media print{body{padding:8px}}
</style></head><body>
  <h1>หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
  <div class="sub">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
  <div class="box">
    <div class="lab">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ผู้จ่ายเงิน)</div>
    <div>${esc(biz.name || '—')} &nbsp; เลขประจำตัวผู้เสียภาษี ${esc(biz.tax_id || '—')}</div>
    <div>${esc(biz.address || '')}</div>
  </div>
  <div class="box">
    <div class="lab">ผู้ถูกหักภาษี ณ ที่จ่าย (ผู้รับเงิน)</div>
    <div>${esc(pv.name || '—')} &nbsp; เลขประจำตัวผู้เสียภาษี/บัตรประชาชน ${esc(pv.taxid || '—')}</div>
    <div>${esc(pv.addr || '')}</div>
  </div>
  <table>
    <tr><th style="width:46%">ประเภทเงินได้พึงประเมินที่จ่าย</th><th style="width:20%">วันเดือนปีที่จ่าย</th><th class="num">จำนวนเงินที่จ่าย</th><th class="num">ภาษีที่หัก (${it.rateLabel})</th></tr>
    <tr><td>${esc(it.incomeType)}</td><td>${esc(printDate)}</td><td class="num">${fmt(amt)}</td><td class="num">${fmt(wht)}</td></tr>
    <tr><td colspan="2" style="text-align:right;font-weight:700">รวมเงินภาษีที่หักนำส่ง</td><td class="num"></td><td class="num" style="font-weight:700">${fmt(wht)}</td></tr>
    <tr><td colspan="4">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) — <b>${bahtText(wht)}</b></td></tr>
  </table>
  <div>ผู้จ่ายเงิน: (${esc(pv.cond || '1')}) ${esc(cond)}</div>
  <div class="foot">
    <div class="sign"><div class="l">ผู้รับเงิน / ผู้ถูกหักภาษี</div></div>
    <div class="sign"><div class="l">ผู้จ่ายเงิน / ผู้มีหน้าที่หักภาษี</div></div>
  </div>
</body></html>`;
    const w = window.open('', '_blank', 'width=780,height=920');
    if (!w) { setMsg({ text: 'เบราว์เซอร์บล็อกป๊อปอัป — โปรดอนุญาต', type: 'err' }); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => w.print(), 400);
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-head"><Icon name="ti-file-invoice" /><h2>หนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</h2></div>
      <div className="card-body">
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: -4, marginBottom: 14 }}>
          ออกให้ผู้รับเงิน (เจ้าของที่เช่า / ผู้รับเหมา) — ยอดดึงจากที่บันทึกในเดือน {monthLabel}
        </p>
        {ITEMS.map((it) => {
          const amt = Number(amounts?.[it.id]) || 0;
          const wht = Math.round(amt * it.rate);
          const pv = state[it.id];
          return (
            <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14, marginBottom: 12, background: 'var(--beige)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 'var(--fs-md)' }}>{it.label} — หัก ณ ที่จ่าย {it.rateLabel}</strong>
                <span style={{ fontSize: 'var(--fs-base)', color: 'var(--muted)' }}>ยอด {fmt(amt)} · หัก <strong style={{ color: 'var(--danger)' }}>{fmt(wht)}</strong> ฿</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                <input className="input" disabled={!canEdit} placeholder="ชื่อผู้รับเงิน" value={pv.name} onChange={(e) => set(it.id, 'name', stripDigits(e.target.value))} />
                <input className="input" disabled={!canEdit} placeholder="เลขผู้เสียภาษี/บัตรปชช." value={pv.taxid} onChange={(e) => set(it.id, 'taxid', digitsOnly(e.target.value))} />
                <input className="input" disabled={!canEdit} style={{ gridColumn: '1 / -1' }} placeholder="ที่อยู่ผู้รับเงิน" value={pv.addr} onChange={(e) => set(it.id, 'addr', e.target.value)} />
                <select className="input" disabled={!canEdit} value={pv.cond} onChange={(e) => set(it.id, 'cond', e.target.value)}>
                  <option value="1">หัก ณ ที่จ่าย</option>
                  <option value="2">ออกภาษีให้ครั้งเดียว</option>
                  <option value="3">ออกภาษีให้ตลอดไป</option>
                </select>
              </div>
              {/* วันที่บนใบรับรองใช้วันที่พิมพ์จริงอัตโนมัติเสมอ ไม่ต้องเลือกทุกครั้ง — เฉพาะ admin
                  เท่านั้นที่ตั้งวันที่ตายตัวแทนได้ (เช่น พิมพ์ย้อนหลัง) ค่านี้จะกลายเป็นค่าเริ่มต้นถาวร
                  จนกว่าจะล้าง/เปลี่ยน (ไม่ใช่แค่ครั้งเดียว) */}
              {isAdmin && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginBottom: 4 }}>
                    ตั้งวันที่ตายตัวแทนวันพิมพ์จริง (ไม่บังคับ — เฉพาะ Admin)
                  </label>
                  <div style={{ maxWidth: 200 }}>
                    <DateField value={pv.date} onChange={(v) => set(it.id, 'date', v)} placeholder="ใช้วันที่พิมพ์จริง" />
                  </div>
                </div>
              )}
              <div style={{ marginTop: 10, textAlign: 'right' }}>
                <button type="button" className="btn btn-gold" onClick={() => print(it)}><Icon name="ti-printer" /> พิมพ์ 50 ทวิ</button>
              </div>
            </div>
          );
        })}
        {canEdit ? (
          <button type="button" className="btn btn-coffee" onClick={onSave} disabled={isPending}>
            <Icon name="ti-device-floppy" /> {isPending ? 'กำลังบันทึก...' : 'บันทึกข้อมูลผู้รับเงิน'}
          </button>
        ) : (
          <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}><Icon name="ti-lock" /> เฉพาะ Admin หรือ Co-Admin แก้ไขข้อมูลผู้รับเงินได้ (พิมพ์เอกสารได้ตามปกติ)</p>
        )}
        {msg && <div style={{ marginTop: 12, fontSize: 'var(--fs-md)', color: msg.type === 'ok' ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</div>}
      </div>
    </div>
  );
}
