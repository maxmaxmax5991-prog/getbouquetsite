#!/bin/sh
# Переезд на свой домен. Запускать, когда у домена уже прописан адрес сервера:
#   sh server/domain.sh venikoff.net
# Делает всё разом: настраивает Caddy (сертификат он получит сам),
# меняет адрес сайта в базе и правит адреса в коде.
set -e
D="$1"
[ -n "$D" ] || { echo "Укажите домен: sh server/domain.sh venikoff.net"; exit 1; }
SRV=root@147.45.141.23
KEY=~/.ssh/venikoff_ed25519
[ -f "$KEY" ] || KEY=~/.ssh/id_ed25519

echo "Проверяю, куда смотрит домен…"
IP=$(dig +short "$D" A | tail -1)
if [ "$IP" != "147.45.141.23" ]; then
  echo "ВНИМАНИЕ: $D сейчас показывает на «$IP», а нужно 147.45.141.23."
  echo "Сначала поправьте А-запись у регистратора и подождите (обычно до часа)."
  exit 1
fi

echo "Настраиваю Caddy…"
ssh -i "$KEY" "$SRV" "cat > /etc/caddy/Caddyfile <<CFG
$D {
	encode zstd gzip
	header {
		Strict-Transport-Security \"max-age=31536000\"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	handle /api/* {
		reverse_proxy 127.0.0.1:8090
	}
	# служебная панель PocketBase закрыта снаружи — только через SSH-туннель
	handle /_/* {
		respond 404
	}
	handle {
		root * /opt/venikoff/site
		@html path / /index.html /admin /admin/ /admin/index.html /add /add/ /add/index.html
		header @html Cache-Control \"no-cache\"
		# шрифты и картинки не меняются — пусть браузер держит их у себя год
		@static path /fonts/* /img/*
		header @static Cache-Control \"public, max-age=31536000, immutable\"
		try_files {path} {path}/index.html
		file_server
	}
}

# старые адреса ведут на новый домен, чтобы прежние ссылки не потерялись
www.$D, 147-45-141-23.sslip.io {
	redir https://$D{uri} permanent
}

http://147.45.141.23 {
	redir https://$D{uri} permanent
}
CFG
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
sqlite3 /opt/venikoff/pb/pb_data/data.db \"update settings set site_url = 'https://$D';\"
systemctl restart venikoff-pb"

echo "Правлю адреса в коде…"
for f in index.html admin/index.html server/deploy.sh; do
  sed -i '' "s#147-45-141-23\.sslip\.io#$D#g" "$f"
done

echo "Жду сертификат…"
sleep 15
curl -s -o /dev/null -w "сайт: %%{http_code}\n" "https://$D/" || true
curl -s -o /dev/null -w "каталог: %%{http_code}\n" "https://$D/api/shop/catalog" || true
cat <<TXT

Осталось сделать руками:
 1. В личном кабинете CloudPayments добавить сайт https://$D (иначе оплата не пройдёт).
 2. В админке → Настройки проверить «Адрес сайта»: https://$D
 3. Выложить сайт: sh server/deploy.sh, затем git push
TXT
