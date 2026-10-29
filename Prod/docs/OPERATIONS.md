# Установка и эксплуатация

## Production через Docker Compose

> На текущей машине Docker не запускать до отдельного решения владельца: ранее
> наблюдалась нестабильность Docker Desktop. Инструкция ниже предназначена для
> исправного production-хоста.

1. Скопировать `.env.example` в `.env`.
2. Задать уникальные `DJANGO_SECRET_KEY` и `POSTGRES_PASSWORD`.
3. Для HTTPS за reverse proxy задать `DJANGO_SECURE_SSL_REDIRECT=true` и
   `DJANGO_HSTS_SECONDS=31536000` только после проверки TLS.
4. Для синхронизации внешнего каталога задать `OTABEK_USERNAME` и
   `OTABEK_PASSWORD`; без них остальные функции работают независимо.
5. Запустить:

```powershell
docker compose up --build -d
docker compose exec backend python manage.py bootstrap_admin
```

Перед `bootstrap_admin` временно добавить в `.env` значения
`BOOTSTRAP_ADMIN_USERNAME` и `BOOTSTRAP_ADMIN_PASSWORD`, выполнить команду и убрать
пароль из файла. Интерфейс доступен на `http://localhost:8080`, OpenAPI —
`http://localhost:8080/api/docs/`.

Демонстрационные справочники создаются только явной командой:

```powershell
docker compose exec backend python manage.py seed_demo
```

## Локальная разработка

Backend допускает SQLite только когда `DATABASE_URL` не задан:

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python manage.py migrate
..\.venv\Scripts\python manage.py runserver
```

В другом терминале:

```powershell
cd frontend
npm ci
npm run dev
```

Vite проксирует `/api`, `/media` и `/health` на `127.0.0.1:8000`.

## Проверки

```powershell
cd backend
..\.venv\Scripts\python manage.py test
..\.venv\Scripts\python manage.py check
..\.venv\Scripts\python manage.py makemigrations --check --dry-run
..\.venv\Scripts\python manage.py spectacular --file ..\docs\openapi.yaml --validate
..\.venv\Scripts\python manage.py verify_ledgers

cd ..\frontend
npm run test
npm run typecheck
npm run lint
npm run build
npx playwright test

cd ..
docker compose config --quiet
```

Конкурентный тест списания выполняется только на PostgreSQL и намеренно
пропускается на SQLite. Перед вводом в эксплуатацию запуск полного набора на
PostgreSQL обязателен.

## Резервное копирование и восстановление

```powershell
powershell -File tools\backup.ps1
powershell -File tools\restore.ps1 -Backup .\backups\20261025-120000
```

Restore требует ввода `RESTORE`, останавливает backend, заменяет БД и media, затем
запускает `verify_ledgers`. Для автоматизированного проверенного окружения допустим
ключ `-Force`.

## Ежедневный контроль

- `docker compose ps` — состояние контейнеров.
- `docker compose logs --since 30m backend` — ошибки API без вывода токенов.
- `docker compose exec backend python manage.py verify_ledgers` — сверка регистров.
- Проверить свежесть каталога `backups/` и тестовое восстановление на отдельном стенде.

