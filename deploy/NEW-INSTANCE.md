# เปิดร้านใหม่บนระบบเดียวกัน (อีก instance)

โค้ดชุดเดียว (repo นี้) ติดตั้งได้หลายร้าน — **แต่ละร้านมีฐานข้อมูล Supabase ของตัวเอง ผู้ใช้ของตัวเอง
และ backup ของตัวเอง** ข้อมูลไม่ปนกัน เหมาะกับร้านที่เป็นคนละนิติบุคคล

ตัวอย่างในไฟล์นี้ใช้ร้านชื่อ `mamasaidno` — เปลี่ยนชื่อ/พอร์ต/โดเมนตามจริง

> ⚠️ ขั้นตอนนี้เขียนจากโครงสร้างระบบ **ยังไม่เคยรันจริงครบทั้งชุด** — รอบแรกให้ทำตามทีละข้อและดูผลทุกข้อ
> ถ้าข้อไหนไม่ตรงกับที่เขียน ให้หยุดแล้วแก้เอกสารนี้ก่อนไปต่อ

## สิ่งที่แยกตามร้าน / สิ่งที่ใช้ร่วม

| แยกตามร้าน | ใช้ร่วมกัน |
|---|---|
| โปรเจกต์ Supabase (ฐานข้อมูล + Auth + Storage) | โค้ดใน repo นี้ (branch `main`) |
| โฟลเดอร์บน VPS `~/apps/<slug>` + `.deploy.env` + `.backup.env` | VPS, Docker, nginx, Cloudflare |
| container / image / พอร์ต / โดเมน | bucket R2 (แยกด้วย prefix) และกุญแจ `age` |
| ผู้ใช้, สิทธิ์, ข้อมูลร้าน, เลขผู้เสียภาษี | |

## 1. สร้างโปรเจกต์ Supabase (เจ้าของทำเอง)

1. Supabase Dashboard → New project → ชื่อ `mamasaidno` → region **Southeast Asia (Singapore)**
2. Authentication → Providers → Email: **Confirm email = ปิด**, Minimum password length = **8**
3. เก็บค่าเหล่านี้ไว้: Project URL, publishable (anon) key, service_role key, connection string แบบ **Session pooler (:5432)**

## 2. สร้างโครงสร้างฐานข้อมูล

ทางที่แนะนำ: คัดลอก **เฉพาะโครงสร้าง** (ไม่มีข้อมูล) จากร้านเดิม ซึ่งเป็นโครงสร้างที่ใช้งานจริงอยู่
ดีกว่าไล่รันไฟล์ `sql/*.sql` ยี่สิบกว่าไฟล์ตามลำดับ (ลำดับผิดไฟล์เดียวฟังก์ชันจะถูกทับด้วยรุ่นเก่า)

รันบน VPS — `OLD` = ร้านเดิม, `NEW` = ร้านใหม่ (ทั้งคู่ต้องเป็น Session pooler `:5432` ไม่ใช่ `:6543`):

```bash
OLD='postgresql://postgres.<ref-เดิม>:<รหัส>@<host>:5432/postgres'
NEW='postgresql://postgres.<ref-ใหม่>:<รหัส>@<host>:5432/postgres'

# ไม่ใส่ --no-privileges โดยตั้งใจ: grant execute ... to authenticated คือสิ่งที่ทุก RPC ต้องใช้
docker run --rm postgres:17-alpine pg_dump "$OLD" --schema-only --no-owner --schema=public > /tmp/schema.sql
docker run --rm -i postgres:17-alpine psql "$NEW" -v ON_ERROR_STOP=1 < /tmp/schema.sql
shred -u /tmp/schema.sql
```

จากนั้นใน **SQL Editor ของโปรเจกต์ใหม่** รันไฟล์ที่สร้างของนอก schema `public` (ทุกไฟล์รันซ้ำได้):

1. `sql/add_free_cup_actual_cost.sql` — bucket `evidence`
2. `sql/add_documents.sql` — bucket `documents` (private)
3. `sql/add_loyalty_system.sql` — seed สาขา (ชื่อสาขาเป็นของร้านเดิม → แก้ที่หน้า `/admin/loyalty` ภายหลัง)
4. `sql/add_loyalty_rewards.sql` — seed ของรางวัลตั้งต้น
5. `sql/check_migrations.sql` — **ทุกช่องต้องเป็น `true`** ถ้ามีช่องไหน `false` ให้รันไฟล์ชื่อเดียวกับช่องนั้น

## 3. สร้างผู้ใช้ admin คนแรก

1. Supabase Dashboard → Authentication → Users → **Add user** → email `admin@marim69.internal`
   (ระบบ login ต่อท้าย `@marim69.internal` ให้ชื่อผู้ใช้เสมอ — เป็น realm ภายใน ไม่ใช่อีเมลจริง) ตั้งรหัสผ่าน ≥ 8 ตัว ติ๊ก Auto Confirm
2. SQL Editor:

```sql
insert into public.profiles (id, username, full_name, nickname, role, is_active, email)
select id, 'admin', 'ผู้ดูแลระบบ', 'Admin', 'admin', true, email
from auth.users where email = 'admin@marim69.internal'
on conflict (id) do update set role = 'admin', is_active = true;
```

ผู้ใช้คนอื่นสร้างจากหน้า `/admin` ในแอปหลัง login ได้เลย

## 4. ติดตั้งบน VPS

```bash
ss -tlnp | grep 127.0.0.1        # ดูพอร์ตที่ถูกใช้อยู่ก่อน — เลือกพอร์ตที่ว่างจริง (ตัวอย่างใช้ 3012)

cd ~/apps && git clone git@github.com:ddservice/minimalcnx.git mamasaidno && cd mamasaidno

cat > .deploy.env <<'ENV'
SUPABASE_URL='https://<ref-ใหม่>.supabase.co'
SUPABASE_ANON_KEY='<publishable key ของโปรเจกต์ใหม่>'
APP_SLUG='mamasaidno'
APP_NAME='Mama Said No'
HOST_PORT='3012'
ENV
chmod 600 .deploy.env

bash deploy.sh
```

`deploy.sh` จะขึ้น `==> Instance: mamasaidno (...)` และ `==> Supabase: <url>` — **อ่านสองบรรทัดนี้ทุกครั้ง**
ถ้า URL เป็นของร้านเดิม แปลว่า `.deploy.env` ผิด ให้หยุดทันที (ร้านใหม่จะเขียนลงฐานของร้านเดิม)
สคริปต์ไม่ยอมให้ instance อื่นใช้พอร์ต 3011 และไม่ยอมรันถ้าไม่ได้ตั้ง `HOST_PORT`

## 5. โดเมน

1. คัดลอก `deploy/nginx-minimalcnx.conf` เป็นไฟล์ใหม่ใน `/etc/nginx/sites-available/` แก้ `server_name` เป็นโดเมนของร้านใหม่
   และ `proxy_pass` เป็น `http://127.0.0.1:3012`
2. `sudo nginx -t && sudo systemctl reload nginx` — **ห้าม** `systemctl restart docker`
3. เพิ่ม DNS record ใน Cloudflare ชี้มาที่ VPS
4. Supabase → Authentication → URL Configuration → Site URL = โดเมนใหม่

## 6. Backup

```bash
cd ~/apps/mamasaidno && cp ~/apps/minimalcnx/.backup.env .backup.env && chmod 600 .backup.env
nano .backup.env
```

แก้ 4 ค่าให้เป็นของร้านใหม่ ที่เหลือ (R2, กุญแจ age, Telegram) ใช้ของเดิมได้:

```
SUPABASE_DB_URL=<Session pooler ของโปรเจกต์ใหม่>
SUPABASE_URL=https://<ref-ใหม่>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role ของโปรเจกต์ใหม่>
R2_PREFIX=mamasaidno
```

**`R2_PREFIX` ต้องเปลี่ยน** — ถ้าปล่อยเป็น `minimalcnx` backup ของสองร้านจะกองรวมกันและกู้ผิดร้านได้
ทดสอบ: `bash scripts/backup-to-r2.sh` แล้วเพิ่ม cron (เลื่อนเวลาไม่ให้ชนร้านเดิม):

```
40 20 * * * cd $HOME/apps/mamasaidno && bash scripts/backup-to-r2.sh >> $HOME/backup.log 2>&1
50 20 * * * cd $HOME/apps/mamasaidno && bash scripts/sync-storage-to-r2.sh >> $HOME/backup.log 2>&1
55 20 * * * cd $HOME/apps/mamasaidno && STORAGE_BUCKET=documents bash scripts/sync-storage-to-r2.sh >> $HOME/backup.log 2>&1
```

เพิ่ม Lifecycle rule 90 วันบน R2 สำหรับ `mamasaidno/daily/` ด้วย

## 7. ตั้งค่าในแอป (login ด้วย admin)

1. `/settings` → ข้อมูลร้าน: ชื่อ, เลขผู้เสียภาษี 13 หลัก, ที่อยู่ (ใช้บนสลิป รายงาน และ 50 ทวิ)
2. `/settings` → ค่าตั้งต้นค่าดำเนินการ: ร้านใหม่เริ่มจากว่างทั้งหมด (ตัวเลขตั้งต้นในโค้ดเป็นของร้านเดิมและถูกปิดไว้)
3. `/admin` → สร้างผู้ใช้ · `/settings` → สิทธิ์ตามตำแหน่ง
4. `/admin/loyalty` → แก้ชื่อสาขาและของรางวัลให้เป็นของร้านใหม่

## สิ่งที่ยังเป็นของร้านเดิมในโค้ด (ยังไม่ได้ทำให้ตั้งค่าได้)

ร้านใหม่ใช้งานได้ แต่ถ้าธุรกิจไม่เหมือนร้านกาแฟเดิม ส่วนนี้จะไม่ตรง — ต้องแก้โค้ดก่อนใช้จริง:

- **รายชื่อซัพพลายเออร์และสินค้า** (`lib/suppliers.js`) — หมวด "ต้นทุนวัตถุดิบ" บังคับเลือกซัพพลายเออร์จากรายการนี้
- **ขนมหน้าร้านและราคาตั้งต้น** (`lib/bakery.js`)
- **อัตรา GP เดลิเวอรี** (`lib/gp.js`) และช่องยอดขายแยกช่องทาง (kshop / เงินสด / shopee / grab / lineman)
- **หมวดรายจ่าย** (`lib/expense-categories.js`) และรายการค่าดำเนินการ (`lib/opex.js`)
- ไอคอนแอป (`public/icons/`) และโทนสี (`app/globals.css`)

## อัปเดตโค้ดในอนาคต

push ครั้งเดียว แล้ว deploy ทีละร้าน:

```bash
cd ~/apps/minimalcnx && bash deploy.sh
cd ~/apps/mamasaidno && bash deploy.sh
```

SQL ไฟล์ใหม่ต้องรันในโปรเจกต์ Supabase **ของทั้งสองร้าน**
