#!/bin/sh
# Все витрины на одном сервере: Caddy отдаёт всем доменам одну и ту же папку,
# а какой бренд показывать, решает сервер по домену запроса.
#   sh server/domains.sh venikoff.net getbouquet.moscow [lasflore.ru …]
# Первый домен — основной: на него ведут голый IP и старый sslip-адрес.
# Пишет Caddyfile целиком — так видно всю настройку разом и нечему рассыпаться.
#
# Страницы сайта (всё, за чем нет файла, и главная) идут на /api/page:
# сервер подставляет в index.html заголовок, описание и текст страницы —
# так их видят Яндекс и Google. Исходный адрес едет в заголовке X-Page-Uri.
set -e
[ $# -ge 1 ] || { echo "Укажите домены: sh server/domains.sh venikoff.net getbouquet.moscow"; exit 1; }
A="$1"
SRV=root@147.45.141.23
KEY=~/.ssh/venikoff_ed25519
[ -f "$KEY" ] || KEY=~/.ssh/id_ed25519

echo "Проверяю, куда смотрят домены…"
# Спрашиваем авторитетные серверы домена, а не публичные резолверы: у тех ответ
# может ещё лежать в кэше, а сертификат выдаётся по авторитетному ответу.
for D in "$@"; do
  NS=$(dig +short NS "$D" | head -1)
  IP=$(dig +short "$D" A ${NS:+@$NS} | tail -1)
  if [ "$IP" != "147.45.141.23" ]; then
    echo "Домен $D показывает на «$IP» (спросили у ${NS:-резолвера}), а нужно 147.45.141.23."
    echo "Поправьте А-запись у регистратора (имя «@» и «www») и подождите 15–60 минут."
    exit 1
  fi
done

SITES=$(printf '%s, ' "$@" | sed 's/, $//')
WWW=""
for D in "$@"; do
  WWW="$WWW
www.$D {
	redir https://$D{uri} permanent
}"
done

echo "Настраиваю Caddy: $SITES…"
ssh -i "$KEY" "$SRV" "cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak && cat > /etc/caddy/Caddyfile <<CFG
(page) {
	rewrite * /api/page
	reverse_proxy 127.0.0.1:8090 {
		header_up X-Forwarded-Host {host}
		header_up X-Page-Uri {http.request.orig_uri}
	}
}

# Все витрины отдаются из одной папки; бренд выбирает сервер по домену.
$SITES {
	encode zstd gzip
	header {
		Strict-Transport-Security \"max-age=31536000\"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	handle /api/* {
		reverse_proxy 127.0.0.1:8090 {
			# по нему сервер и понимает, какая витрина пришла
			header_up X-Forwarded-Host {host}
		}
	}
	# служебная панель PocketBase закрыта снаружи — только через SSH-туннель
	handle /_/* {
		respond 404
	}
	# главная и все адреса без файла — готовая страница от сервера
	@home path / /index.html
	handle @home {
		import page
	}
	@page {
		not path /admin /admin/* /add /add/* /img/* /fonts/*
		not file {
			root /opt/venikoff/site
			try_files {path}
		}
	}
	handle @page {
		import page
	}
	handle {
		root * /opt/venikoff/site
		@html path /admin /admin/ /admin/index.html /add /add/ /add/index.html
		header @html Cache-Control \"no-cache\"
		# шрифты и картинки не меняются — пусть браузер держит их у себя год
		@static path /fonts/* /img/*
		header @static Cache-Control \"public, max-age=31536000, immutable\"
		try_files {path} {path}/index.html
		file_server
	}
}

# www и старые адреса ведут на основной домен своей витрины
$WWW
147-45-141-23.sslip.io, http://147.45.141.23 {
	redir https://$A{uri} permanent
}
CFG
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy"

sleep 5
for D in "$@"; do
  curl -s -o /dev/null -w "$D: %{http_code}\n" "https://$D/" || true
  curl -s -o /dev/null -w "$D/sitemap.xml: %{http_code}\n" "https://$D/sitemap.xml" || true
done
