# Лицензионная стратегия

## Решение

Код и документация репозитория VibeShape лицензируются по **GPL-3.0-or-later**. Это соответствует цели свободного локального CAD и позволяет производную интеграцию GPL solver-кода SolveSpace.

Это инженерная стратегия, не юридическая консультация. Перед публичным binary/WASM release необходим formal compliance review.

## Почему GPL-3.0-or-later

- гарантирует доступ пользователей к исходникам изменённых распространяемых версий;
- совместима по направлению использования с OCCT LGPL-2.1+exception;
- не конфликтует с планируемым использованием GPL-3.0-or-later solver-кода;
- не обещает permissive proprietary embedding, который может оказаться несовместимым с solver;
- соответствует слову «свободный», а не только «бесплатный».

Если бизнес-модель позже потребует permissive/commercial SDK, сначала заменяется GPL solver и проводится новый dependency/license audit; смена лицензии существующих contributions потребует согласия правообладателей или CLA-политики.

## Dependency matrix

| Компонент | Проверенная лицензия | Действие |
|---|---|---|
| VibeShape | GPL-3.0-or-later | LICENSE, SPDX headers, source release |
| Open CASCADE Technology | LGPL-2.1 + Open CASCADE exception | notice, license text, exact sources/build instructions, replaceability |
| OpenCascade.js | LGPL-2.1 | то же; проверить фактические bundled files |
| Replicad | MIT | сохранить notice/license |
| SolveSpace | GPL-3.0-or-later | публиковать source/patches/build scripts; whole combined work GPL-compatible |
| React | MIT | third-party notice |
| Three.js | MIT | third-party notice |
| Vite | MIT | build-time notice по policy |
| Zustand | MIT | third-party notice |
| Dexie | Apache-2.0 | license + NOTICE obligations, если применимо |
| Zod | MIT | third-party notice |
| 3MF specification | royalty-free specification terms | соблюдать spec attribution/terms; код writer отдельно GPL |
| PrusaSlicer/CuraEngine | AGPL-3.0 | не bundled в MVP; будущая интеграция — отдельный ADR |

Матрица — snapshot 2026-08-07. Lockfile/SBOM являются источником фактического набора зависимостей на release.

## OCCT obligations

Официальная документация OCCT прямо указывает минимум:

- заметное уведомление пользователю об использовании OCCT и доступ к LGPL;
- доступ к исходникам именно использованной версии OCCT;
- возможность пользователя запустить приложение с модифицированной OCCT;
- особое внимание к статическому linking/packaging.

Для web/WASM release VibeShape должен:

1. показывать `About → Open source licenses`;
2. поставлять/ссылаться на exact source archive и patches;
3. публиковать reproducible build script/flags/bindings;
4. не обфусцировать способ заменить `.wasm`/loader в self-hosted build;
5. хранить notices и license тексты внутри distribution;
6. документировать соответствие Open CASCADE exception;
7. не полагаться только на ссылку на upstream `master`.

## SolveSpace reuse

Использовать только необходимые solver files допустимо лишь с сохранением copyright/license notices и публикацией соответствующего source/changes. Нужно вести:

- upstream commit;
- список включённых файлов;
- patch series;
- Emscripten/build toolchain version;
- public build instructions;
- tests, подтверждающие поведение modified subset.

Не утверждать, что SolveSpace «библиотека с permissive API»: репозиторий лицензирован GPL-3.0-or-later, а официальный web build обозначен экспериментальным.

## Документация и contributions

По умолчанию contributions принимаются под GPL-3.0-or-later для репозитория. `CONTRIBUTING.md` должен явно содержать inbound=outbound policy. DCO (`Signed-off-by`) предпочтительнее тяжёлого CLA до реальной необходимости dual licensing.

Примеры/fixtures, импортированные от третьих лиц, должны иметь provenance и лицензию. Не добавлять в repo случайные STEP/STL из интернета без разрешения.

## Release checklist

- полный `LICENSE`;
- `THIRD_PARTY_NOTICES` из lockfile/SBOM;
- exact OCCT/OpenCascade.js/SolveSpace sources/patches доступны;
- About dialog содержит notices;
- distribution содержит license texts;
- source build воспроизводит WASM artifact или документирует известные отклонения;
- trademarks не используются как будто проект связан с Onshape/PTC/Open CASCADE;
- экспортные sample files имеют собственную понятную лицензию;
- юридический review перед первым публичным hosted release.

## Название и товарные знаки

VibeShape описывается как независимый browser CAD. Onshape упоминается только для функционального сравнения; нельзя использовать их логотипы, UI assets или создавать впечатление официальной связи.
