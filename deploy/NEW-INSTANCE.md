# เปิดร้านใหม่บนระบบเดียวกัน (อีก instance)

โค้ดชุดเดียว (repo นี้) ติดตั้งได้หลายร้าน — **แต่ละร้านมีฐานข้อมูล Supabase ของตัวเอง ผู้ใช้ของตัวเอง
และ backup ของตัวเอง** ข้อมูลไม่ปนกัน เหมาะกับร้านที่เป็นคนละนิติบุคคล

ตัวอย่างในไฟล์นี้ใช้ร้านชื่อ `mamasaidno` — เปลี่ยนชื่อ/พอร์ต/โดเมนตามจริง

> ⚠️ ข้อ 3 (โครงสร้างฐานข้อมูล) ทดสอบแล้วบน Postgres ว่างจำลอง (2026-10-13: รันครบทุกไฟล์ตามลำดับ, `check_migrations.sql` ผ่านทุกช่อง)
> แต่ **ทั้งชุดยังไม่เคยรันจริงบน Supabase + VPS** — รอบแรกให้ทำตามทีละข้อและดูผลทุกข้อ
> ถ้าข้อไหนไม่ตรงกับที่เขียน ให้หยุดแล้วแก้เอกสารนี้ก่อนไปต่อ

## สิ่งที่แยกตามร้าน / สิ่งที่ใช้ร่วม

| แยกตามร้าน | ใช้ร่วมกัน |
|---|---|
| บัญชี/โปรเจกต์ Supabase (ฐานข้อมูล + Auth + Storage) | โค้ดใน repo นี้ (branch `main`) |
| โฟลเดอร์บน VPS `~/apps/<slug>` + `.deploy.env` + `.backup.env` | VPS, Docker, nginx, Cloudflare |
| container / image / พอร์ต / โดเมน | bucket R2 (แยกด้วย prefix) และกุญแจ `age` |
| ผู้ใช้, สิทธิ์, ข้อมูลร้าน, เลขผู้เสียภาษี | |

ร้านใหม่ **ไม่ต่อไปที่ฐานข้อมูลของร้านอื่นในขั้นตอนใดเลย** — โครงสร้างสร้างจากไฟล์ `sql/` ใน repo
จึงใช้บัญชี Supabase คนละบัญชีกับร้านเดิมได้ (mamasaidno ทำแบบนี้ — คนละนิติบุคคล)

## 1. สร้างบัญชี + โปรเจกต์ Supabase (เจ้าของทำเอง)

1. สมัครบัญชี Supabase ใหม่ด้วยอีเมลของร้านใหม่ (หรือสร้าง Organization ใหม่) → New project → ชื่อ `mamasaidno`
   → region **Southeast Asia (Singapore)** → ตั้งรหัสฐานข้อมูลแล้วเก็บไว้ในที่ปลอดภัย
2. Authentication → Sign In / Providers:
   - **Allow new users to sign up = ปิด** ← ห้ามข้าม: policy หลายตารางอนุญาต "ผู้ใช้ที่ login แล้วทุกคน"
     ถ้าเปิดไว้ ใครก็ตามที่มี publishable key (อยู่ใน JS ของหน้าเว็บ) สมัครเองแล้วอ่านยอดขาย/รายจ่ายได้
     ปิดแล้วผู้ใช้ยังสร้างได้ตามปกติจาก Dashboard และหน้า `/admin` ของแอป
   - Email: **Confirm email = ปิด**, Minimum password length = **8**
3. เก็บค่าเหล่านี้ไว้: Project URL, publishable (anon) key, service_role key, connection string แบบ **Session pooler (:5432)**

## 2. เตรียมโฟลเดอร์บน VPS

```bash
ss -tlnp | grep 127.0.0.1        # ดูพอร์ตที่ถูกใช้อยู่ก่อน — เลือกพอร์ตที่ว่างจริง (ตัวอย่างใช้ 3013 — 3012 มี next-server ตัวอื่นใช้อยู่แล้ว ตรวจเมื่อ 2026-10-13)

cd ~/apps && git clone git@github.com:ddservice/minimalcnx.git mamasaidno && cd mamasaidno
```

## 3. สร้างโครงสร้างฐานข้อมูล

```bash
cd ~/apps/mamasaidno && bash scripts/install-schema.sh
```

สคริปต์จะถาม connection string (พิมพ์แบบไม่แสดงบนจอ ไม่ค้างใน history) แล้วรันไฟล์ `sql/` ทั้งชุด **ตามลำดับที่ทดสอบแล้ว**
หยุดทันทีที่ไฟล์ไหนผิดพลาด และจบด้วย `sql/check_migrations.sql` — **ทุกช่องต้องเป็น `t`**

- สคริปต์ **ไม่ยอมรันถ้าปลายทางมีตารางของแอปอยู่แล้ว** (กันใส่ URL ของร้านที่ใช้งานอยู่ผิดมา)
- อย่าสลับลำดับหรือรันไฟล์เดี่ยวซ้ำเอง: หลายไฟล์ `create or replace` ฟังก์ชันชื่อเดียวกัน
  รันไฟล์เก่าทับทีหลัง = ได้ฟังก์ชัน/policy รุ่นเก่ากลับมาโดยไม่มี error และ `check_migrations` จับไม่ได้ทุกกรณี
- ไฟล์สุดท้าย `sql/new_instance_finalize.sql` ลบ trigger สมัครสมาชิกรุ่นแรก (เชื่อ role ที่ผู้สมัครส่งมาเอง)
  และเปลี่ยนสาขาตั้งต้นของร้านเดิมเป็น "สาขาหลัก" สาขาเดียว
- ค่าที่ seed มา: `free_cup_unit_cost` = 55 บาท (ต้นทุนแก้วฟรีของร้านเดิม — แก้ที่หน้า `/settings`), ของรางวัลตั้งต้น 3 รายการ
- ไม่มี VPS / อยากใช้ SQL Editor: วางไฟล์ทีละไฟล์ตามลำดับใน `FILES=( ... )` ของ `scripts/install-schema.sh`

## 4. สร้างผู้ใช้ admin คนแรก

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

## 5. Deploy บน VPS

```bash
cd ~/apps/mamasaidno

cat > .deploy.env <<'ENV'
SUPABASE_URL='https://<ref-ใหม่>.supabase.co'
SUPABASE_ANON_KEY='<publishable key ของโปรเจกต์ใหม่>'
APP_SLUG='mamasaidno'
APP_NAME='Mama Said No'
HOST_PORT='3013'
ENV
chmod 600 .deploy.env

bash deploy.sh
```

`deploy.sh` จะขึ้น `==> Instance: mamasaidno (...)` และ `==> Supabase: <url>` — **อ่านสองบรรทัดนี้ทุกครั้ง**
ถ้า URL เป็นของร้านเดิม แปลว่า `.deploy.env` ผิด ให้หยุดทันที (ร้านใหม่จะเขียนลงฐานของร้านเดิม)
สคริปต์ไม่ยอมให้ instance อื่นใช้พอร์ต 3011 และไม่ยอมรันถ้าไม่ได้ตั้ง `HOST_PORT`

## 6. โดเมน

```bash
cd /etc/nginx/sites-available
sudo cp minimalcnx.conf mamasaidno.conf      # คัดลอกไฟล์ที่ใช้งานจริงบน VPS ไม่ใช่ตัวอย่างใน repo — จะได้การตั้งค่า TLS/Cloudflare ชุดเดียวกัน
sudo nano mamasaidno.conf                    # server_name → mamasaidno.ddserviceth.com · proxy_pass → http://127.0.0.1:3013
sudo ln -s /etc/nginx/sites-available/mamasaidno.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx # ห้าม systemctl restart docker
```

- ถ้า `nginx -t` ฟ้องว่า `map` / `connection_upgrade` ซ้ำ ให้ลบบล็อก `map $http_upgrade ...` ออกจากไฟล์ใหม่ (ใช้ของไฟล์เดิมร่วมกันได้)
- เพิ่ม DNS record ใน Cloudflare ชี้มาที่ VPS (ตั้ง proxy/SSL mode ให้เหมือน record ของ `minimalcnx`)
- Supabase → Authentication → URL Configuration → Site URL = `https://mamasaidno.ddserviceth.com`
- ตรวจ: `curl -s -o /dev/null -w "%{http_code}
" http://127.0.0.1:3013/login` และเปิดโดเมนจริง → ต้องได้ 200

## 7. Backup

```bash
cd ~/apps/mamasaidno && cp ~/apps/minimalcnx/.backup.env .backup.env && chmod 600 .backup.env
nano .backup.env
```

แก้ 4 ค่าให้เป็นของร้านใหม่ ที่เหลือ (R2, กุญแจ age, Telegram) ใช้ของเดิมได้ — ถ้าต้องการแยกขาดจากร้านเดิมทั้งหมด ให้สร้าง bucket R2 และกุญแจ `age` ชุดใหม่ตาม `deploy/BACKUP.md`:

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

## 8. ตั้งค่าในแอป (login ด้วย admin)

1. `/settings` → ข้อมูลร้าน: ชื่อ, เลขผู้เสียภาษี 13 หลัก, ที่อยู่ (ใช้บนสลิป รายงาน และ 50 ทวิ)
2. `/settings` → ค่าตั้งต้นค่าดำเนินการ: ร้านใหม่เริ่มจากว่างทั้งหมด (ตัวเลขตั้งต้นในโค้ดเป็นของร้านเดิมและถูกปิดไว้)
3. `/admin` → สร้างผู้ใช้ · `/settings` → สิทธิ์ตามตำแหน่ง
4. `/admin/loyalty` → ตั้งชื่อสาขา ("สาขาหลัก") และของรางวัลให้เป็นของร้านใหม่

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

SQL ไฟล์ใหม่ต้องรันในโปรเจกต์ Supabase **ของทั้งสองร้าน** และต้องเพิ่มชื่อไฟล์ใน `FILES=( ... )` ของ `scripts/install-schema.sh` (ก่อน `new_instance_finalize.sql`) เพื่อให้ร้านถัดไปได้ครบ
