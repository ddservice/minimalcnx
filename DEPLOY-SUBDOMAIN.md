# Deploy ขึ้น Subdomain ทดสอบ (Docker) — ไม่แตะเว็บอื่นบน VPS

เป้าหมาย: รันแอป Next.js ใหม่บน subdomain เช่น `beta.yourdomain.com`
โดยเว็บเดิม (HTML dashboard) และเว็บอื่นบน VPS **ทำงานปกติต่อไป**

## หลักการความปลอดภัย (ทุกขั้นตอนเป็น "เพิ่มใหม่" เท่านั้น)

| สิ่งที่ทำ | ทำไมปลอดภัย |
|---|---|
| DNS record ใหม่ (subdomain) | เป็นคนละ record กับของเดิม |
| Docker container แยก + ชื่อเฉพาะ | ไม่ยุ่งกับ process/container อื่น |
| bind `127.0.0.1:3001` (localhost) | ไม่เปิด port ออกเน็ตตรงๆ |
| ไฟล์ nginx **ใหม่** ใน sites-available | ไม่แก้ไฟล์ config เว็บเดิม |
| `nginx -t` ก่อน reload | ถ้า syntax ผิด จะไม่ reload (เว็บเดิมไม่ล่ม) |

> ตั้งตัวแปรไว้ใช้ซ้ำ (แก้ค่าให้เป็นของจริงก่อน):
> ```bash
> DOMAIN=beta.yourdomain.com
> APPDIR=$HOME/apps/minimalcnx
> PORT=3001
> ```

---

## STEP 1 — สร้าง Subdomain ที่ Cloudflare (DNS)

1. Cloudflare → เลือกโดเมน → **DNS → Records → Add record**
2. ใส่ค่า:
   - **Type:** `A`
   - **Name:** `beta`   (จะได้ `beta.yourdomain.com`)
   - **IPv4 address:** `<VPS_IP>` (IP เดียวกับเว็บเดิมได้)
   - **Proxy status:** `Proxied` (เมฆส้ม 🟠 → ได้ SSL + ซ่อน IP ฟรี)
3. Save

> ⚠️ **อย่าแตะ** SSL/TLS mode ของโดเมน (SSL/TLS → Overview) เพราะเป็นค่าระดับ "ทั้งโดเมน"
> ใช้ร่วมกับเว็บอื่น — เราจะทำ nginx ให้เข้ากับ mode ปัจจุบัน (ดู STEP 5)

---

## STEP 2 — ติดตั้ง Docker (ถ้ายังไม่มี)

```bash
# เช็คก่อน — ถ้าขึ้นเวอร์ชัน แปลว่ามีแล้ว ข้ามได้
docker --version || {
  curl -fsSL https://get.docker.com | sudo sh   # official script, ไม่ยุ่งของเดิม
  sudo usermod -aG docker $USER                 # ใช้ docker ไม่ต้อง sudo (ต้อง logout/login)
}
```

## STEP 3 — ดึงโค้ดลง VPS

```bash
mkdir -p "$APPDIR" && cd "$APPDIR"
git clone <YOUR_REPO_URL> .        # repo root = แอป (flatten แล้ว ไม่มีโฟลเดอร์ย่อย)
```

## STEP 4 — Build + Run container (แยกอิสระ)

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_xxxxxxxxxxxxxxxxxxxx" \
  -t minimalcnx:latest .

# bind แค่ localhost:3001 — ออกเน็ตตรงไม่ได้ (nginx เท่านั้นที่ต่อได้)
docker run -d \
  --name minimalcnx \
  --restart unless-stopped \
  -p 127.0.0.1:${PORT}:3000 \
  minimalcnx:latest

# ทดสอบว่าแอปตอบ (ควรได้ HTTP 200)
curl -s -o /dev/null -w "local app -> %{http_code}\n" http://127.0.0.1:${PORT}/login
```

> ค่า `NEXT_PUBLIC_*` เป็น publishable key เปิดเผยได้ — **ห้ามใส่ service_role key**

---

## STEP 5 — Reverse proxy: สร้างไฟล์ nginx ใหม่ (ไม่แก้ของเดิม)

> เช็ค SSL/TLS mode ปัจจุบันที่ Cloudflare (SSL/TLS → Overview) แล้วเลือก **ทางเดียว** ด้านล่าง

### ทางเลือก A — โดเมนตั้งเป็น "Flexible" (Cloudflare ↔ origin ใช้ HTTP)

```bash
sudo tee /etc/nginx/sites-available/minimalcnx > /dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
```

### ทางเลือก B — โดเมนตั้งเป็น "Full" / "Full (strict)" (แนะนำ, origin เข้ารหัส)

1. Cloudflare → **SSL/TLS → Origin Server → Create Certificate** (ใส่ `beta.yourdomain.com`) → คัดลอก cert + key
2. วางลง VPS:
```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/beta.pem   # วาง Origin Certificate
sudo nano /etc/ssl/cloudflare/beta.key   # วาง Private Key
sudo chmod 600 /etc/ssl/cloudflare/beta.key
```
3. สร้าง server block (ฟังทั้ง 80 และ 443 — รองรับทุก mode โดยไม่ต้องแก้ค่าโดเมน):
```bash
sudo tee /etc/nginx/sites-available/minimalcnx > /dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;

    ssl_certificate     /etc/ssl/cloudflare/beta.pem;
    ssl_certificate_key /etc/ssl/cloudflare/beta.key;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF
```

### เปิดใช้งาน (เหมือนกันทั้ง A และ B)

```bash
sudo ln -s /etc/nginx/sites-available/minimalcnx /etc/nginx/sites-enabled/
sudo nginx -t          # ⬅️ ต้องขึ้น "syntax is ok" ก่อน ถ้า error จะไม่ reload
sudo systemctl reload nginx   # reload = เว็บอื่นไม่หลุด
```

> ใช้ **Caddy** แทน nginx? เพิ่มบล็อกใหม่ใน Caddyfile:
> ```
> beta.yourdomain.com {
>     reverse_proxy 127.0.0.1:3001
> }
> ```
> แล้ว `sudo systemctl reload caddy` (Caddy ออก SSL ให้อัตโนมัติ)

---

## STEP 6 — ทดสอบ

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://$DOMAIN/login     # คาดหวัง 200
curl -s -o /dev/null -w "%{http_code}\n" https://$DOMAIN/admin     # คาดหวัง 307 (เด้ง login)
```
เปิดเบราว์เซอร์ → `https://beta.yourdomain.com` → ล็อกอินด้วย user เดิมใน Supabase

---

## STEP 7 — อัปเดตเวอร์ชันใหม่ (รอบถัดไป)

```bash
cd "$APPDIR" && git pull
docker build --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co" \
             --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_xxxxxxxxxxxxxxxxxxxx" \
             -t minimalcnx:latest .
docker rm -f minimalcnx
docker run -d --name minimalcnx --restart unless-stopped -p 127.0.0.1:${PORT}:3000 minimalcnx:latest
```

## ถอนออกทั้งหมด (ถ้าอยากลบ ไม่กระทบเว็บอื่น)

```bash
docker rm -f minimalcnx
docker rmi minimalcnx:latest
sudo rm /etc/nginx/sites-enabled/minimalcnx /etc/nginx/sites-available/minimalcnx
sudo nginx -t && sudo systemctl reload nginx
# แล้วลบ DNS record "beta" ที่ Cloudflare
```

## Checklist

- [ ] DNS `beta` = Proxied 🟠
- [ ] container bind `127.0.0.1:3001` (ไม่ใช่ `0.0.0.0`)
- [ ] nginx block เป็น **ไฟล์ใหม่** — ไม่แก้ของเดิม
- [ ] `nginx -t` ผ่านก่อน reload ทุกครั้ง
- [ ] ไม่เปลี่ยน SSL/TLS mode ระดับโดเมน
- [ ] env มีแค่ `NEXT_PUBLIC_*` (ไม่มี service_role)
- [ ] firewall เปิดเฉพาะ 80/443/22
