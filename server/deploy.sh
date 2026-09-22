#!/bin/sh
# Выкладка сайта, админки и серверного кода на сервер venikoff.
# Запуск из папки проекта: sh server/deploy.sh
set -e
HOST=root@147.45.141.23
KEY="$HOME/.ssh/venikoff_ed25519"
cd "$(dirname "$0")/.."

# номер версии каталога — чтобы браузеры не показывали старый data.js
perl -pi -e "s#data\.js\?v=\d+#data.js?v=$(date +%s)#" index.html

rsync -az --delete -e "ssh -i $KEY" server/pb_hooks/ "$HOST:/opt/venikoff/pb/pb_hooks/"
rsync -az --delete -e "ssh -i $KEY" server/pb_migrations/ "$HOST:/opt/venikoff/pb/pb_migrations/"
rsync -az --delete -e "ssh -i $KEY" --include='index.html' --include='data.js' --include='img/***' --include='admin/***' --exclude='*' ./ "$HOST:/opt/venikoff/site/"
ssh -i "$KEY" "$HOST" 'chown -R venikoff:venikoff /opt/venikoff/pb && chmod -R u=rwX,go=rX /opt/venikoff/site && systemctl restart venikoff-pb && sleep 2 && systemctl is-active venikoff-pb'
curl -s -o /dev/null -w "сайт: %{http_code}\n" https://147-45-141-23.sslip.io/
curl -s -o /dev/null -w "каталог: %{http_code}\n" https://147-45-141-23.sslip.io/api/shop/catalog
