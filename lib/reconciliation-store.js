export async function readClosing(supabase, date) {
  const { data, error } = await supabase.rpc('sales_closing_state', { p_date: date });
  if (!error) return { ready: true, closing: data?.closing || null, stale: !!data?.stale };
  if (error.code === 'PGRST202' || error.code === '42883') return { ready: false };
  return { ready: false, error: 'เปิดข้อมูลปิดร้านไม่ได้ กรุณาลองใหม่' };
}
export async function readSettlements(supabase, month) {
  const { data, error } = await supabase.rpc('platform_reconciliation_state', { p_month: `${month}-01` });
  if (!error) return { ready: true, rows: data || [] };
  if (error.code === 'PGRST202' || error.code === '42883') return { ready: false, rows: [] };
  return { ready: false, rows: [], error: 'เปิดใบสรุปไม่ได้ กรุณาลองใหม่' };
}
