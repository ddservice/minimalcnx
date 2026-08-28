#!/usr/bin/env bash
#
# vps-clean.sh — สคริปต์ทำความสะอาดไฟล์ขยะ จัดระเบียบระบบ และบังคับใช้นโยบายลบไฟล์เก่า 90 วันบน VPS
#
# ใช้งาน:
#   cd ~/apps/minimalcnx && bash scripts/vps-clean.sh
#

set -euo pipefail

log() { printf '[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"; }

echo "========================================================"
echo "   MinimalCNX VPS Maintenance & Housekeeping Tool"
echo "========================================================"

log "พื้นที่ดิสก์ก่อนทำความสะอาด:"
df -h / | awk 'NR==1 || NR==2'

# 1. จัดการ Docker (ล้าง Image ขยะ และ Cache แต่ไม่แตะต้อง Container อื่น)
log "==> 1/5 ตรวจสอบและทำความสะอาด Docker cache & dangling images..."
if command -v docker >/dev/null 2>&1; then
  docker image prune -f --filter "until=24h" 2>/dev/null || docker image prune -f 2>/dev/null || true
  docker builder prune -f --keep-storage 2GB 2>/dev/null || true
  log "✅ เคลียร์ Docker dangling images และ builder cache เรียบร้อย"
else
  log "⚠️ ไม่พบคำสั่ง docker ข้ามขั้นตอนนี้"
fi

# 2. ทำความสะอาด Systemd Journal Logs
log "==> 2/5 จำกัดขนาด System Journal Logs..."
if command -v journalctl >/dev/null 2>&1; then
  sudo journalctl --vacuum-size=100M 2>/dev/null || journalctl --vacuum-size=100M 2>/dev/null || true
  log "✅ จำกัด Journal logs ไม่เกิน 100M เรียบร้อย"
fi

# 3. ลบไฟล์ขยะชั่วคราวใน /tmp ที่ค้างเกิน 7 วัน
log "==> 3/5 ตรวจสอบไฟล์ขยะชั่วคราวใน /tmp..."
find /tmp -maxdepth 2 -type f \( -name "tmp.*" -o -name "core.*" \) -mtime +7 -delete 2>/dev/null || true
log "✅ ล้างไฟล์ชั่วคราวเก่าใน /tmp เรียบร้อย"

# 4. ลบไฟล์ Backup ท้องถิ่นที่เก่าเกิน 90 วัน (Local 90-day retention)
log "==> 4/5 บังคับใช้นโยบายลบ Backup เก่าเกิน 90 วัน..."
BACKUP_DIRS=("$HOME/backups" "$HOME/apps/minimalcnx/backups" "/var/backups/minimalcnx")
for bdir in "${BACKUP_DIRS[@]}"; do
  if [ -d "$bdir" ]; then
    DELETED_COUNT=$(find "$bdir" -type f \( -name "*.dump" -o -name "*.dump.age" -o -name "*.tar.gz" \) -mtime +90 2>/dev/null | wc -l || echo 0)
    if [ "$DELETED_COUNT" -gt 0 ]; then
      find "$bdir" -type f \( -name "*.dump" -o -name "*.dump.age" -o -name "*.tar.gz" \) -mtime +90 -delete 2>/dev/null || true
      log "ลบไฟล์ backup เก่าเกิน 90 วันใน $bdir ไปทั้งหมด $DELETED_COUNT ไฟล์"
    else
      log "ไม่มีไฟล์ backup เก่าเกิน 90 วันตกค้างใน $bdir"
    fi
  fi
done

# 5. จัดระเบียบ Log ไฟล์
log "==> 5/5 หมุนเวียนและจำกัดขนาด backup.log..."
LOG_FILE="$HOME/backup.log"
if [ -f "$LOG_FILE" ]; then
  LINES=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "$LINES" -gt 2500 ]; then
    tail -n 1500 "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE" 2>/dev/null || true
    log "ตัดแต่ง $LOG_FILE จาก $LINES บรรทัดเหลือ 1500 บรรทัด"
  else
    log "$LOG_FILE มี $LINES บรรทัด (ปกติ)"
  fi
fi

echo "--------------------------------------------------------"
log "พื้นที่ดิสก์หลังทำความสะอาด:"
df -h / | awk 'NR==1 || NR==2'
echo "========================================================"
log "🎉 ทำความสะอาดและจัดระเบียบระบบ VPS เสร็จสมบูรณ์!"
