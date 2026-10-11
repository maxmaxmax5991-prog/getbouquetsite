#!/bin/sh
# Резервные серверы магазина. Запускать с рабочего компьютера из папки проекта.
#
#   sh server/reserve.sh add <адрес> [название]  — подготовить резервный сервер и
#                                                   включить копирование на него
#   sh server/reserve.sh status                   — давно ли каждый резерв получил копию
#   sh server/reserve.sh promote <адрес> [--now]  — перенести магазин на резервный
#   sh server/reserve.sh remove <адрес>           — перестать копировать на адрес
#
# Устройство (подробно — РЕЗЕРВ.md):
# - основной сервер каждые две минуты копирует на резервные базу, фото, код,
#   сайт и сертификаты (server/bin/reserve-sync.sh, cron);
# - на резервных всё лежит готовым, но PocketBase выключен: два работающих
#   магазина с одними ботами отнимали бы друг у друга сообщения и слали бы
#   заказы в МойСклад дважды;
# - магазин запускается только там, куда указывает домен
#   (server/bin/reserve-guard.sh перед каждым запуском PocketBase), поэтому
#   ожившая после аварии старая машина сама себя не включит.
#
# Адрес основного сервера — в server/primary-ip (его же читает deploy.sh).
set -e
cd "$(dirname "$0")/.."
PRIMARY_IP=${VENIKOFF_IP:-$(cat server/primary-ip)}
KEY=~/.ssh/venikoff_ed25519
[ -f "$KEY" ] || KEY=~/.ssh/id_ed25519
SSHO="-i $KEY -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new"
P=root@$PRIMARY_IP
R=/opt/venikoff/reserve

# Куда сейчас указывает основной домен — по авторитетному серверу, без кэша
dns_ip() {
  NS=$(dig +short NS "$1" | head -1)
  dig +short A "$1" ${NS:+@$NS} | grep -E '^[0-9]+(\.[0-9]+){3}$' | tail -1
}

# Домены витрин: из базы, основной (venikoff.net) первым
domains() {
  [ -n "${DOMAINS:-}" ] && { echo "$DOMAINS"; return; }
  D=$(ssh $SSHO "$P" "sqlite3 /opt/venikoff/pb/pb_data/data.db \"select lower(replace(domain,'www.','')) from brands where domain != '' order by domain != 'venikoff.net', domain\"" 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')
  echo "${D:-venikoff.net getbouquet.moscow}"
}

case "${1:-}" in

add)
  IP=${2:?Укажите адрес резервного сервера: sh server/reserve.sh add 1.2.3.4 Петербург}
  NAME=${3:-$IP}
  S=root@$IP
  [ "$IP" != "$PRIMARY_IP" ] || { echo "Это адрес основного сервера."; exit 1; }
  DOMAINS=$(domains)
  MAIN=${DOMAINS%% *}
  if [ "$(dns_ip "$MAIN")" = "$IP" ]; then
    echo "$MAIN сейчас указывает на $IP — это рабочий магазин, делать его резервом нельзя."
    exit 1
  fi

  echo "1/6 Проверяю вход на $IP…"
  ssh $SSHO "$S" true || {
    echo "Не могу войти на $IP. Добавьте ключ ~/.ssh/venikoff_ed25519.pub серверу в панели хостинга"
    echo "(раздел «SSH-ключи», у Timeweb ещё галочка на вкладке «Доступ» самого сервера)."
    exit 1
  }
  PV=$(ssh $SSHO "$P" '. /etc/os-release; echo "$ID $VERSION_ID"')
  SV=$(ssh $SSHO "$S" '. /etc/os-release; echo "$ID $VERSION_ID"')
  [ "$PV" = "$SV" ] || echo "   Внимание: на основном $PV, на резервном $SV. Лучше одинаковые — иначе может не завестись вырезка фона."

  echo "2/6 Ставлю на резервный нужные программы…"
  ssh $SSHO "$S" 'set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq rsync sqlite3 dnsutils ufw cron python3-venv >/dev/null
    id venikoff >/dev/null 2>&1 || useradd --system --home-dir /opt/venikoff --shell /usr/sbin/nologin venikoff
    getent group caddy >/dev/null || groupadd --system caddy
    id caddy >/dev/null 2>&1 || useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
    mkdir -p /opt/venikoff/pb/pb_data /opt/venikoff/site /opt/venikoff/bin /opt/venikoff/reserve/snap /etc/caddy /var/lib/caddy/.local/share/caddy
    chmod 700 /opt/venikoff/reserve/snap
    # если здесь когда-то был магазин — выключаем: резерв только хранит копию
    systemctl disable --now venikoff-pb >/dev/null 2>&1 || true
    ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
    ufw --force enable >/dev/null'

  echo "3/6 Готовлю основной сервер…"
  rsync -az -e "ssh $SSHO" server/bin/ "$P:/opt/venikoff/bin/"
  PUB=$(ssh $SSHO "$P" "DOMAINS='$DOMAINS' MY_IP='$PRIMARY_IP' sh -s" <<'EOS'
set -e
command -v dig >/dev/null && command -v sqlite3 >/dev/null && command -v rsync >/dev/null && command -v flock >/dev/null \
  || { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq dnsutils sqlite3 rsync util-linux >/dev/null; }
mkdir -p /opt/venikoff/reserve
printf 'DOMAINS="%s"\nMY_IP=%s\n' "$DOMAINS" "$MY_IP" >/opt/venikoff/reserve/conf
[ -f /root/.ssh/reserve_ed25519 ] || ssh-keygen -q -t ed25519 -N '' -C venikoff-reserve -f /root/.ssh/reserve_ed25519
# Сторож перед запуском магазина. Сначала проверяем, что здесь он разрешает —
# иначе следующая выкладка не подняла бы рабочий сайт.
/opt/venikoff/bin/reserve-guard.sh >&2 || { echo "Сторож считает, что домен смотрит не сюда — отменяю." >&2; exit 1; }
mkdir -p /etc/systemd/system/venikoff-pb.service.d
printf '[Service]\nExecStartPre=+/opt/venikoff/bin/reserve-guard.sh\n' >/etc/systemd/system/venikoff-pb.service.d/reserve-guard.conf
systemctl daemon-reload
cat /root/.ssh/reserve_ed25519.pub
EOS
)

  echo "4/6 Пускаю основной сервер на резервный (только с его адреса)…"
  ssh $SSHO "$S" "set -e
    mkdir -p /root/.ssh && touch /root/.ssh/authorized_keys
    sed -i '/venikoff-reserve/d' /root/.ssh/authorized_keys
    echo 'from=\"$PRIMARY_IP\",restrict $PUB' >>/root/.ssh/authorized_keys
    printf 'DOMAINS=\"%s\"\nMY_IP=%s\n' '$DOMAINS' '$IP' >$R/conf"

  echo "5/6 Первая копия: программы, база, фото, сайт, сертификаты (первый раз может занять несколько минут)…"
  ssh $SSHO "$P" "IP='$IP' NAME='$NAME' sh -s" <<'EOS'
set -e
R=/opt/venikoff/reserve
touch /root/.ssh/known_hosts
ssh-keygen -R "$IP" >/dev/null 2>&1 || true
ssh-keyscan -T 10 "$IP" 2>/dev/null >>/root/.ssh/known_hosts
E="ssh -i /root/.ssh/reserve_ed25519 -o BatchMode=yes -o ConnectTimeout=10"
T="root@$IP"
# Caddy и службы — те же, что на основном: одна версия, одни настройки
rsync -a -e "$E" /usr/bin/caddy "$T:/usr/bin/caddy"
rsync -a -e "$E" "$(systemctl show -p FragmentPath --value caddy)" "$T:/etc/systemd/system/caddy.service"
rsync -a -e "$E" "$(systemctl show -p FragmentPath --value venikoff-pb)" "$T:/etc/systemd/system/venikoff-pb.service"
[ -d /etc/systemd/system/venikoff-pb.service.d ] && rsync -a --delete -e "$E" /etc/systemd/system/venikoff-pb.service.d/ "$T:/etc/systemd/system/venikoff-pb.service.d/"
for f in $(systemctl show -p EnvironmentFiles --value venikoff-pb | tr ' ' '\n' | grep '^/'); do
  [ -f "$f" ] && rsync -aR -e "$E" "$f" "$T:/"
done
# окружение для вырезки фона (большое, копируется один раз)
[ -d /opt/venikoff/bg ] && rsync -a --delete -e "$E" /opt/venikoff/bg/ "$T:/opt/venikoff/bg/"
grep -q "^$IP\( \|$\)" $R/hosts 2>/dev/null || echo "$IP $NAME" >>$R/hosts
echo '*/2 * * * * root /opt/venikoff/bin/reserve-sync.sh' >/etc/cron.d/venikoff-reserve
chmod 644 /etc/cron.d/venikoff-reserve
# первая копия — сразу, не дожидаясь cron
/opt/venikoff/bin/reserve-sync.sh
ERR=$(cat $R/err/$IP 2>/dev/null)
[ -z "$ERR" ] || { echo "Копия не удалась: $ERR"; tail -5 $R/log; exit 1; }
EOS

  echo "6/6 Включаю Caddy на резервном и проверяю…"
  ssh $SSHO "$S" 'set -e
    systemctl daemon-reload
    systemctl disable venikoff-pb >/dev/null 2>&1 || true
    chown -R caddy:caddy /var/lib/caddy
    chown -R venikoff:venikoff /opt/venikoff/pb
    systemctl enable caddy >/dev/null 2>&1
    systemctl restart caddy
    sqlite3 /opt/venikoff/pb/pb_data/data.db "pragma quick_check" | grep -qx ok || { echo "Копия базы на резервном битая!"; exit 1; }
    su -s /bin/sh venikoff -c "/opt/venikoff/pb/pocketbase --version"'
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$MAIN:443:$IP" "https://$MAIN/admin/" || true)
  echo "   Сайт на резервном (без магазина): $CODE — должно быть 200"
  echo
  echo "Готово. $NAME ($IP) получает копию каждые две минуты."
  echo "Проверить: sh server/reserve.sh status"
  ;;

status)
  echo "Основной: $PRIMARY_IP"
  ssh $SSHO "$P" "sh -s" <<'EOS'
R=/opt/venikoff/reserve
[ -s $R/hosts ] || { echo "Резервных серверов нет."; exit 0; }
NOW=$(date +%s)
LAST=$(sqlite3 /opt/venikoff/pb/pb_data/data.db "select max(number) from orders")
echo "Последний заказ здесь: №$LAST"
while read -r IP NAME; do
  case "$IP" in ''|\#*) continue ;; esac
  OK=$(cat $R/ok/$IP 2>/dev/null || echo 0)
  ERR=$(cat $R/err/$IP 2>/dev/null)
  if [ "$OK" -gt 0 ]; then AGO="$(( (NOW - OK) / 60 )) мин назад"; else AGO="ни разу"; fi
  THERE=$(ssh -n -i /root/.ssh/reserve_ed25519 -o BatchMode=yes -o ConnectTimeout=8 root@$IP \
    "sqlite3 /opt/venikoff/pb/pb_data/data.db 'select max(number) from orders'" 2>/dev/null || echo "?")
  echo "- ${NAME:-$IP} ($IP): копия $AGO, последний заказ там №$THERE${ERR:+ — ОШИБКА: $ERR}"
done <$R/hosts
EOS
  ;;

promote)
  IP=${2:?Укажите адрес резервного сервера: sh server/reserve.sh promote 1.2.3.4}
  NOW_FLAG=${3:-}
  S=root@$IP
  DOMAINS=${DOMAINS:-$(ssh $SSHO "$S" ". $R/conf; echo \"\$DOMAINS\"")}
  MAIN=${DOMAINS%% *}
  ssh $SSHO "$S" true || { echo "Не могу войти на $IP."; exit 1; }

  echo "1/4 Останавливаю магазин на основном ($PRIMARY_IP), если он отвечает…"
  if ssh -i "$KEY" -o ConnectTimeout=8 -o BatchMode=yes "$P" "systemctl stop venikoff-pb" 2>/dev/null; then
    echo "   Остановлен. Делаю последнюю копию — заказы не потеряются."
    # магазин стоит, база больше не меняется: копия будет точной
    ssh -i "$KEY" -o ConnectTimeout=8 "$P" "rm -f /etc/cron.d/venikoff-reserve; grep '^$IP' $R/hosts >$R/hosts.one; mv $R/hosts $R/hosts.was; mv $R/hosts.one $R/hosts; /opt/venikoff/bin/reserve-sync.sh; cat $R/err/$IP; mv $R/hosts.was $R/hosts.old; rm -f $R/hosts; systemctl disable venikoff-pb" || echo "   Последняя копия не удалась — останется та, что была."
  else
    echo "   Основной не отвечает. На резервном копия от:"
    ssh $SSHO "$S" "date -r $R/snap/data.db '+%d.%m %H:%M'; sqlite3 /opt/venikoff/pb/pb_data/data.db 'select \"   последний заказ №\" || max(number) from orders'"
    echo "   Заказы, оформленные после этого, остались на основном (они есть в Телеграме и МоёмСкладе)."
  fi

  echo "2/4 Закрываю резервный от старого основного, чтобы тот не затёр новую базу…"
  ssh $SSHO "$S" "sed -i '/venikoff-reserve/d' /root/.ssh/authorized_keys"

  if [ "$NOW_FLAG" = "--now" ]; then
    echo "3/4 Запускаю сразу, не дожидаясь смены адреса у регистратора."
    ssh $SSHO "$S" "touch $R/force"
  else
    echo "3/4 Смените адрес у регистратора (reg.ru → Домены → домен → «DNS-серверы и управление зоной»):"
    for D in $DOMAINS; do echo "     $D: записи A «@» и «www» → $IP"; done
    echo "   Жду, когда $MAIN начнёт указывать на $IP (проверяю раз в 20 секунд, до часа)…"
    i=0
    while [ "$(dns_ip "$MAIN")" != "$IP" ]; do
      i=$((i + 1)); [ $i -le 180 ] || { echo "   Не дождался. Запустите заново или с --now."; exit 1; }
      sleep 20
    done
  fi

  echo "4/4 Включаю магазин на $IP…"
  ssh $SSHO "$S" "set -e
    chown -R venikoff:venikoff /opt/venikoff/pb
    systemctl enable --now venikoff-pb
    systemctl restart caddy
    sleep 3; systemctl is-active venikoff-pb"
  echo "$IP" >server/primary-ip
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$MAIN:443:$IP" "https://$MAIN/api/shop/catalog" || true)
  echo "   Каталог на новом сервере: $CODE — должно быть 200"
  echo
  echo "Магазин работает на $IP. Адрес записан в server/primary-ip — сохраните его в git"
  echo "(git commit -am 'Основной сервер — $IP' && git push), иначе выкладка уйдёт на старый."
  echo "Остальные резервы теперь надо подключить к новому основному: sh server/reserve.sh add <адрес>"
  ;;

remove)
  IP=${2:?Укажите адрес}
  ssh $SSHO "$P" "sed -i '/^$IP\( \|\$\)/d' $R/hosts; rm -f $R/ok/$IP $R/err/$IP"
  ssh $SSHO "root@$IP" "sed -i '/venikoff-reserve/d' /root/.ssh/authorized_keys" || true
  echo "Копирование на $IP выключено."
  ;;

*)
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
