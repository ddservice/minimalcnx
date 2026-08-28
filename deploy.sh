#!/usr/bin/env bash
# Deploy/อัปเดตแอปบน VPS แบบบรรทัดเดียว — รันในโฟลเดอร์ minimalcnx: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

SUPABASE_URL="https://fkhfrylvronkmktlmmia.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_SoNHJNrw4yfgZI_RYHHTjg_WgQ0lan-"
IMAGE="minimalcnx:latest"
NAME="minimalcnx"
# พอร์ตจริงบน VPS นี้ (อย่าสลับ — จะทับเว็บอื่น):
#   3001 = mikrotik.conf
#   3002 = cnxhaircutz (next-server บนโฮสต์)
#   3005 = invest3 / apexlink-forensics
#   3011 = minimal.conf + minimalcnx.conf  ← ร้านกาแฟ
#   4000 = tmhccp5 + pems
#   5000 = sop5
HOST_IP="127.0.0.1"
HOST_PORT="3011"
PORT="${HOST_IP}:${HOST_PORT}:3000"

wait_port_free() {
  local i=0
  while ss -tlnH "sport = :${HOST_PORT}" 2>/dev/null | grep -q .; do
    i=$((i + 1))
    if [ "$i" -gt 15 ]; then
      echo "พอร์ต ${HOST_IP}:${HOST_PORT} ยังไม่ว่าง — ใครจับอยู่:"
      ss -tlnp "sport = :${HOST_PORT}" || true
      docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Ports}}' || true
      exit 1
    fi
    echo "รอพอร์ต ${HOST_PORT} ว่าง (${i}/15)..."
    sleep 1
  done
}

echo "==> git pull"
git pull --ff-only || echo "(ข้าม pull — อาจมี local change)"

echo "==> docker build"
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  -t "$IMAGE" .

echo "==> restart container (ชื่อ ${NAME} / พอร์ต ${HOST_PORT})"
echo "    ห้ามยุ่ง 3001(mikrotik) 3002(haircut) 3005(forensics) 4000 5000"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
ss -tlnp | grep -E "127\\.0\\.0\\.1:30|127\\.0\\.0\\.1:4000|127\\.0\\.0\\.1:5000" || true

# ห้าม docker rm ชื่ออื่น (เช่น apexlink-forensics ใช้ 3005)
docker rm -f "$NAME" marim69-beta 2>/dev/null || true
wait_port_free
docker run -d --name "$NAME" --restart unless-stopped -p "$PORT" "$IMAGE"

echo "==> cleanup docker dangling images & build cache"
docker image prune -f --filter "until=24h" 2>/dev/null || docker image prune -f 2>/dev/null || true
docker builder prune -f --keep-storage 2GB 2>/dev/null || true

echo "==> health check (รอจนกว่า Next.js จะพร้อมทำงาน)"
for i in {1..15}; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${HOST_PORT}/login || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "app ready -> HTTP 200"
    exit 0
  fi
  echo "รอ Next.js container บูต (${i}/15, status ${CODE})..."
  sleep 2
done
echo "⚠️ Container ยังไม่ตอบรับ HTTP 200 หลัง 30 วิ (status ${CODE})"
