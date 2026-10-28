"""Isolated PostgreSQL checks; never connect to a shop database.
Run on a Docker host: python3 scripts/verify-bakery-access.py
Uses the already available postgres:17-alpine image, no published ports or host volumes.
"""
import json
import pathlib
import subprocess
import time
import uuid

container = 'minimalcnx-bakery-check-' + uuid.uuid4().hex[:8]
root = pathlib.Path(__file__).resolve().parents[1]
fixture = """
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated;
create table profiles(id uuid primary key,role text,is_active boolean default true);
insert into profiles values ('00000000-0000-0000-0000-000000000001','admin',true),('00000000-0000-0000-0000-000000000002','co-admin',true),('00000000-0000-0000-0000-000000000003','staff',true),('00000000-0000-0000-0000-000000000004','admin',false);
create function fn_page_cap(text,text default 'view') returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.page_access',true),''),'true')::boolean $$;
create table expenses(id uuid primary key default gen_random_uuid(),date date not null,category text,subcategory text,item_name text,unit text,quantity numeric,unit_price numeric,total_amount numeric,payment_method text,recorded_by uuid,note text);
grant select,insert,update,delete on expenses to authenticated;
create table audit_test(id bigserial,table_name text,action text);
create function fn_audit_log() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.audit_test(table_name,action)values(tg_table_name,tg_op);return coalesce(new,old);end $$;
"""

def command(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, timeout=40, **kwargs)

def sql(query, role='postgres', user=1, allow=True):
    prefix = '' if role == 'postgres' else f"set role {role};set request.jwt.claim.sub='00000000-0000-0000-0000-{user:012d}';"
    result = command(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], input=prefix + query)
    if (result.returncode == 0) != allow:
        raise AssertionError(f'Unexpected SQL result: {result.stdout} {result.stderr}')
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ''

passed = 0
def check(label, query, role='authenticated', user=1, expected=None, allow=True):
    global passed
    result = sql(query, role, user, allow)
    if expected is not None:
        assert result == str(expected), (label, result, expected)
    passed += 1
    print('PASS', label, flush=True)

bill = {'supplier': 'Queen', 'invoice_no': 'TEST-01', 'received_on': '2026-01-01', 'discount_pct': 25,
        'expected_total': 52.50, 'lines': [{'name': 'ครัวซอง', 'unit': 'ชิ้น', 'quantity': 2, 'unit_price': 35}]}
def save(data, version=0):
    return "select bakery_save_invoice('" + json.dumps(data, ensure_ascii=False).replace("'", "''") + f"'::jsonb,{version});"

try:
    result = command(['docker', 'run', '-d', '--name', container, '--network', 'none', '--memory', '256m', '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql/data:rw,size=128m', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    assert result.returncode == 0, result.stderr
    for _ in range(30):
        if command(['docker', 'exec', container, 'pg_isready', '-U', 'postgres']).returncode == 0:
            break
        time.sleep(0.3)
    sql(fixture)
    migration = (root / 'sql/add_bakery_cost_review.sql').read_text(encoding='utf-8')
    sql(migration)
    sql(migration)  # Reapplication must preserve data and boundaries.
    check('anonymous RPC denied', save(bill), role='anon', allow=False)
    check('staff RPC denied', save(bill), user=3, allow=False)
    check('inactive administrator denied', save(bill), user=4, allow=False)
    check('page permission denied', "set test.page_access='false';" + save(bill), allow=False)
    check('direct table insert denied', "insert into bakery_invoices(supplier) values('Queen')", allow=False)
    inv = sql(save(bill), 'authenticated')
    check('draft creates no official expense', 'select count(*) from expenses', expected=0)
    check('duplicate invoice denied', save(bill), allow=False)
    check('stale edit denied', save({**bill, 'id': inv}, 0), allow=False)
    check('post creates exactly one expense', f"select bakery_change_invoice('{inv}',1,'post');select total_amount from expenses", expected='52.50')
    check('repeated post denied', f"select bakery_change_invoice('{inv}',1,'post')", allow=False)
    check('linked expense direct edit denied', 'update expenses set total_amount=1', allow=False)
    check('linked expense direct delete denied', 'delete from expenses', allow=False)
    check('posted invoice edit denied', save({**bill, 'id': inv}, 2), allow=False)
    check('staff cannot see invoices', 'select count(*) from bakery_invoices', user=3, expected=0)
    check('co-admin can read invoices', 'select count(*) from bakery_invoices', user=2, expected=1)
    check('void needs reason', f"select bakery_change_invoice('{inv}',2,'void','')", allow=False)
    check('void removes linked expense atomically', f"select bakery_change_invoice('{inv}',2,'void','wrong document');select count(*) from expenses", expected=0)
    check('reopen preserves invoice identity', f"select bakery_change_invoice('{inv}',3,'reopen');select status from bakery_invoices", expected='draft')
    bad = {**bill, 'invoice_no': 'TEST-02', 'expected_total': 999}
    inv2 = sql(save(bad), 'authenticated')
    check('mismatched printed total cannot post', f"select bakery_change_invoice('{inv2}',1,'post')", allow=False)
    check('NaN prices rejected', save({**bill, 'invoice_no': 'TEST-03', 'lines': [{'name': 'x', 'unit': 'ชิ้น', 'quantity': 1, 'unit_price': 'NaN'}]}), allow=False)
    check('future receipt rejected', save({**bill, 'invoice_no': 'TEST-04', 'received_on': '2099-01-01'}), allow=False)
    check('mapping factor requires positive value', "select bakery_save_mapping('x','Queen','x',0)", allow=False)
    check('valid confirmed mapping accepted', "select bakery_save_mapping('x','Queen','x',0.25);select factor from bakery_item_mappings", expected='0.2500')
    rows = json.dumps([{'date': '2026-01-01', 'name': 'ครัวซอง', 'key': 'ครัวซอง', 'quantity': 1, 'revenue': 50, 'receipt': 'TEST'}], ensure_ascii=False)
    pos = f"select bakery_save_pos('2026-01','{rows}'::jsonb,'{'a'*64}','test.xlsx','แม่ริม',0);"
    check('POS saved separately from sales', pos + 'select count(*) from bakery_pos_imports', expected=1)
    check('renamed duplicate POS denied', pos.replace('test.xlsx','renamed.xlsx').replace("'แม่ริม',0", "'แม่ริม',1"), allow=False)
    check('stale POS replacement denied', pos.replace('a'*64,'b'*64), allow=False)
    check('invalid POS date denied', pos.replace('2026-01-01','1970-01-01').replace('a'*64,'c'*64).replace("'แม่ริม',0", "'แม่ริม',1"), allow=False)
    sql("insert into expenses(date,category,total_amount) values('2026-01-01','ต้นทุนขนมหน้าร้าน',20)")
    check('legacy expense blocks double accounting', f"select bakery_change_invoice('{inv}',4,'post')", allow=False)
    check('audit exists', 'select count(*)>0 from audit_test', role='postgres', expected='t')
    print(f'{passed} isolated PostgreSQL checks passed', flush=True)
finally:
    command(['docker', 'rm', '-f', container])
