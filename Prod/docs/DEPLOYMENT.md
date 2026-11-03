# Обновление production из Git

Production-настройки отделены от репозитория и не перезаписываются при pull:

- systemd unit: `/etc/systemd/system/otabek-1c.service`;
- зашифрованные credentials: `/etc/credstore.encrypted/otabek-1c-*`;
- PostgreSQL: системный кластер и база `otabek1c`;
- загруженные изображения: `/var/lib/otabek-1c/media`;
- Apache/TLS: `/etc/apache2` и `/etc/letsencrypt`.

Файл `.env`, пароли и ключи в Git не добавляются. В репозитории хранится только
безопасный шаблон `.env.example`.

## Обновление после принятого push/merge

На сервере выполнить от root:

```bash
cd /root/var/www/bilol/Otabek
Prod/tools/update-production.sh
```

Сценарий:

1. берёт межпроцессный lock и запрещает параллельный deploy;
2. прекращает работу, если checkout содержит локальные изменения;
3. выполняет только fast-forward обновление `main` — никакого reset или
   автоматического разрешения конфликтов — и проверяет точное совпадение
   локального `HEAD` с `origin/main`;
4. запускает typecheck и production-сборку frontend;
5. создаёт дамп PostgreSQL;
6. обновляет код, применяет миграции и собирает Django static;
7. атомарно обновляет собранный frontend, перезапускает сервис и проверяет
   `/health/`.

Если разработчик отправил изменения в отдельную ветку, сначала проверить и
влить её в `main`. Production напрямую из feature-веток не обновляется.

Сценарий deploy не изменяет systemd, Apache, TLS, credentials, базу или media.
Изменения инфраструктуры выполняются отдельно и явно.
