#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "deploy-linux.sh must be run as root" >&2
  exit 1
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
backend_source="${project_root}/backend"
frontend_source="${project_root}/frontend"
backend_target=/opt/otabek-1c/backend
frontend_target=/var/www/otabek-1c
backup_root=/var/lib/otabek-1c/backups
service_name=otabek-1c.service
service_stopped=false

restart_after_failure() {
  if [[ ${service_stopped} == true ]]; then
    systemctl start "${service_name}" || true
  fi
}
trap restart_after_failure EXIT

if [[ ${backend_target} != /opt/otabek-1c/backend || ${frontend_target} != /var/www/otabek-1c ]]; then
  echo "Refusing deploy: unexpected target paths" >&2
  exit 1
fi

for command in curl npm pg_dump rsync runuser systemctl; do
  command -v "${command}" >/dev/null || { echo "Missing command: ${command}" >&2; exit 1; }
done

cd "${frontend_source}"
npm ci
npm run typecheck
npm run build

install -d -o otabek1c -g otabek1c -m 750 "${backup_root}"
backup_file="${backup_root}/otabek1c-$(date -u +%Y%m%dT%H%M%SZ).dump"
runuser -u otabek1c -- pg_dump --format=custom --file="${backup_file}" otabek1c

systemctl stop "${service_name}"
service_stopped=true
rsync --archive --delete \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='development.sqlite3' \
  --exclude='media' \
  --exclude='staticfiles' \
  "${backend_source}/" "${backend_target}/"
chown -R otabek1c:otabek1c "${backend_target}"

runuser -u otabek1c -- /opt/otabek-1c/venv/bin/pip install --disable-pip-version-check -r "${backend_target}/requirements.txt"
runuser -u otabek1c -- env \
  DJANGO_DEBUG=true \
  POSTGRES_HOST=/var/run/postgresql \
  POSTGRES_PORT=5432 \
  POSTGRES_DB=otabek1c \
  POSTGRES_USER=otabek1c \
  POSTGRES_PASSWORD= \
  /opt/otabek-1c/venv/bin/python "${backend_target}/manage.py" migrate --noinput
runuser -u otabek1c -- env \
  DJANGO_DEBUG=true \
  POSTGRES_HOST=/var/run/postgresql \
  POSTGRES_PORT=5432 \
  POSTGRES_DB=otabek1c \
  POSTGRES_USER=otabek1c \
  POSTGRES_PASSWORD= \
  /opt/otabek-1c/venv/bin/python "${backend_target}/manage.py" collectstatic --noinput

rsync --archive --delete --delay-updates "${frontend_source}/dist/" "${frontend_target}/"
systemctl start "${service_name}"
service_stopped=false

for attempt in {1..20}; do
  if curl --fail --silent --show-error --max-time 5 https://otabek-1c.glasscenter.kg/health/ >/dev/null; then
    echo "Production updated successfully. Database backup: ${backup_file}"
    exit 0
  fi
  sleep 1
done

echo "Deploy finished, but health check failed" >&2
exit 1
