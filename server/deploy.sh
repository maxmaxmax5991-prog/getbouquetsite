#!/bin/sh
# Выкладка сайта, админки и серверного кода на сервер venikoff.
# Запуск из папки проекта: sh server/deploy.sh
set -e
# Имя из ~/.ssh/config: ходим через нидерландскую машину (ProxyJump nl).
# Напрямую нельзя: VPN «Дед Proxy» на маке владельца периодически перестаёт
# доходить до российских адресов — молчат разом 22, 80 и 443, хотя сайт жив.
HOST=venikoff
KEY="$HOME/.ssh/venikoff_ed25519"
cd "$(dirname "$0")/.."

# номер версии каталога — чтобы браузеры не показывали старый data.js
perl -pi -e "s#data\.js\?v=\d+#data.js?v=$(date +%s)#" index.html

rsync -az --delete -e ssh server/pb_hooks/ "$HOST:/opt/venikoff/pb/pb_hooks/"
rsync -az --delete -e ssh server/pb_migrations/ "$HOST:/opt/venikoff/pb/pb_migrations/"
rsync -az -e ssh server/bin/ "$HOST:/opt/venikoff/bin/"
rsync -az --delete -e ssh --include='index.html' --include='data.js' --include='img/***' --include='admin/***' --include='add/***' --include='fonts/***' --exclude='*' ./ "$HOST:/opt/venikoff/site/"
ssh "$HOST" 'chown -R venikoff:venikoff /opt/venikoff/pb && chmod -R u=rwX,go=rX /opt/venikoff/site && systemctl restart venikoff-pb && sleep 2 && systemctl is-active venikoff-pb'
curl -s -o /dev/null -w "сайт: %{http_code}\n" https://venikoff.net/
curl -s -o /dev/null -w "каталог: %{http_code}\n" https://venikoff.net/api/shop/catalog
