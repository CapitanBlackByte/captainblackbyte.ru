#!/bin/sh
# Ставит приём заявок на сервер сайта. Запуск из этой папки: sudo sh install.sh
set -eu

SERVICE=captainblackbyte-inbox
APP_DIR=/opt/$SERVICE
DOMAIN=captainblackbyte.ru
HERE=$(cd "$(dirname "$0")" && pwd)

fail() {
  echo "Ошибка: $1" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || fail "запустите через sudo."
[ -f "$HERE/.env" ] || fail "рядом со скриптом нет файла .env с INBOX_TOKEN."
command -v systemctl >/dev/null 2>&1 || fail "нужен systemd."
command -v nginx >/dev/null 2>&1 || fail "не найден nginx."

if ! command -v node >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || fail "установите Node.js 20.12 или новее."
  echo "==> Устанавливаю Node.js"
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
node -e "process.exit(typeof process.loadEnvFile === 'function' ? 0 : 1)" || fail "нужен Node.js 20.12 или новее, сейчас $(node -v)."
NODE_BIN=$(command -v node)

echo "==> Копирую файлы в $APP_DIR"
id "$SERVICE" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE"
mkdir -p "$APP_DIR/data"
cp "$HERE/inbox.mjs" "$APP_DIR/inbox.mjs"
cp "$HERE/.env" "$APP_DIR/.env"
chown -R "$SERVICE:$SERVICE" "$APP_DIR"
chmod 700 "$APP_DIR/data"
chmod 600 "$APP_DIR/.env"

echo "==> Запускаю службу $SERVICE"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Captain Black Byte site orders inbox
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN inbox.mjs
Restart=always
RestartSec=5
User=$SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

echo "==> Настраиваю nginx"
SNIPPET=/etc/nginx/snippets/$SERVICE.conf
mkdir -p /etc/nginx/snippets
cat > "$SNIPPET" <<'EOF'
location /api/orders {
    proxy_pass http://127.0.0.1:8790;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 64k;
}
EOF

CONF=$(grep -ls "server_name.*$DOMAIN" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf /etc/nginx/nginx.conf 2>/dev/null | head -n 1 || true)
[ -n "$CONF" ] || fail "не нашёл настройки nginx для $DOMAIN. Добавьте в блок server строку: include $SNIPPET;"
CONF=$(readlink -f "$CONF")

if grep -q "$SNIPPET" "$CONF"; then
  echo "Настройки nginx уже содержат приём заявок."
else
  cp "$CONF" "$CONF.before-inbox"
  sed -i "/server_name.*$DOMAIN/a\\    include $SNIPPET;" "$CONF"
  if ! nginx -t >/dev/null 2>&1; then
    cp "$CONF.before-inbox" "$CONF"
    fail "nginx не принял настройки, файл $CONF возвращён как был."
  fi
fi
nginx -t >/dev/null 2>&1 || fail "настройки nginx содержат ошибку."
systemctl reload nginx

echo "==> Проверяю"
sleep 1
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" http://127.0.0.1:8790/api/orders/pending || true)
[ "$STATUS" = "401" ] || fail "приём заявок не отвечает, смотрите: journalctl -u $SERVICE"
echo "Готово. Приём заявок работает и закрыт ключом."
