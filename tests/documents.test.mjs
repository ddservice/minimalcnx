// คลังเอกสาร — วันหมดอายุและการตรวจ path ของไฟล์ (path ผิด = ผูกแถวกับไฟล์ที่ไม่ควรเข้าถึง)
import test from 'node:test';
import assert from 'node:assert/strict';
import { expiryStatus, isValidDocPath, docExt } from '../lib/documents.js';

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

test('วันหมดอายุ: ไม่มีวัน / เลยแล้ว / ใกล้หมด / ยังอีกนาน', () => {
  assert.deepEqual(expiryStatus('', '2026-10-12'), { state: 'none', days: null });
  assert.deepEqual(expiryStatus(null, '2026-10-12'), { state: 'none', days: null });
  assert.deepEqual(expiryStatus('2026-10-11', '2026-10-12'), { state: 'expired', days: -1 });
  assert.deepEqual(expiryStatus('2026-10-12', '2026-10-12'), { state: 'soon', days: 0 });
  assert.deepEqual(expiryStatus('2026-12-11', '2026-10-12'), { state: 'soon', days: 60 });
  assert.deepEqual(expiryStatus('2026-12-12', '2026-10-12'), { state: 'ok', days: 61 });
});

test('วันหมดอายุข้ามปีนับวันถูก', () => {
  assert.equal(expiryStatus('2027-01-01', '2026-12-31').days, 1);
});

test('path ต้องเป็น {หมวด}/{uuid}.{นามสกุลที่ยอมรับ} และหมวดต้องตรงกัน', () => {
  assert.equal(isValidDocPath(`landlord/${UUID}.pdf`, 'landlord'), true);
  assert.equal(isValidDocPath(`employee/${UUID}.jpg`, 'employee'), true);
  assert.equal(isValidDocPath(`employee/${UUID}.jpg`, 'landlord'), false);   // หมวดไม่ตรง
  assert.equal(isValidDocPath(`landlord/../${UUID}.pdf`, 'landlord'), false); // ไต่ path
  assert.equal(isValidDocPath(`landlord/${UUID}.exe`, 'landlord'), false);
  assert.equal(isValidDocPath(`landlord/contract.pdf`, 'landlord'), false);
  assert.equal(isValidDocPath(`secret/${UUID}.pdf`, 'secret'), false);        // หมวดที่ไม่มี
  assert.equal(isValidDocPath('', 'landlord'), false);
});

test('นามสกุลไฟล์: รับเฉพาะรูปและ PDF ไม่สนตัวพิมพ์', () => {
  assert.equal(docExt('สัญญาเช่า.PDF'), 'pdf');
  assert.equal(docExt('IMG_0012.HEIC'), 'heic');
  assert.equal(docExt('card.jpeg'), 'jpeg');
  assert.equal(docExt('virus.exe'), '');
  assert.equal(docExt('noext'), '');
});
