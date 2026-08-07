# Вклад в VibeShape

До начала реализации изменения должны сохранять границы, описанные в документации.

## Правила

- обсуждать смену kernel, solver, лицензии, native-формата, истории или local-first модели через ADR;
- не добавлять CAD assets без происхождения и совместимой лицензии;
- geometry change сопровождается fixture и invariant/failure tests;
- не использовать точный порядок faces/triangles как устойчивую identity;
- не добавлять обязательную сеть/телеметрию;
- обновлять `docs/research-sources.md` при изменении внешнего технического основания;
- dependency versions фиксируются lockfile, WASM builds имеют upstream commit/flags/checksum;
- единственный JS lockfile — `bun.lock`; workspace зависимости используют `workspace:*`, CI — `bun ci`;
- shadcn components добавляются выборочно и review-ятся как наш source; `add --all`/blind overwrite запрещены;
- не смешивать несвязанные refactor и feature.

## Лицензия contributions

Отправляя вклад, автор соглашается лицензировать его по GPL-3.0-or-later — той же лицензии, что и репозиторий. Перед публичным приёмом contributions проект добавит DCO/sign-off workflow.

## Документационные изменения

Проверить:

- ссылки и дату актуальности;
- отсутствие противоречий с ADR;
- пометку подтверждённых фактов, goals и предположений;
- обновление roadmap/рисков, если scope изменён;
- отсутствие обещаний совместимости без test evidence.
