# Локальная доработка интерфейса с серверным backend

Этот режим запускает React/Vite на компьютере разработчика, но использует
production backend и его актуальную базу. Backend, PostgreSQL и Docker локально
запускать не требуется.

Требуется Node.js 22 LTS и npm.

> Все действия в локальной кассе изменяют реальные production-данные. Для чисто
> визуальной работы не проводите тестовые продажи и оплаты без согласования.

## Первый запуск

```bash
git clone https://github.com/Romajon-c137/otabek.git
cd otabek/Prod/frontend
cp remote.env.example .env.remote
npm ci
npm run dev:remote
```

На Windows PowerShell вместо `cp`:

```powershell
Copy-Item remote.env.example .env.remote
```

Открыть `http://localhost:5173`. Vite принимает обращения к `/api`, `/media` и
`/health` на localhost и проксирует их к
`https://otabek-1c.glasscenter.kg`. Поэтому CORS ослаблять не нужно, а production
адрес не зашивается в собранный frontend.

## Обычная работа

Перед новой задачей:

```bash
git switch main
git pull --ff-only origin main
git switch -c ui/краткое-название
```

Перед отправкой изменений:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
git add frontend
git commit -m "Краткое описание изменения интерфейса"
git push -u origin HEAD
```

Не добавляйте в Git `.env.remote`, токены из браузера, пароли или production
секреты. Авторизационный токен приложения хранится только в `sessionStorage` и
не попадает в репозиторий.
