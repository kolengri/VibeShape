# ADR-0008: Bun workspaces для monorepo

- Статус: **Accepted**
- Дата: 2026-08-07

## Контекст

Будущий код естественно делится на web app, domain, worker protocol, CAD adapter, persistence, formats, viewer и UI. Нужны единый lockfile, локальные package boundaries, согласованные версии и воспроизводимый CI.

## Решение

Использовать Bun workspaces (`apps/*`, `packages/*`) как package manager, runtime для scripts и workspace orchestrator. Локальные зависимости — `workspace:*`, общие версии — Bun catalogs, lockfile — `bun.lock`, CI install — `bun ci`.

Vite остаётся browser bundler. Vitest/Playwright запускаются через Bun. Turborepo не добавляется до измеренной необходимости task cache/graph.

## Последствия

- меньше toolchain-команд и быстрые installs;
- Bun version нужно pin в `packageManager`/CI;
- Node compatibility сторонних CLI проверяется fixtures/CI;
- package manifests остаются самостоятельными, root не становится складом dependencies;
- переход с Bun потребует lockfile/CI change, но domain architecture от него не зависит.

## Отклонено

- pnpm workspaces — технически подходили, но пользователь выбрал Bun и его current workspaces/catalogs закрывают требования;
- npm workspaces — меньше нужных orchestration/catalog ergonomics;
- Turborepo с первого дня — лишний слой без доказанного bottleneck;
- Bun bundler вместо Vite — преждевременный риск для React/Tailwind/worker/WASM pipeline.
