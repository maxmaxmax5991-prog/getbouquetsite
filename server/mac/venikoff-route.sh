#!/bin/sh
# Пускает серверы venikoff мимо туннеля системного VPN «DedProxy».
# VPN заворачивает в себя маршруты до этих адресов, и до них не доходит TCP:
# ping идёт, а ssh и https молчат. Лечится host-маршрутом через шлюз Wi-Fi.
# Маршрут умирает при каждой смене сети, поэтому скрипт зовёт демон
# net.venikoff.route — при смене сети и раз в две минуты на всякий случай.
set -u

IPS="147.45.141.23 201.34.130.242"
LOG=/var/log/venikoff-route.log

# Шлюз берём у физического интерфейса (en0/en1...), а не у туннеля utun.
# После пробуждения мака адрес появляется не сразу — ждём до 20 секунд.
GW=""
i=0
while [ $i -lt 10 ]; do
  GW=$(netstat -rn -f inet | awk '$1=="default" && $NF ~ /^en[0-9]+$/ {print $2; exit}')
  [ -n "$GW" ] && break
  i=$((i + 1))
  sleep 2
done
if [ -z "$GW" ]; then
  echo "$(date '+%F %T') шлюза en* нет — сети ещё нет, выхожу" >>"$LOG"
  exit 0
fi

for ip in $IPS; do
  CUR=$(netstat -rn -f inet | awk -v a="$ip" '$1==a {print $2; exit}')
  [ "$CUR" = "$GW" ] && continue          # уже правильный — не трогаем
  route -n delete -host "$ip" >/dev/null 2>&1
  if route -n add -host "$ip" "$GW" >/dev/null 2>&1; then
    echo "$(date '+%F %T') $ip -> $GW" >>"$LOG"
  else
    echo "$(date '+%F %T') $ip -> $GW НЕ УДАЛОСЬ" >>"$LOG"
  fi
done
