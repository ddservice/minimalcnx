# ย้าย Supabase project ข้าม region (Sydney → Singapore)

คู่มือย้ายฐานข้อมูล minimalcnx จากโปรเจกต์เดิม `fkhfrylvronkmktlmmia`
(AWS `ap-southeast-2` ซิดนีย์) ไปโปรเจกต์ใหม่ที่สร้างรอไว้แล้วใน `ap-southeast-1` สิงคโปร์

Supabase **ย้าย region ของโปรเจกต์เดิมไม่ได้** — ต้องสร้างโปรเจกต์ใหม่แล้วย้ายข้อมูลข้ามไป
ซึ่งแปลว่า project ref / URL / anon key / service_role key / JWT secret **เปลี่ยนหมด**

รันทุกอย่างบน VPS (`~/apps/minimalcnx`) เพราะที่นั่นมี `docker` + `age` + `aws` ครบอยู่แล้ว

---

## 0. สิ่งที่ต้องรู้ก่อนเริ่ม

| | ย้ายให้อัตโนมัติ | ต้องทำมือ |
|---|---|---|
| ตาราง / RPC / RLS / trigger / index ใน `public` | ✅ `migrate-supabase-project.sh --dump/--load` | |
| `grant execute … to authenticated` | ✅ (สคริปต์ **ไม่** ใส่ `--no-privileges` ต่างจาก backup ปกติ) | |
| บัญชีผู้ใช้ + รหัสผ่านเดิม (`auth.users`, `auth.identities`) | ✅ UUID เดิมติดมาด้วย `profiles.id` เลยยังชี้ถูก | |
| รูปหลักฐานแก้วฟรีใน Storage | ✅ `migrate-storage-files.sh --all` | |
| **JWT secret** | ❌ | ทุกคนจะถูก logout ต้อง login ใหม่ (รหัสเดิมใช้ได้) |
| **anon key / service_role key** | ❌ | ใส่ใน `.deploy.env` แล้ว deploy ใหม่ |
| ตั้งค่า Auth (ความยาวรหัสผ่านขั้นต่ำ, ยืนยันอีเมล, Site URL) | ❌ | ตั้งใหม่ในหน้า Dashboard (ข้อ 2) |
| `.backup.env` (cron สำรองข้อมูล) | ❌ | เปลี่ยน `SUPABASE_DB_URL` ให้ชี้โปรเจกต์ใหม่ (ข้อ 8) |

> ⚠️ ไฟล์ dump ระหว่างทางมีเบอร์โทรลูกค้าทั้งฐาน + เลขบัตรประชาชน/เลขบัญชีธนาคารพนักงาน
> + เลขผู้เสียภาษี + hash รหัสผ่าน — สคริปต์เก็บใน `~/minimalcnx-migrate` แบบ `chmod 700`
> **ลบทิ้งทันทีที่ย้ายเสร็จ** (`rm -rf ~/minimalcnx-migrate`)

---

## 1. ค่าที่ต้องเตรียม

จาก Supabase Dashboard ของ **โปรเจกต์ใหม่**:

| ค่า | หาที่ไหน |
|---|---|
| Connection string (Session pooler, พอร์ต **5432**) | Project Settings → Database → Connection string → URI |
| Project URL `https://<ref>.supabase.co` | Project Settings → Data API |
| Publishable / anon key | Project Settings → API Keys |
| `service_role` key | Project Settings → API Keys (ใช้ครั้งเดียวตอนอัปรูป — **ห้ามใส่ในโค้ดหรือ `.deploy.env`**) |

จาก **โปรเจกต์เก่า**: connection string เดิมมีอยู่แล้วใน `~/apps/minimalcnx/.backup.env` (`SUPABASE_DB_URL`)

> **ห้ามใช้ transaction pooler (`:6543`)** ทั้งสองฝั่ง — `pg_dump` ต้องการ snapshot คงที่
> และฝั่งโหลดเราตั้ง `session_replication_role = replica` ซึ่ง transaction mode ทำค่าหายกลางทาง
> (trigger จะกลับมาทำงาน → ยอดแต้มลูกค้าเพี้ยน) สคริปต์บล็อก `:6543` ให้อยู่แล้ว

สร้าง `~/apps/minimalcnx/.migrate.env` (gitignored แล้ว):

```bash
OLD_DB_URL='postgresql://postgres.fkhfrylvronkmktlmmia:<รหัสเก่า>@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres'
NEW_DB_URL='postgresql://postgres.<ref-ใหม่>:<รหัสใหม่>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres'

OLD_SUPABASE_URL='https://fkhfrylvronkmktlmmia.supabase.co'
NEW_SUPABASE_URL='https://<ref-ใหม่>.supabase.co'

# ใช้เฉพาะตอน migrate-storage-files.sh --copy
NEW_SERVICE_ROLE_KEY='<service_role ของโปรเจกต์ใหม่>'
```

```bash
chmod 600 ~/apps/minimalcnx/.migrate.env
```

รหัสผ่านที่มี `@ # ? /` ต้อง percent-encode ก่อน (`@` → `%40`) ไม่งั้น URI แตก

---

## 2. ตั้งค่าโปรเจกต์ใหม่บน Dashboard (ทำก่อนย้ายข้อมูล)

ค่าพวกนี้อยู่นอกฐานข้อมูล เลยไม่ติดมากับ `pg_dump`:

1. **Authentication → Sign In / Providers → Email**
   - เปิด Email provider
   - **Confirm email = ปิด** — ระบบสร้างผู้ใช้ด้วย RPC `admin_create_user` ในโดเมนภายใน
     `@marim69.internal` ที่ส่งอีเมลจริงไม่ได้ ถ้าเปิดไว้ ผู้ใช้ใหม่จะ login ไม่ได้เลย
   - **Minimum password length = 8** ให้ตรงกับ `MIN_PASSWORD_LENGTH` ใน `lib/auth-policy.js`
     (ฝั่งแอปเช็คเองอยู่แล้ว แต่ไม่ได้บังคับตัว Supabase Auth — ต้องตั้งซ้ำที่นี่)
2. **Authentication → URL Configuration → Site URL** = `https://minimalcnx.ddserviceth.com`
3. **Project Settings → Data API** — เปิด schema `public` (ค่าเริ่มต้นถูกอยู่แล้ว)

---

## 3. ตรวจก่อนแตะอะไร

```bash
cd ~/apps/minimalcnx
git pull --ff-only origin main
bash scripts/migrate-supabase-project.sh --check
```

ต้องเห็น: ต่อได้ทั้งสองฝั่ง / project ref ถูกต้อง / โปรเจกต์ใหม่ยังว่าง / `replica mode ok`

---

### ซ้อมก่อนหนึ่งรอบ (แนะนำ ถ้ายังไม่ถึงเวลาร้านปิด)

`--dump` อ่านอย่างเดียวจากฐานเก่า และ `--load` ลงโปรเจกต์ใหม่ที่ยังว่าง — ซ้อมได้โดยไม่ต้องปิดร้าน
ได้รู้ล่วงหน้าว่า schema/auth/data ติดครบไหม โดยไม่ต้องเอา downtime มาเสี่ยง

```bash
bash scripts/migrate-supabase-project.sh --dump
bash scripts/migrate-supabase-project.sh --load
bash scripts/migrate-supabase-project.sh --verify
```

ผ่านแล้วล้างทิ้ง แล้วค่อยทำรอบจริงตอนร้านปิด (ยอดที่คีย์ระหว่างวันจะติดไปกับ dump รอบจริงเอง):

```bash
bash scripts/migrate-supabase-project.sh --reset     # ต้องพิมพ์ ref ของโปรเจกต์ใหม่ยืนยัน
```

> `--reset` ล้าง **schema public + `auth.users` ทั้งหมด** ของโปรเจกต์ปลายทาง แล้วคืน
> `grant usage on schema public` ให้ `anon`/`authenticated`/`service_role` (การ `drop schema public`
> ทำให้ grant ที่ Supabase ตั้งไว้ตอนสร้างโปรเจกต์หายไปด้วย ไม่คืนแล้วแอปจะเจอ permission denied
> ทั้งระบบทั้งที่ตารางมาครบ) — และมันปฏิเสธถ้า ref ปลายทางเท่ากับ ref ต้นทาง

## 4. ปิดหน้าร้านก่อนย้าย

ต้องไม่มีใครเขียนลงฐานเก่าระหว่าง dump ไม่งั้นบิลที่บันทึกตอนนั้นจะหายไปเงียบๆ

```bash
docker stop minimalcnx
```

> เลือกเวลาที่ร้านปิด — ช่วง dump→load ปกติไม่กี่นาที แต่ระหว่างนั้นทั้ง `/sales` และ `/loyalty` ใช้ไม่ได้

---

## 5. ย้ายฐานข้อมูล

```bash
bash scripts/migrate-supabase-project.sh --dump
bash scripts/migrate-supabase-project.sh --load
bash scripts/migrate-supabase-project.sh --verify
```

`--load` ปิด trigger ทั้งหมดระหว่างโหลด (`session_replication_role = replica`) เพราะถ้าเปิดไว้:

- `fn_on_point_transaction` จะคำนวณ `points_balance` ใหม่ทับของจริง
- `tr_customers_guard_points` จะ**บล็อก**การ insert `customers` ทิ้งไปทั้งหมด
- audit trigger จะยัด `audit_log` ปลอมเป็นหมื่นแถวว่ามีคนกรอกข้อมูลใหม่วันนี้
- `tr_expenses_month_label` จะเขียน `month_label` ทับ

`--verify` นับแถวจริงทุกตารางสองฝั่งแล้ว `diff` กัน — **ถ้าไม่ตรงมันจะหยุดให้** อย่าข้ามไปขั้นถัดไป
และรัน `sql/check_migrations.sql` บนโปรเจกต์ใหม่ให้ด้วย ควรได้ `true` ครบทุกช่อง

---

## 6. ย้ายรูปหลักฐานแก้วฟรี

```bash
bash scripts/migrate-storage-files.sh --list
bash scripts/migrate-storage-files.sh --all
```

`--all` = ดาวน์โหลดจาก bucket เก่า → อัปเข้า bucket ใหม่ → แล้ว **เขียนทับ URL ใน
`sales_daily.free_cup_evidence_url`** ให้ชี้โปรเจกต์ใหม่

ขั้นเขียนทับ URL สำคัญพอๆ กับการก๊อปไฟล์: คอลัมน์นั้นเก็บ URL เต็มที่มี project ref อยู่ข้างใน
ถ้าไม่แก้ รูปจะยังโหลดจากโปรเจกต์เก่าและพังทันทีที่ลบโปรเจกต์นั้นทิ้ง

---

## 7. สลับแอปไปโปรเจกต์ใหม่

`NEXT_PUBLIC_SUPABASE_*` ถูก **อบเข้าไปใน JS ตอน `docker build`** (ดู `Dockerfile`) ไม่ใช่อ่านตอนรัน
— เปลี่ยนค่าแล้วต้อง build ใหม่เสมอ

```bash
cat > ~/apps/minimalcnx/.deploy.env <<'EOF'
SUPABASE_URL='https://<ref-ใหม่>.supabase.co'
SUPABASE_ANON_KEY='sb_publishable_<ของใหม่>'
EOF
chmod 600 ~/apps/minimalcnx/.deploy.env

bash deploy.sh
```

`deploy.sh` จะพิมพ์ `==> Supabase: https://…` ให้ดูก่อน build — **อ่านบรรทัดนั้นให้แน่ใจว่าเป็น ref ใหม่**
ชี้ผิดโปรเจกต์คือทั้งแอปคุยกับฐานข้อมูลผิดตัวโดยไม่มี error ให้เห็น

---

## 8. เปลี่ยนปลายทางของ backup

```bash
nano ~/apps/minimalcnx/.backup.env    # SUPABASE_DB_URL → โปรเจกต์ใหม่ (Session pooler :5432)
bash scripts/backup-to-r2.sh --check
bash scripts/backup-to-r2.sh
bash scripts/sync-storage-to-r2.sh
```

ถ้าลืมข้อนี้ cron จะสำรองฐานเก่าที่ไม่มีใครใช้แล้วต่อไปทุกคืน โดยไม่มีอะไรฟ้อง

---

## 9. Smoke test (ทำให้ครบ อย่าเชื่อว่าแค่หน้าแรกขึ้นก็พอ)

- [ ] `/login` — เข้าด้วย**รหัสเดิม**ได้ (ถ้าเข้าไม่ได้ = `auth.users` ไม่ติดมา ดูข้อ 11)
- [ ] `/dashboard` — ตัวเลข KPI ตรงกับก่อนย้าย
- [ ] `/reports` — เลือกเดือนที่มีข้อมูลเยอะ (มิ.ย./ก.ค.) ยอดรวมต้องเท่าเดิม
- [ ] `/sales` — เปิดวันที่มีรูปหลักฐานแก้วฟรี แล้วกดดูรูป ต้องขึ้น
- [ ] `/loyalty` — ค้นลูกค้าด้วยเบอร์ ยอดแต้มต้องเท่าเดิม แล้วลองแจกแต้ม 1 แต้ม
- [ ] `/loyalty` — ใช้**เลขใบเสร็จเดิมซ้ำ** ต้องถูกปฏิเสธ (พิสูจน์ว่า `uidx_point_tx_earn_receipt` ติดมา)
- [ ] `/admin/audit` — logout แล้ว login ใหม่ ต้องเห็นแถว LOGIN พร้อม IP ใต้ชื่อผู้ใช้
- [ ] `/export` — โหลด Excel ออกมาได้

---

## 10. เก็บกวาด

```bash
rm -rf ~/minimalcnx-migrate          # ลบ dump ที่มีข้อมูลส่วนบุคคล
```

แล้วอัปเดตในโค้ด (commit + push): `.env.local.example`, `DEPLOY-SUBDOMAIN.md`,
`deploy.sh` (ค่า fallback), `deploy/BACKUP.md`, `CLAUDE.md` — เปลี่ยน ref เก่าเป็นใหม่ทุกที่

**เก็บโปรเจกต์เก่าไว้อย่างน้อย 2 สัปดาห์** อย่าเพิ่งลบ — เป็นทางถอยเดียวที่มี

---

## 11. ถ้าพัง — rollback

ย้อนกลับไปโปรเจกต์เก่าใช้เวลาไม่ถึง 5 นาที เพราะฐานเก่ายังอยู่ครบและไม่ถูกแตะเลย
(สคริปต์อ่านอย่างเดียวจากฝั่งเก่า):

```bash
rm ~/apps/minimalcnx/.deploy.env     # กลับไปใช้ค่า fallback = โปรเจกต์เดิม
bash deploy.sh
nano ~/apps/minimalcnx/.backup.env   # SUPABASE_DB_URL กลับเป็นของเก่า
```

ปัญหาที่เจอบ่อย:

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| login ไม่ได้ทุกบัญชี | `02-data-auth.sql` ไม่ได้โหลด หรือ Confirm email เปิดอยู่ | ดู `~/minimalcnx-migrate/err-auth.log`, ปิด Confirm email (ข้อ 2) |
| login ได้แต่หน้าไหนก็ว่าง / เด้งออก | `profiles` ไม่มีแถว หรือ UUID ไม่ตรง | `--verify` ต้องบอกอยู่แล้วว่าจำนวนแถวไม่ตรง — โหลดใหม่ |
| กดปุ่มแล้วเงียบ ไม่มี error | `grant execute … to authenticated` หาย | ดู `err-schema.log`; รัน `sql/harden_security.sql` + ไฟล์ที่ `check_migrations.sql` บอกว่า false |
| ยอดแต้มลูกค้าเพี้ยน | โหลดโดย trigger ยังทำงาน (ใช้ transaction pooler `:6543`) | `--reset` แล้ว `--load` ใหม่ด้วย connection string `:5432` |
| `duplicate key value violates unique constraint` ตอน `--load` | โหลดซ้ำทับของที่โหลดไปแล้ว | `--reset` ก่อน แล้วค่อย `--load` |
| รูปหลักฐานขึ้นกากบาท | ยังไม่ได้รัน `migrate-storage-files.sh --all` | รันข้อ 6 |

---

## หมายเหตุเรื่องความเร็ว

สิงคโปร์ใกล้เชียงใหม่กว่าซิดนีย์ราว ~50–80 ms ต่อ round-trip และแอปนี้คุย PostgREST
ผ่าน HTTPS หลายครั้งต่อการโหลดหนึ่งหน้า จึงควรเห็นผลชัดกับหน้าที่ยิงหลาย query
(`/reports`, `/analytics`, `/loyalty/analytics`)

สิ่งที่ **ไม่** ช่วย: ไปเปิด transaction pooler — repo นี้ไม่เปิด Postgres connection ตรงเลยสักที่
(`@supabase/ssr` คุย PostgREST ผ่าน HTTPS) ค่า pooler จึงไม่มีผลกับ latency ของแอป
มันมีไว้ให้ `pg_dump` ตอน backup อย่างเดียว
