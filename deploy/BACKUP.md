# สำรองข้อมูล off-site ไป Cloudflare R2

สำรอง Supabase Postgres ขึ้น R2 ทุกวัน แบบ**เข้ารหัสก่อนออกจากเครื่อง**

**ทำไมต้องมีทั้งที่ Supabase ก็ backup ให้:** backup ของ Supabase อยู่ในบัญชี Supabase เดียวกัน
ถ้าบัญชีโดนระงับ โปรเจกต์ถูกลบพลาด หรือ migration พังแล้วเลยหน้าต่าง retention ไปแล้ว ก็จบเหมือนกัน
โปรเจกต์นี้รัน migration บ่อย ความเสี่ยงข้อหลังไม่ใช่เรื่องสมมติ

**ทำไมรันบน VPS ไม่ใช่ GitHub Actions:** VPS เป็นเครื่องที่เชื่อถืออยู่แล้วและมี Docker + cron พร้อม
ไม่ต้องเอา credential ฐานข้อมูลไปฝากเพิ่มอีกที่หนึ่ง

---

## 1. เตรียม R2 (ทำครั้งเดียว)

1. Cloudflare Dashboard → **R2** → Create bucket ชื่อ `minimalcnx-backups` (Location: Asia-Pacific)
2. **R2 → Manage API Tokens → Create API Token**
   - Permission: **Object Read & Write**
   - Specify bucket: `minimalcnx-backups` เท่านั้น — **อย่าให้สิทธิ์ทั้งบัญชี**
   - เก็บ **Access Key ID** / **Secret Access Key** / **Account ID** ไว้
3. **Lifecycle rule** (bucket → Settings → Object lifecycle rules)
   - prefix `minimalcnx/daily/` → ลบเมื่ออายุเกิน **30 วัน**
   - prefix `minimalcnx/monthly/` → ลบเมื่ออายุเกิน **365 วัน**

> R2 ไม่คิดค่า egress → ตอนกู้จริงไม่โดนบิลบานปลายแบบ S3

## 2. เตรียมเครื่องมือบน VPS

```bash
# aws cli (คุยกับ R2 ผ่าน S3-compatible API) — ต้อง sudo
sudo apt-get update && sudo apt-get install -y awscli age
# docker มีอยู่แล้ว — ใช้ image postgres:17 ยิง pg_dump ให้ major version ตรงกับเซิร์ฟเวอร์
docker pull postgres:17-alpine
```

ถ้า `age` ไม่มีใน repo ของรุ่นที่ใช้ (Ubuntu เก่ากว่า 22.04) ให้ลงจาก binary:

```bash
curl -fsSL https://github.com/FiloSottile/age/releases/latest/download/age-v1.2.1-linux-amd64.tar.gz \
  | sudo tar -xz -C /usr/local/bin --strip-components=1 age/age age/age-keygen
```

> **ใช้ awscli จาก apt (v1) ก็พอ อย่าเพิ่งอัปเป็น v2** — aws cli v2 รุ่นใหม่ส่ง checksum header
> เพิ่มเข้ามาซึ่ง S3-compatible บางเจ้ารวมถึง R2 บางช่วงปฏิเสธ ทำให้อัปโหลดล้มแบบงงๆ

> **อย่าใช้ `pg_dump` ที่ติดมากับ VPS** — ถ้า major version เก่ากว่าเซิร์ฟเวอร์ มันจะปฏิเสธทำงานทันที
> `docker run --rm` ตัวเดียวไม่กระทบ container อื่นบนเครื่อง (และไม่ต้อง restart docker daemon ซึ่งห้ามทำบน VPS นี้)

## 3. สร้างกุญแจเข้ารหัส

```bash
age-keygen -o ~/minimalcnx-backup.key      # เก็บไฟล์นี้ให้ดี
chmod 600 ~/minimalcnx-backup.key
grep 'public key' ~/minimalcnx-backup.key  # ได้ age1... เอาไปใส่ BACKUP_AGE_RECIPIENT
```

🔴 **สำรอง private key ไว้คนละที่กับ backup** (password manager / ตู้เซฟ / กระดาษ)
ถ้ากุญแจหาย backup ทุกก้อนกลายเป็นขยะทันที — และถ้ากุญแจอยู่ที่เดียวกับ backup ก็เท่ากับไม่ได้เข้ารหัส

**ทำไมต้องเข้ารหัส:** ใน dump มีเบอร์โทรลูกค้าทั้งฐาน (`customers`) เลขบัตรประชาชนและเลขบัญชีธนาคาร
ของพนักงาน (`business_config.emp_details`) และเลขผู้เสียภาษี (`form50_payees`) — เป็นข้อมูลส่วนบุคคล
ตาม PDPA เต็มรูปแบบ ระบบถึงขั้นมี consent checkbox ให้ลูกค้าเซ็นแล้ว การเอาไปวางดิบๆ บน object storage
ขัดกับสิ่งที่เพิ่งสัญญากับลูกค้าไว้

## 4. หา connection string ที่ถูกตัว

Supabase Dashboard → **Project Settings → Database → Connection string → URI**

| แบบ | พอร์ต | ใช้กับ backup ได้ไหม |
|---|---|---|
| Direct connection | 5432 | ✅ ได้ (ต้องมี IPv6 หรือซื้อ IPv4 add-on) |
| **Session pooler** | 5432 | ✅ **แนะนำตัวนี้** — ใช้ได้ทั้ง IPv4 |
| Transaction pooler | 6543 | ❌ **ใช้ไม่ได้** |

**ทำไม transaction pooler ใช้ไม่ได้:** `pg_dump` ต้องตั้ง session state และถือ snapshot แบบ repeatable-read
ตลอดการ dump ซึ่ง transaction mode คืน connection กลับ pool ทุก statement จึงไม่รับประกันให้
สคริปต์เช็ค `:6543` ให้แล้วและจะปฏิเสธทำงานพร้อมบอกเหตุผล

> หมายเหตุ: **ตัวเว็บแอปเองไม่ได้ใช้ connection string นี้เลย** — `@supabase/ssr` คุยกับ PostgREST
> ผ่าน HTTPS ไม่ใช่ Postgres wire protocol การเปิด/ปิด pooler จึงไม่มีผลกับความเร็วหน้าเว็บ
> connection string ใช้เฉพาะงาน backup นี้เท่านั้น

## 5. ไฟล์ตั้งค่า

สร้าง `~/apps/minimalcnx/.backup.env` (**gitignored แล้ว — ห้าม commit**)

```bash
SUPABASE_DB_URL='postgresql://postgres.fkhfrylvronkmktlmmia:<DB_PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres'
R2_BUCKET='minimalcnx-backups'
R2_ENDPOINT='https://<ACCOUNT_ID>.r2.cloudflarestorage.com'
AWS_ACCESS_KEY_ID='<R2 Access Key ID>'
AWS_SECRET_ACCESS_KEY='<R2 Secret Access Key>'
BACKUP_AGE_RECIPIENT='age1...'                       # public key
BACKUP_AGE_KEYFILE="$HOME/minimalcnx-backup.key"     # ใช้ตอนซ้อมกู้เท่านั้น
AWS_DEFAULT_REGION='auto'                            # R2 ไม่มี region จริง แต่ aws cli บังคับต้องมี
```

```bash
chmod 600 ~/apps/minimalcnx/.backup.env
```

## 6. ทดสอบ แล้วตั้ง cron

```bash
cd ~/apps/minimalcnx
bash scripts/backup-to-r2.sh --check    # เช็คเครื่องมือ + ต่อ DB + เขียน R2 ได้จริง
bash scripts/backup-to-r2.sh            # ลองจริงหนึ่งรอบ
```

ผ่านแล้วค่อยตั้ง cron (`crontab -e`) — ตี 3 ตามเวลาไทย = 20:00 UTC:

```cron
0 20 * * * cd $HOME/apps/minimalcnx && bash scripts/backup-to-r2.sh >> $HOME/backup.log 2>&1
```

ตรวจว่าทำงานอยู่: `tail -20 ~/backup.log` — ควรเห็น `✅ สำรองข้อมูลสำเร็จ` ของเมื่อคืน

## 7. ซ้อมกู้ — **ทุกไตรมาส ห้ามข้าม**

backup ที่ไม่เคย restore ไม่นับเป็น backup เพราะยังไม่มีใครพิสูจน์ว่ามันกู้ได้

```bash
bash scripts/restore-from-r2.sh --list     # ดูว่ามีอะไรบ้าง
bash scripts/restore-from-r2.sh --drill    # กู้ก้อนล่าสุดลง container ชั่วคราว แล้วนับแถวให้ดู
```

ใช้เวลาราว 15 นาที และจบด้วยการนับแถวของ 6 ตารางหลัก — ตัวเลขต้องใกล้เคียงของจริง
ถ้าเป็น 0 หมดแปลว่า backup มีปัญหา ต้องแก้ทันที ไม่ใช่รอวันที่ต้องใช้จริง

## 8. กู้ของจริง (กรณีฉุกเฉิน)

สคริปต์**ไม่**กู้ทับให้โดยตั้งใจ — ต้องตัดสินใจด้วยคนก่อนว่าจะทับอะไร

```bash
aws s3 cp "s3://minimalcnx-backups/<key>" ./b.age --endpoint-url "$R2_ENDPOINT"
age -d -i ~/minimalcnx-backup.key -o b.dump b.age
# กู้ทั้งก้อนลงโปรเจกต์ใหม่/ฐานใหม่:
pg_restore -d "$TARGET_DB_URL" --no-owner --no-privileges b.dump
# หรือกู้เฉพาะตารางที่พัง (ปลอดภัยกว่ามาก):
pg_restore -d "$TARGET_DB_URL" --no-owner --no-privileges -t sales_daily b.dump
```

> เกือบทุกครั้งที่ต้องกู้จริง คำตอบที่ถูกคือ **กู้เฉพาะตารางที่พัง** ไม่ใช่ทับทั้งฐาน
> การทับทั้งฐานจะลบงานของวันปัจจุบันที่ยังดีอยู่ไปด้วย

---

## สิ่งที่ backup นี้ **ไม่** ครอบคลุม

| ของ | อยู่ไหน | ต้องทำอะไร |
|---|---|---|
| ไฟล์ใน Storage bucket `evidence` (รูปหลักฐานแก้วฟรี) | Supabase Storage | `pg_dump` ได้แค่ metadata ไม่ได้ตัวไฟล์ — ถ้าถือเป็นหลักฐานทางบัญชีที่ต้องเก็บ ต้อง sync แยก (`rclone` จาก S3-compatible endpoint ของ Supabase Storage) |
| ผู้ใช้ใน `auth.users` (รหัสผ่าน/identity) | schema `auth` | สคริปต์ dump แค่ `public` + `storage` — schema `auth` เป็นของ Supabase และ restore ข้ามโปรเจกต์ไม่ได้ตรงๆ ถ้าย้ายโปรเจกต์ต้องสร้างผู้ใช้ใหม่แล้วให้ตั้งรหัสผ่านใหม่ |
| `.env.local` / คีย์ Supabase | ในเครื่อง + VPS | เก็บใน password manager แยกต่างหาก **ห้ามใส่ใน backup** |
| ไฟล์ SQL migration | อยู่ใน git แล้ว (`sql/`) | ไม่ต้องทำอะไร |
