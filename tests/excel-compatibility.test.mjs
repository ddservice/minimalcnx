import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

test('XLSX round trip preserves Thai text, satang, formulas and dates', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ยอดขายทดสอบ');
  const date = new Date('2026-11-18T00:00:00.000Z');
  sheet.addRow(['รายการ', 'ยอดเงิน', 'วันที่']);
  sheet.addRow(['กาแฟ, เชียงใหม่', 1234.56, date]);
  sheet.getCell('B2').numFmt = '#,##0.00';
  sheet.getCell('C2').numFmt = 'yyyy-mm-dd';
  sheet.getCell('B3').value = { formula: 'SUM(B2:B2)', result: 1234.56 };

  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(await workbook.xlsx.writeBuffer());
  const result = restored.getWorksheet('ยอดขายทดสอบ');
  assert.equal(result.getCell('A2').value, 'กาแฟ, เชียงใหม่');
  assert.equal(result.getCell('B2').value, 1234.56);
  assert.equal(result.getCell('B2').numFmt, '#,##0.00');
  assert.equal(result.getCell('C2').value.toISOString(), date.toISOString());
  assert.deepEqual(result.getCell('B3').value, { formula: 'SUM(B2:B2)', result: 1234.56 });
});

test('extended conditional formatting generates UUIDs with the patched dependency', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Formatting');
  sheet.addRows([[10], [20], [30]]);
  sheet.addConditionalFormatting({
    ref: 'A1:A3',
    rules: [{
      type: 'iconSet',
      iconSet: '3Stars',
      cfvo: [
        { type: 'percent', value: 0 },
        { type: 'percent', value: 33 },
        { type: 'percent', value: 67 },
      ],
    }],
  });

  const buffer = await workbook.xlsx.writeBuffer();
  assert.match(sheet.conditionalFormattings[0].rules[0].x14Id,
    /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(buffer);
  const rule = restored.getWorksheet('Formatting').conditionalFormattings[0].rules[0];
  assert.equal(rule.iconSet, '3Stars');
  assert.equal(rule.cfvo.length, 3);
});

test('streaming XLSX export produces a readable workbook with Thai sales data', async () => {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    useStyles: true,
    useSharedStrings: true,
  });
  const sheet = workbook.addWorksheet('รายงาน');
  sheet.addRow(['รายการ', 'ยอดขาย']).commit();
  sheet.addRow(['อเมริกาโน่', 100.25]).commit();
  await workbook.commit();

  const restored = new ExcelJS.Workbook();
  await restored.xlsx.load(workbook.stream.read());
  assert.equal(restored.getWorksheet('รายงาน').getCell('A2').value, 'อเมริกาโน่');
  assert.equal(restored.getWorksheet('รายงาน').getCell('B2').value, 100.25);
});
