'use client';
import Icon from './icon';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './sidebar';

const ROLE_LABEL = { admin: 'Admin', 'co-admin': 'Co-Admin', manager: 'Manager', staff: 'Staff', loyalty_staff: 'Loyalty' };

// เปลือกหน้าจอมาตรฐาน: sidebar (rail ยุบได้บนเดสก์ท็อป / drawer บนมือถือ) + เนื้อหาหลัก
// .mobile-topbar อยู่ "ข้างใน" .shell-main (ไม่ใช่ sibling ของ .sidebar) เพื่อให้ column-flex
// ของ .shell-main จัดเรียงมันไว้เหนือเนื้อหาเสมอ โดยไม่ต้องพึ่ง flex-wrap ของ .shell แม่ ซึ่งบน Safari
// จริงพบว่าไม่ยอมขึ้นบรรทัดใหม่ให้ ทำให้เนื้อหาเพจถูกบีบแคบจนตัวเลขล้นจอ
export default function AppShell({ name, role, isAdmin, allowed, children }) {
  const path = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [path]);

  return (
    <div className="shell">
      <Sidebar name={name} role={role} isAdmin={isAdmin} allowed={allowed} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <div className="shell-main">
        <div className="mobile-topbar">
          <button type="button" className="mobile-topbar-btn" onClick={() => setMobileOpen(true)} aria-label="เปิดเมนู">
            <Icon name="ti-menu-2" />
          </button>
          <div className="brand-icon sidebar-brand-icon" style={{ width: 30, height: 30, fontSize: 'var(--fs-lg)' }}><Icon name="ti-coffee" /></div>
          <strong style={{ fontSize: 'var(--fs-md)' }}>Minimal Maerim</strong>
        </div>

        {/* บริบทผู้ใช้งานที่มองเห็นได้แม้ sidebar จะถูกยุบเป็นแบบไอคอนอย่างเดียว (ตอนนั้นชื่อใน sidebar จะถูกซ่อน) */}
        <div className="desktop-topbar">
          <span className="desktop-topbar-brand">Minimal Maerim</span>
          <div className="desktop-topbar-user">
            <span className="desktop-topbar-avatar">{(name || '?').charAt(0).toUpperCase()}</span>
            <span className="desktop-topbar-name">
              {name}
              <small>{role ? ROLE_LABEL[role] || role : ''}</small>
            </span>
          </div>
        </div>
        <div className="shell-container">{children}</div>
      </div>
    </div>
  );
}
