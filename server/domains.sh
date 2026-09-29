#!/bin/sh
# Две витрины на одном сервере: Caddy отдаёт обоим доменам одну и ту же папку,
# а какой бренд показывать, решает сервер по домену запроса.
#   sh server/domains.sh venikoff.net getbouquet.moscow
# Пишет Caddyfile целиком — так видно всю настройку разом и нечему рассыпаться.
set -e
A="$1"; B="$2"
[ -n "$A" ] && [ -n "$B" ] || { echo "Укажите оба домена: sh server/domains.sh venikoff.net getbouquet.moscow"; exit 1; }
SRV=root@147.45.141.23
KEY=~/.ssh/venikoff_ed25519
[ -f "$KEY" ] || KEY=~/.ssh/id_ed25519

echo "Проверяю, куда смотрят домены…"
for D in "$A" "$B"; do
  IP=$(dig +short "$D" A @8.8.8.8 | tail -1)
  if [ "$IP" != "147.45.141.23" ]; then
    echo "Домен $D показывает на «$IP», а нужно 147.45.141.23."
    echo "Поправьте А-запись у регистратора (имя «@» и «www») и подождите 15–60 минут."
    exit 1
  fi
done

echo "Настраиваю Caddy на оба домена…"
ssh -i "$KEY" "$SRV" "cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak && cat > /etc/caddy/Caddyfile <<CFG
# Обе витрины отдаются из одной папки; бренд выбирает сервер по домену.
$A, $B {
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

# www и старые адреса ведут на основной домен своей витрины
www.$A, 147-45-141-23.sslip.io {
	redir https://$A{uri} permanent
}
www.$B {
	redir https://$B{uri} permanent
}
http://147.45.141.23 {
	redir https://$A{uri} permanent
}
CFG
caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy"

echo "Жду сертификат для $B…"
sleep 20
for D in "$A" "$B"; do
  curl -s -o /dev/null -w "$D: %{http_code}\n" "https://$D/" || true
done
