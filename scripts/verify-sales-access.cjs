// Isolated PostgreSQL fixture. Install PGlite externally and set PGLITE_MODULE_PATH.
// Uses no live shop credentials or production data.
const fs=require('fs');
const {PGlite}=require(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
(async()=>{
const db=new PGlite();
try {
await db.exec(`create role authenticated; create role anon; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to authenticated,anon;
create table profiles(id uuid primary key, role text,is_active boolean default true);
create table business_config(key text primary key,value jsonb);
create function fn_my_role() returns text language sql stable security definer as $$ select role from profiles where id=auth.uid() $$;
create table sales_daily(id uuid primary key default gen_random_uuid(),date date unique,total_cups int default 0,kshop_amount numeric(12,2) default 0,cash_amount numeric(12,2) default 0,shopee_before_gp numeric(12,2) default 0,grab_before_gp numeric(12,2) default 0,lineman_before_gp numeric(12,2) default 0,free_cups int default 0,free_cup_cost numeric(12,2) default 0,pastry_pieces int default 0,pastry_revenue numeric(12,2) default 0,net_revenue numeric(12,2) default 0,free_cup_evidence_url text,recorded_by uuid,updated_at timestamptz default now());
create table expenses(id uuid primary key default gen_random_uuid(),date date,item_key text,item_name text, total_amount numeric);
create table documents(id uuid primary key default gen_random_uuid());
alter table sales_daily enable row level security; alter table expenses enable row level security; alter table business_config enable row level security;
create policy base_sales on sales_daily for all to authenticated using(true) with check(true);
create policy base_expenses on expenses for all to authenticated using(true) with check(true);
create policy base_config on business_config for all to authenticated using(true) with check(true);
grant all on sales_daily,expenses,business_config,profiles to authenticated;
create function get_monthly_summary(text) returns jsonb language plpgsql security definer as $$
begin
return '{}'::jsonb;
end $$;
create function get_months_kpis(text[]) returns jsonb language plpgsql security definer as $$
begin
return '{}'::jsonb;
end $$;
create function upsert_opex_item(jsonb) returns jsonb language plpgsql security definer as $$
begin
return '{}'::jsonb;
end $$;
insert into profiles values ('00000000-0000-0000-0000-000000000001','staff',true),('00000000-0000-0000-0000-000000000002','manager',true),('00000000-0000-0000-0000-000000000003','staff',false),('00000000-0000-0000-0000-000000000004','admin',true);
insert into business_config values('role_perms','{"staff":{"/sales":"create","/dashboard":"none","/expenses":"none","/opex":"none","/reports":"none","/analytics":"none","/settings":"none","/loyalty":"none"}}'),('emp_details','{"private":true}'),('biz_info','{}');
insert into sales_daily(date,cash_amount) values ((statement_timestamp() at time zone 'Asia/Bangkok')::date - 3, 999);
insert into expenses(date,item_name,total_amount) values (current_date,'private expense',999);
`);
const source=fs.readFileSync('sql/add_free_cup_actual_cost.sql','utf8');
await db.exec(source.slice(source.indexOf('create or replace function public.upsert_sales_daily'),source.indexOf('-- ── 3.')));
for(let n=0;n<2;n++)await db.exec(fs.readFileSync('sql/harden_sales_staff.sql','utf8'));
await db.exec(fs.readFileSync('sql/add_expense_documents.sql','utf8'));
let count=0;
async function ok(label,sql,check){const r=await db.query(sql);if(check&&!check(r.rows))throw Error('assert '+label+JSON.stringify(r.rows));count++;console.log('PASS '+label);}
async function denied(label,sql){try{await db.query(sql);}catch(e){count++;console.log('PASS '+label);return;}throw Error('NOT BLOCKED '+label);}
await db.exec("set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';");
await ok('staff sees no historical sales','select * from sales_daily',r=>r.length===0);
await ok('staff sees no expenses','select * from expenses',r=>r.length===0);
await ok('staff sees no personal config',"select * from business_config where key='emp_details'",r=>r.length===0);
await denied('staff report RPC blocked',"select get_monthly_summary('10/2026')");
await denied('staff analytics RPC blocked',"select get_months_kpis(array['10/2026'])");
await denied('staff OPEX RPC blocked',"select upsert_opex_item('{}')");
await denied('staff expenses blocked',"insert into expenses(item_name)values('blocked')");
await ok('staff config update returns no rows',"update business_config set value='{}' where key='biz_info' returning key",r=>r.length===0);
await denied('staff yesterday blocked',"insert into sales_daily(date)values((statement_timestamp() at time zone 'Asia/Bangkok')::date-1)");
await denied('staff tomorrow blocked',"insert into sales_daily(date)values((statement_timestamp() at time zone 'Asia/Bangkok')::date+1)");
const payload={total_cups:1,kshop_amount:100,cash_amount:50,shopee_before_gp:100,grab_before_gp:100,lineman_before_gp:100,free_cups:0,free_cup_cost:0,pastry_pieces:0,pastry_revenue:0,net_revenue:999999};
const json=JSON.stringify(payload);
const call="select (upsert_sales_daily('"+json+"'::jsonb || jsonb_build_object('date',(statement_timestamp() at time zone 'Asia/Bangkok')::date))).net_revenue as net";
await denied('staff yesterday RPC blocked',call.replace('::date))).net_revenue', '::date - 1))).net_revenue'));
await denied('staff tomorrow RPC blocked',call.replace('::date))).net_revenue', '::date + 1))).net_revenue'));
await ok('staff today saves with recomputed total',call,r=>Number(r[0].net)===351.56);
await denied('staff repeated RPC save blocked',call);
await denied('staff direct update blocked',"update sales_daily set cash_amount=999 where date=(statement_timestamp() at time zone 'Asia/Bangkok')::date");
await denied('staff direct delete blocked',"delete from sales_daily where date=(statement_timestamp() at time zone 'Asia/Bangkok')::date");
await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';");
await denied('inactive user blocked',call);
await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';");
await ok('manager can correct today',call,r=>Number(r[0].net)===351.56);
await ok('manager report works',"select get_monthly_summary('10/2026')");
await ok('manager correct old date',"update sales_daily set cash_amount=100 where date=(statement_timestamp() at time zone 'Asia/Bangkok')::date-3 returning id",r=>r.length===1);
await db.exec("reset role; insert into documents(expense_id) select id from expenses limit 1; set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';");
await denied('expense with attached receipt cannot be deleted',"delete from expenses");
await db.exec("reset role;");
await ok('receipt and expense retained',"select (select count(*) from expenses) as expenses,(select count(*) from documents) as docs",r=>Number(r[0].expenses)===1&&Number(r[0].docs)===1);
await denied('receipt cannot reference nonexistent expense',"insert into documents(expense_id)values('00000000-0000-0000-0000-000000000099')");
await db.exec("set role anon; set request.jwt.claim.sub='';");
await denied('anonymous RPC blocked',call);
console.log('Database checks passed: '+count);
} finally {await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
