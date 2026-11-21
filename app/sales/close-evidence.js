'use client';

import { useState } from 'react';
import { createClient } from '../../lib/supabase/client';

const bucket = 'sales-close-evidence';
const extensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export default function CloseEvidence({ date, canUpload }) {
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function loadFiles(storage) {
    const { data, error } = await storage.list(date, {
      limit: 100, sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) throw error;
    setFiles(data);
  }

  async function perform(operation, errorMessage) {
    setBusy(true);
    setMessage('');
    try {
      await operation(createClient().storage.from(bucket));
    } catch {
      setMessage(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const extension = Object.hasOwn(extensions, file.type) ? extensions[file.type] : null;
    if (!extension || file.size > 5 * 1024 * 1024 || file.size === 0) {
      setMessage('เลือกไฟล์ JPG, PNG, WebP หรือ PDF ขนาดไม่เกิน 5 MB');
      return;
    }
    await perform(async (storage) => {
      const path = `${date}/${crypto.randomUUID()}.${extension}`;
      const { error } = await storage.upload(path, file, { contentType: file.type });
      if (error) throw error;
      setFiles(null);
      setMessage('บันทึกหลักฐานแล้ว');
    }, 'บันทึกหลักฐานไม่ได้ กรุณาตรวจสิทธิ์แล้วลองอีกครั้ง');
  }

  async function download(fileName) {
    await perform(async (storage) => {
      const { data, error } = await storage.createSignedUrl(`${date}/${fileName}`, 60, { download: true });
      if (error) throw error;
      window.location.assign(data.signedUrl);
    }, 'ดาวน์โหลดหลักฐานไม่ได้ กรุณาลองอีกครั้ง');
  }

  return (
    <details>
      <summary>หลักฐานปิดร้าน</summary>
      {canUpload && (
        <label>
          แนบภาพหรือ PDF ขนาดไม่เกิน 5 MB
          <input type="file" accept={Object.keys(extensions).join(',')} disabled={busy} onChange={upload} />
        </label>
      )}
      <button type="button" disabled={busy} onClick={() => perform(loadFiles, 'เปิดรายการหลักฐานไม่ได้')}>
        ดูรายการหลักฐาน
      </button>
      {files?.length === 0 && <p>ยังไม่มีหลักฐานสำหรับวันที่เลือก</p>}
      {files?.length > 0 && (
        <ul>
          {files.map((file) => (
            <li key={file.name}>
              <button type="button" disabled={busy} onClick={() => download(file.name)}>
                ดาวน์โหลดหลักฐาน {new Date(file.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div role="status">{message}</div>
    </details>
  );
}
