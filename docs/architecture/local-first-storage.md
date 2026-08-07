# Local-first хранение и восстановление

## Решение

Использовать три независимых слоя:

1. **IndexedDB/Dexie** — проекты, domain snapshots, event journal, metadata и небольшие blobs.
2. **OPFS** — крупные B-Rep/mesh caches и staging экспортов.
3. **Пользовательский `.vshape`** — переносимая резервная копия и обмен.

OPFS не является пользовательским документом: очистка site data может удалить его. Приложение обязано явно предлагать экспорт `.vshape` и показывать, когда проект существует только во внутреннем browser storage.

## Хранилища IndexedDB

Предлагаемые tables:

- `projects`: id, name, timestamps, headRevision, dirty/clean marker, thumbnail key;
- `snapshots`: documentId + revision, schemaVersion, compressed domain state, checksum;
- `events`: documentId + revision/sequence, command/event payload;
- `imports`: source metadata, optional small embedded blob/OPFS key;
- `settings`: local app preferences и printer profiles;
- `recovery`: active transaction markers;
- `cacheIndex`: content hash → OPFS path, size, lastAccess, engine build;
- `migrations`: applied storage migrations.

## Commit protocol

Пользовательская команда становится committed только после:

1. domain validation;
2. успешного geometry rebuild или explicit сохранения error-state операции, если UX это допускает;
3. одной IndexedDB transaction, записывающей event, новую head revision и recovery marker;
4. подтверждения transaction;
5. обновления UI committed state.

OPFS cache записывается до/после независимо и не участвует в semantic atomicity. Cache index публикуется только после полной записи и checksum; orphan cleanup удаляет незарегистрированные временные файлы.

## Autosave

- debounce 0.5–2 s после committed command, а не после каждого pointer move;
- flush на `visibilitychange`/`pagehide` best-effort, но корректность не зависит от него;
- periodic snapshot каждые N событий или M MiB journal;
- clean-close marker записывается после последнего flush;
- quota error переводит приложение в явный degraded state и предлагает `.vshape` export;
- никакого `localStorage` для проекта: лимит мал и нет нужных транзакций/blobs.

## Recovery

При старте:

1. найти документы без clean-close marker;
2. проверить checksums snapshot/events;
3. replay до последнего целого event;
4. открыть как recovery copy;
5. перестроить geometry из domain state;
6. не использовать B-Rep cache при несовпадении build/tolerance/checksum;
7. предложить compare/save/discard.

Повреждённое событие не должно уничтожать предыдущий snapshot. Diagnostic bundle содержит версии, hashes и типы команд, но не geometry/имена без согласия пользователя.

## Persistent storage

После первого сохранённого проекта UI MAY вызвать `navigator.storage.persist()` из пользовательского действия. Отказ не блокирует работу; приложение показывает, что browser может эвакуировать best-effort storage.

Показывать:

- `navigator.storage.estimate()` usage/quota;
- объём recoverable semantic data и disposable cache отдельно;
- кнопку clear derived cache;
- дату последнего `.vshape` export, если её можно надёжно определить локально.

## File System Access progressive enhancement

Если доступны `showOpenFilePicker/showSaveFilePicker`:

- хранить handle в IndexedDB только с разрешения;
- проверять/request permission при явном действии пользователя;
- сохранять через staging и закрывать stream;
- не считать handle вечным.

Fallback для всех браузеров:

- `<input type=file>`/drag-and-drop для открытия;
- Blob download для Save As;
- понятное сообщение, что автоматическая перезапись исходного файла недоступна.

## Multi-tab

Alpha допускает один writer на документ:

- `BroadcastChannel` объявляет lease/heartbeat;
- второй tab открывает read-only или просит takeover;
- revision optimistic check предотвращает lost update;
- stale lease истекает;
- takeover создаёт snapshot перед записью.

Настоящий multi-writer merge не имитируется и относится к P2.

## Service worker и обновления

- precache только versioned app shell, fonts, worker и WASM;
- project data не хранится в Cache Storage;
- новый app build скачивается рядом со старым;
- activation, несовместимая с открытым документом, ждёт explicit reload;
- до reload приложение сохраняет snapshot/export recovery;
- откат app shell не откатывает storage schema автоматически;
- migrations должны быть forward-safe, а destructive migration — backup-first.

## Backup policy

В v1:

- напоминание об экспорте для проектов без external file copy;
- bulk export всех проектов;
- optional user-selected directory mirror там, где File System Access поддерживается;
- никаких скрытых uploads;
- optional sync adapter в будущем шифрует данные client-side и не меняет core semantics.

## Browser targets

| Browser | Alpha expectation |
|---|---|
| Chromium desktop | полный baseline, включая picker при наличии |
| Firefox desktop | core + OPFS/IndexedDB, save через fallback при отсутствии picker |
| Safari 17+ desktop | core после реальных memory/OPFS тестов; fallback save |
| mobile browsers | просмотр/экспорт best effort, authoring не release gate |

Compatibility определяется automated и manual test matrix, а не user-agent-only branches.
