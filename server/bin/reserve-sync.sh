#!/bin/sh
# Копия магазина на резервные серверы. Работает на ОСНОВНОМ сервере от root,
# по cron каждые две минуты (/etc/cron.d/venikoff-reserve). Ставит его
# `sh server/reserve.sh add <адрес>` с рабочего компьютера.
#
# Что копируется на каждый адрес из /opt/venikoff/reserve/hosts:
#   база — снимком через sqlite3 .backup (живую data.db копировать нельзя:
#          посреди записи выйдет битый файл), фото и ежедневные копии из pb_data,
#   код сервера, сайт, скрипты, настройки Caddy и его сертификаты — чтобы после
#          переключения HTTPS заработал сразу, без ожидания нового сертификата.
#
# На резервном PocketBase остановлен и выключен. Если там он вдруг работает
# (сервер уже назначен основным), копирование туда отказывается: иначе мы
# затёрли бы живую базу старой.
#
# Итог по каждому адресу — в /opt/venikoff/reserve/ok/<адрес> (время последней
# удачной копии) и err/<адрес> (текст ошибки). Их читает сторож (watchdog.pb.js)
# и пишет в служебный бот, если резерв отстал.
set -u
R=/opt/venikoff/reserve
PB=/opt/venikoff/pb
HOSTS=$R/hosts
[ -s "$HOSTS" ] || exit 0
mkdir -p "$R/ok" "$R/err" "$R/snap"
chmod 755 "$R" "$R/ok" "$R/err"
chmod 700 "$R/snap"
exec 9>"$R/lock"
flock -n 9 || exit 0
log() { echo "$(date '+%F %T') $*" >>"$R/log"; }

# Домен смотрит уже не сюда — значит, работу перенесли на другой сервер, а этот
# ожил. Магазин здесь останавливаем и ничего никуда не копируем.
if ! /opt/venikoff/bin/reserve-guard.sh 2>>"$R/log"; then
  if systemctl is-active -q venikoff-pb; then
    systemctl stop venikoff-pb
    log "домен смотрит на другой сервер — остановил магазин здесь"
  fi
  exit 0
fi

KEY=/root/.ssh/reserve_ed25519
SSH="ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"

# Снимок базы — один на все адреса
if ! sqlite3 "$PB/pb_data/data.db" ".timeout 20000" ".backup '$R/snap/data.db.tmp'" 2>>"$R/log"; then
  rm -f "$R/snap/data.db.tmp"
  while read -r IP _; do
    case "$IP" in ''|\#*) continue ;; esac
    echo "не удалось снять копию базы на основном сервере" >"$R/err/$IP"
  done <"$HOSTS"
  log "снимок базы не удался"
  exit 1
fi
mv -f "$R/snap/data.db.tmp" "$R/snap/data.db"

CADDY_DATA=/var/lib/caddy/.local/share/caddy

sync_one() {
  IP=$1
  T="root@$IP"
  # 1. Там уже работает магазин? Тогда это не резерв, а новый основной.
  if $SSH "$T" 'systemctl is-active -q venikoff-pb'; then
    echo "на резервном работает магазин — копирование остановлено, чтобы не затереть его базу" ; return 1
  fi
  # 2. Фото, ежедневные копии и прочее из pb_data — кроме самих баз
  rsync -a --delete -e "$SSH" \
    --exclude '/data.db' --exclude '/data.db-*' --exclude '/data.db.new' \
    --exclude '/auxiliary.db' --exclude '/auxiliary.db-*' \
    "$PB/pb_data/" "$T:$PB/pb_data/" || { echo "не скопировались фото и файлы базы"; return 1; }
  # 3. База. Сначала в постоянную копию на той стороне (rsync передаёт только
  # изменившиеся куски, а не всю базу), потом рядом с рабочей и подменой одним
  # шагом — рабочая копия всегда целая, даже если связь оборвалась посередине.
  rsync -a --inplace -e "$SSH" "$R/snap/data.db" "$T:$R/snap/data.db" || { echo "не скопировалась база"; return 1; }
  $SSH "$T" "cp $R/snap/data.db $PB/pb_data/data.db.new && cd $PB/pb_data && rm -f data.db-wal data.db-shm && mv -f data.db.new data.db && chown -R venikoff:venikoff $PB/pb_data" \
    || { echo "не удалось подменить базу"; return 1; }
  # 4. Код сервера (pocketbase, pb_hooks, pb_migrations), сайт, скрипты
  rsync -a --delete -e "$SSH" --exclude '/pb_data' "$PB/" "$T:$PB/" || { echo "не скопировался код сервера"; return 1; }
  rsync -a --delete -e "$SSH" /opt/venikoff/site/ "$T:/opt/venikoff/site/" || { echo "не скопировался сайт"; return 1; }
  rsync -a -e "$SSH" /opt/venikoff/bin/ "$T:/opt/venikoff/bin/" || { echo "не скопировались скрипты"; return 1; }
  # 5. Caddy: настройка и сертификаты. Изменилась настройка — перечитать.
  CH=$(rsync -a -i -e "$SSH" /etc/caddy/Caddyfile "$T:/etc/caddy/Caddyfile") || { echo "не скопирована настройка Caddy"; return 1; }
  if [ -d "$CADDY_DATA" ]; then
    rsync -a --delete -e "$SSH" "$CADDY_DATA/" "$T:$CADDY_DATA/" || { echo "не скопированы сертификаты"; return 1; }
  fi
  if [ -n "$CH" ]; then
    $SSH "$T" 'chown -R caddy:caddy /var/lib/caddy; caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy' || true
  fi
  return 0
}

while read -r IP _; do
  case "$IP" in ''|\#*) continue ;; esac
  # </dev/null: иначе ssh съест остаток списка адресов
  OUT=$(sync_one "$IP" </dev/null 2>&1)
  if [ $? -eq 0 ]; then
    date +%s >"$R/ok/$IP"
    : >"$R/err/$IP"
  else
    MSG=$(printf '%s' "$OUT" | tail -1)
    printf '%s\n' "$MSG" >"$R/err/$IP"
    log "$IP: $OUT"
  fi
  chmod 644 "$R/ok/$IP" "$R/err/$IP" 2>/dev/null
done <"$HOSTS"

# журнал не должен расти бесконечно
[ "$(wc -c <"$R/log" 2>/dev/null || echo 0)" -gt 1000000 ] && tail -n 2000 "$R/log" >"$R/log.tmp" && mv "$R/log.tmp" "$R/log"
exit 0
