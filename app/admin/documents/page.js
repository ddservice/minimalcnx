import { redirect } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import AppShell from '../../../components/app-shell';
import PageHeader from '../../../components/page-header';
import DocumentsClient from './documents-client';

function todayISO() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function DocumentsPage() {
  const { supabase, role, name, isAdmin, allowed } = await requireSession();
  if (role !== 'admin' && role !== 'co-admin') redirect('/dashboard');

  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, category, title, owner_label, doc_date, expires_at, note, file_name, mime_type, size_bytes, created_at')
    .order('created_at', { ascending: false });

  return (
    <AppShell role={role} name={name} isAdmin={isAdmin} allowed={allowed}>
      <PageHeader icon="ti-file-invoice" title="เอกสารของร้าน" />
      {error ? (
        <div className="card">
          <div className="card-body">
            <strong>ยังใช้หน้านี้ไม่ได้</strong>
            <p className="muted" style={{ fontSize: 'var(--fs-base)', marginTop: 6 }}>
              ยังไม่ได้รัน <code>sql/add_documents.sql</code> ใน Supabase SQL Editor (สร้างตารางและที่เก็บไฟล์แบบปิด) — รันแล้วโหลดหน้านี้ใหม่
            </p>
          </div>
        </div>
      ) : (
        <DocumentsClient docs={docs || []} today={todayISO()} />
      )}
    </AppShell>
  );
}
