# Целевая архитектура

Основание: [TZ.md](TZ.md), REQ-001…REQ-023. План реализации: [TASKS.md](TASKS.md). Правила: [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md).
Это проектное решение, не описание существующего backend. Django обязателен; PostgreSQL предлагается для транзакций и строковых блокировок; Django REST Framework — для сериализации/версий API, OpenAPI — для проверяемого контракта. Redis, Celery и микросервисы не нужны в первой версии. Версии зависимостей закрепляются TASK-004 после проверки поддержки; текущий этап не устанавливает пакеты.

## Границы

Модульный монолит: catalog (Product/Unit/цены/фото), warehouses (Warehouse/StockBalance), partners (Counterparty), documents (шапки, строки, состояния), inventory (Lot/StockMovement/Reservation/FifoAllocation), settlements (SettlementMovement/Obligation/Allocation/Offset), payments (Payment), access (пользователи/роли/склады), imports (ImportBatch), reporting (запросы/печать), audit (AuditEvent).
documents задаёт общий жизненный цикл, но каждый тип имеет собственные модели строк и сервис проведения. inventory не вызывает HTTP и не выбирает контрагентов; payments не списывает товар; reporting ничего не проводит. Прикладные сервисы координируют модули в одной транзакции. HTTP-слой только аутентифицирует, валидирует DTO, вызывает сценарий и сериализует ответ.

## Модели и ограничения

Все ключи UUID; временные метки UTC с отображением Asia/Bishkek. Авторы FK User (PROTECT), номер отдельный от PK. Удаление проведённых ссылок запрещено PROTECT.

| Модель | Поля/связи | Ограничения |
|---|---|---|
| User/Role/Scope | пользователь, роль, разрешённые склады | реальная сессия; выбор режима не даёт права |
| Counterparty | code, name, phone, is_system, active | code уникален; один системный розничный через уникальный system_key |
| Product | code, sku, barcode, unit, retail_price, wholesale_price, purchase_price, photo, active | code уникален; unit неизменяем после движений; цены ≥0; политика уникальности barcode фиксируется TASK-005 |
| Warehouse | code, name, active | code уникален; первая версия один рабочий склад |
| Document | type, number, status, version, warehouse, counterparty, author, posted_at, reversal_of, reason | номера уникальны по типу; статусы через сервис; только применимые типу nullable поля |
| Sale/Receipt/Return/SupplierReturn lines | document, position, product, quantity, price, discount, amount; return.source_line | unique(document,position); qty>0; amount≥0; снимки цены/единицы/названия |
| ExtraCost | receipt, name, amount | ≥0; не расчёт с поставщиком |
| Lot | product, warehouse, source_line, fifo_seq, initial_qty/cost | уникальный источник партии; остатки вычисляемы/кэшируемы |
| StockMovement | document_line, product, warehouse, lot, signed_qty, signed_cost, reversal_of | неизменяем; уникальный ключ движения; сторно не более одного на оригинал |
| StockBalance | warehouse, product, quantity, reserved, cost | unique(warehouse,product); qty/reserve≥0; reserve≤qty; восстанавливается из истории |
| FifoAllocation | sale_line, lot, quantity, cost | уникальный ordinal в строке; фиксирует исходное списание для возврата |
| Order/Reservation | client, warehouse, lines, status; reservation.order_line, qty | не более одной активной продажи заказа; резерв товарный |
| SettlementMovement | document_line, counterparty, signed_amount, reversal_of | сумма начисления/возврата/платежа; зачёт не создаёт нового сальдо |
| Obligation/Allocation | исходная строка, сторона, amount; распределение, target, kind, amount | суммы положительны; открытый остаток неотрицателен; согласованность под блокировкой |
| Payment | counterparty, in/out, amount, source, status | amount>0; движения только из сервиса; сумма allocations равна payment |
| Offset | counterparty, amount, trigger | парные allocations одной суммы; без складского движения |
| ImportBatch | checksum, state, counts, errors, confirmed_by | checksum уникален для применённого пакета; состояние проверки отдельно от проведения |
| CommandResult | principal, key, operation, payload_hash, result | unique(principal,key); тот же key с другим payload →409 |
| AuditEvent | actor, at, action, document, reason, request_id | дописываемый журнал, без паролей/токенов |

Деньги Decimal(18,2), количество Decimal(18,3), расчётная цена единицы Decimal(18,6); ограничить диапазоны до записи. Финальные суммы HALF_UP по Q-006; распределение копеек методом наибольших остатков со стабильным порядком строк. Для шт количество целое. Стоимость последнего остатка партии списывается целиком, чтобы не оставались копейки. Нет float в учёте/API; Decimal передаётся строкой.

Истина: неизменяемые движения и исходные документы. Кэши StockBalance/остатки партий/обязательств обновляются вместе с движениями; rebuild сверяет каждый склад, товар, партию и контрагента, а не только общий итог. Сторно компенсирует оригинал, не исключает его из истории.

## Сервисы и транзакции

Create/UpdateDraft, CalculateSale, PostSale, PostReceipt, PostOpeningStock, PostBuyerReturn, PostSupplierReturn, PostPayment, ReserveOrder, CompleteOrderSale, ApplyOffset, ReverseDocument, ValidateImport, ApplyImport — отдельные сценарии. Каждый использует маленькие inventory/settlements функции; общего огромного switch-процесса нет.
Команда: transaction.atomic → создать/заблокировать CommandResult → проверить hash/version/права → блокировать Document → StockBalance (warehouse/product по UUID) → партии по fifo_seq/id → исходные строки возврата → расчётный lock контрагента и обязательства → повторить проверки → движения/кэши/аудит/статус → сохранить результат → commit. Все операции придерживаются одного порядка; при нескольких контрагентах сортировка UUID. Строки StockBalance создаются заранее либо через конфликтобезопасный upsert. Блокировка общая для заказов и продаж: резерв тоже конкурентен.
Последняя единица: SELECT FOR UPDATE общей balance строки; второй запрос проверяет уже новый остаток. Возврат блокирует исходную строку и учитывает все проведённые возвраты. Ошибка/timeout/deadlock откатывает всё; ограниченный повтор всей команды с тем же ключом. Повтор после commit/потери ответа возвращает сохранённый результат, не 500. Отдельно проведённый документ с новым ключом возвращает текущий результат без новых движений.
SaleAndPayment объединяет PostSale и PostPayment внутри одной транзакции, но сохраняет два документа. Продажа без оплаты допускается по Q-003. Для возврата отдельная выдача денег: failure платежа не отменяет уже ранее проведённый возврат.

## API /api/v1

JSON, HTTPS. Сессия/токен выбирается TASK-004; безопасное хранение секретов ОС, никакого токена в localStorage C# клиента. Списки с pagination, search, ordering, warehouse, status, периодом. Ответ команды: document_id, status, version, totals, related_documents, request_id.

| Ресурс | Методы |
|---|---|
| /auth/session, /auth/me | вход/выход, текущие права |
| /products, /counterparties, /warehouses | GET/POST, GET/PATCH по id |
| /sales, /receipts, /opening-stocks, /buyer-returns, /supplier-returns, /payments | POST черновика, GET списка/id, PATCH черновика с version, DELETE только черновика |
| /{documents}/{id}/calculate | POST предпросмотра, без движений |
| /{documents}/{id}/post, /reverse | POST команд с Idempotency-Key и version/reason |
| /sales/{id}/post-with-payment | POST атомарной продажи с отдельным Payment |
| /orders/{id}/reserve, /assembled, /release, /cancel, /sale | POST отдельных переходов |
| /settlements/{counterparty}/balance, /ledger, /obligations | GET истории и открытых строк |
| /settlements/{counterparty}/settle | POST возврата/платежа, типы явно указаны |
| /imports/validate, /imports/{id}/apply | multipart проверка; POST подтверждения checksum |
| /reports/stock, /sales, /gross-profit, /audit | GET сверяемых отчётов |
| /orders/{id}/assembly-sheet | GET данных/печатной формы без учётных изменений |

Ошибки: 400 INVALID_FIELD (field,line,sheet,row,message), 401 AUTH_REQUIRED, 403 FORBIDDEN, 404 NOT_FOUND, 409 VERSION_CONFLICT/INSUFFICIENT_STOCK/DEPENDENT_OPERATION/IDEMPOTENCY_CONFLICT, 422 BUSINESS_RULE. Нехватка: product_id, stock, reserved, available, requested, missing. 500 содержит request_id без трассировки клиенту. Серверная проверка обязательна независимо от UI.

## C# клиент и утверждённый макет

Платформа утверждена в ADR-0001: WPF на .NET 8, только Windows. MVVM: Views, ViewModels, ApiClient, DTO, локальное состояние черновика. Backend отдаёт суммы/права/ошибки; клиент может показывать предварительные значения, но заменяет их авторитетным результатом.
Перенести выбор режима, плотные таблицы/поиск/горячие клавиши, карточку товара и фото, кассовый подбор/чек, поступление, возврат, контрагента с историей, заказ/сборку, отчёты/импорт. В главной таблице не возвращать скрытые «Резерв»/«Доступно» и отдельную колонку единицы; единица рядом с количеством. «Код» кратко, без тестовых подсказок; скидка продажи в строках. Экономические ошибки показывать по действию, не постоянными пояснениями.
Скриншоты и список переходов фиксируются TASK-003; TASK-026 сравнивает эталон на согласованных ОС/разрешениях. Не удалять макет до этой проверки.

## Эксплуатация

Предлагается один Django процесс приложения за HTTPS reverse proxy и PostgreSQL; среды dev/test/prod разделены. Настройки/секреты вне репозитория, DEBUG выключен; миграции перед релизом с резервной копией. Локальные фото в контролируемом хранилище входят в backup. Логи команды/ошибки по request_id. TASK-028 проверяет восстановление БД и файлов в чистой среде; RPO/RTO согласовать в TASK-002 до запуска. Никакой автоматической миграции реальных данных из демо.
