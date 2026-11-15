#!/bin/sh
# Один раз: даёт GitHub право выкладывать сайт на сервер.
# Запуск на маке из папки проекта: sh server/github-key.sh
#
# Заводит на сервере отдельный ключ только для GitHub (свой ключ владельца
# не трогает) и печатает два секрета, которые надо вставить на GitHub:
# Settings (Настройки) → Secrets and variables (Секреты) → Actions → New repository secret.
# Отозвать доступ: удалить строку «github-deploy» из /root/.ssh/authorized_keys.
set -e
HOST=venikoff
ssh "$HOST" 'set -e
  k=/root/.ssh/github_deploy
  [ -f $k ] || ssh-keygen -q -t ed25519 -N "" -C github-deploy -f $k
  grep -q "$(cut -d" " -f2 $k.pub)" /root/.ssh/authorized_keys || cat $k.pub >> /root/.ssh/authorized_keys
  echo; echo "===== Секрет 1. Имя: DEPLOY_SSH_KEY — скопируйте ВСЁ ниже, включая строки BEGIN и END ====="
  cat $k
  echo; echo "===== Секрет 2. Имя: DEPLOY_KNOWN_HOSTS — скопируйте строки ниже ====="
  for t in ed25519 ecdsa rsa; do f=/etc/ssh/ssh_host_${t}_key.pub; [ -f $f ] && echo "147.45.141.23 $(cut -d" " -f1,2 $f)"; done
  echo "====="'
