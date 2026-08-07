# ADR-0004: IndexedDB, OPFS и `.vshape`

- Статус: **Accepted**
- Дата: 2026-08-07

## Решение

Semantic snapshots/events хранятся транзакционно в IndexedDB через Dexie, крупный disposable cache — в OPFS. Переносимый ZIP-контейнер `.vshape` является user-controlled backup/exchange.

## Последствия

- нет обязательного backend;
- browser storage может быть очищено, поэтому UI различает internal save и file backup;
- File System Access — progressive enhancement;
- multi-tab alpha использует single-writer lease;
- SQLite WASM отложен до доказанной необходимости.
