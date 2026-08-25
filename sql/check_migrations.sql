-- ================================================================
-- check_migrations.sql — เช็คว่า SQL ไฟล์ไหนถูกรันบน Supabase ไปแล้วบ้าง
-- อ่านอย่างเดียว ไม่แก้อะไร รันซ้ำได้ตลอด (วางใน SQL Editor แล้วกด Run)
-- true = รันแล้ว / false = ยังไม่ได้รัน
-- ================================================================
select
  exists (select 1 from pg_trigger where tgname = 'tr_profiles_guard_self_update')          as harden_security,
  (select column_name is not null from information_schema.columns
     where table_schema = 'public' and table_name = 'audit_log'
       and column_name = 'ip_address')                                                       as add_audit_context,
  (to_regclass('public.branches')        is not null)                                        as add_loyalty_system,
  exists (select 1 from pg_trigger where tgname = 'tr_customers_guard_points')               as harden_loyalty_rls,
  (to_regprocedure('public.loyalty_void_transaction(uuid,text)') is not null)                 as harden_loyalty_writes,
  exists (select 1 from pg_indexes where schemaname = 'public'
            and indexname = 'idx_point_tx_created_at')                                       as add_loyalty_indexes,
  (to_regprocedure('public.fn_can_loyalty_staff()') is not null)                              as harden_loyalty_reads,
  (to_regclass('public.loyalty_rewards') is not null)                                        as add_loyalty_rewards,
  exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'customers'
              and column_name = 'privacy_consent_at')                                        as add_customer_privacy_consent,
  (to_regprocedure('public.get_months_kpis(text[])') is not null)                             as add_analytics_range_kpis,
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'expenses'
            and policyname = 'expenses: delete manager+')                                    as fix_bugs,
  exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'sales_daily'
              and column_name = 'free_cup_evidence_url')                                     as add_free_cup_actual_cost,
  (to_regprocedure('public.loyalty_redeem_reward(uuid,text,uuid)') is not null)               as harden_loyalty_integrity,
  -- แยกดูเฉพาะ index ใบเสร็จซ้ำ: ถ้า harden_loyalty_integrity = true แต่ช่องนี้ = false
  -- แปลว่าตอนรันมีใบเสร็จซ้ำค้างอยู่ ไฟล์เลยข้ามการสร้าง index ให้ (ดู NOTICE ตอนรัน)
  exists (select 1 from pg_indexes where schemaname = 'public'
            and indexname = 'uidx_point_tx_earn_receipt')                                    as receipt_unique_index;
