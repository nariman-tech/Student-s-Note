# Бэкапы базы и «не дать Supabase уснуть»

В репозитории две автоматические задачи GitHub Actions (вкладка **Actions**):

| Задача | Когда | Что делает |
|---|---|---|
| **Supabase keep-alive** | каждый день, 08:17 по Кызылорде | один запрос к базе, чтобы бесплатный проект не ушёл в паузу |
| **Database backup** | каждую ночь, 03:41 по Кызылорде | выгружает базу, шифрует и кладёт в Backblaze B2; хранит 30 дней |

Keep-alive работает сразу, настраивать ничего не нужно. Для бэкапа нужно один раз добавить секреты.

> GitHub отключает задачи по расписанию в публичном репозитории, если в нём 60 дней не было коммитов.
> Тогда придёт письмо — достаточно нажать **Enable workflow** во вкладке Actions.

## Настройка бэкапа (один раз, ~10 минут)

### 1. Закрытый бакет в Backblaze
1. Backblaze → **Buckets** → **Create a Bucket**.
2. Имя, например `lectiva-backups-<что-то своё>` (имена бакетов уникальны на весь Backblaze).
3. **Files in Bucket are: Private** — обязательно.
4. После создания у бакета: **Lifecycle Settings → Keep only the last version of the file**
   (иначе удалённые старые бэкапы продолжат занимать место).

### 2. Ключ только для этого бакета
1. Backblaze → **Application Keys** → **Add a New Application Key**.
2. **Allow access to Bucket(s):** выберите бакет бэкапов (не «All»), доступ **Read and Write**.
3. Сохраните `keyID` и `applicationKey` — второй показывается один раз.

### 3. Строка подключения к базе
1. Supabase → проект → кнопка **Connect** вверху → вкладка **Session pooler**.
2. Скопируйте строку вида
   `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-….pooler.supabase.com:5432/postgres`
3. Вместо `[YOUR-PASSWORD]` вставьте пароль базы (Project Settings → Database → Reset database password,
   если не помните). Если в пароле есть символы `@ : / ? # %` — проще сбросить пароль на буквы и цифры.

Нужен именно **Session pooler**: серверы GitHub не умеют подключаться к прямому адресу базы (IPv6).

### 4. Секреты в GitHub
GitHub → репозиторий → **Settings → Secrets and variables → Actions → New repository secret**:

| Имя | Значение |
|---|---|
| `SUPABASE_DB_URL` | строка из шага 3 |
| `B2_BACKUP_KEY_ID` | keyID из шага 2 |
| `B2_BACKUP_APP_KEY` | applicationKey из шага 2 |
| `B2_BACKUP_BUCKET` | имя бакета из шага 1 |
| `BACKUP_PASSPHRASE` | длинный пароль для шифрования (20+ символов). **Сохраните его отдельно** — без него бэкап не открыть |

### 5. Проверка
**Actions → Database backup → Run workflow**. Через 1–3 минуты должна появиться зелёная галочка,
а в бакете — файл `db/lectiva-db-ГГГГ-ММ-ДД.tar.gz.gpg`.

Если бакет в другом регионе Backblaze (не `eu-central-003`), добавьте во **Variables** (рядом с Secrets)
`B2_ENDPOINT` = `https://s3.<регион>.backblazeb2.com` и `B2_REGION` = `<регион>`.

## Восстановление

1. Скачайте нужный файл из бакета (Backblaze → Browse Files).
2. Расшифруйте и распакуйте:
   ```bash
   gpg --decrypt lectiva-db-2026-11-04.tar.gz.gpg | tar xzf -
   ```
   Появится папка `dump` с файлами `roles.sql`, `schema.sql`, `data.sql`.
3. Загрузите в **новый** проект Supabase (строка подключения нового проекта, Session pooler):
   ```bash
   psql \
     --single-transaction \
     --variable ON_ERROR_STOP=1 \
     --file dump/roles.sql \
     --file dump/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file dump/data.sql \
     --dbname "postgresql://…новый проект…"
   ```
4. В приложении (`.env` / настройки Vercel) и в `worker/wrangler.toml` поменяйте адрес и ключ Supabase на новые.

Файлы (картинки, PDF) лежат в Backblaze отдельно и в бэкап базы не входят — их удалять при
восстановлении не нужно, ссылки на них в конспектах продолжат работать.
