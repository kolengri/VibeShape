# Безопасность и приватность

## Модель доверия

Пользователь доверяет установленной статической сборке VibeShape, но не обязан доверять импортированному `.vshape`, STEP, STL, SVG/DXF или 3MF. Любой импорт — потенциально враждебные структурированные/бинарные данные.

Local-first уменьшает утечку CAD-файлов, но не отменяет угрозы supply chain, parser bugs, resource exhaustion и потери данных browser storage.

## Приватность по умолчанию

- нет обязательного аккаунта;
- нет telemetry/analytics/error upload без opt-in;
- все assets, fonts, WASM и docs self-hosted;
- CAD-файлы не отправляются в сеть;
- external links открываются только после действия пользователя;
- diagnostic bundle формируется локально и показывает состав перед экспортом;
- имена проектов, абсолютные пути и preview не попадают в логи по умолчанию;
- optional update check не имеет доступа к документу.

CI E2E запускает приложение с заблокированной сетью после install и проверяет основной workflow.

## Content Security Policy

Production goal:

- `default-src 'self'`;
- scripts/workers/WASM только с origin приложения;
- без `unsafe-eval`;
- `object-src 'none'`;
- `base-uri 'none'`;
- `frame-ancestors 'none'` или явная self-host policy;
- `connect-src 'self'` и opt-in endpoints только при появлении;
- запрет mixed content;
- Trusted Types, если совместимость/инструменты позволяют.

Точная CSP проверяется с Emscripten/Vite build в Phase 0. Решение, требующее `unsafe-eval`, считается проблемой сборки.

## Worker isolation

- parser/CAD computation не имеют DOM access;
- versioned schema валидирует вход до allocation/OCCT;
- timeout и generation cancellation;
- crash ограничен worker и приводит к recovery;
- SharedArrayBuffer/multithreaded WASM выключены в baseline;
- COOP/COEP включаются только отдельным ADR, потому что меняют deployment/embedding requirements.

Worker — не security sandbox против скомпрометированного same-origin кода. XSS в UI остаётся критической угрозой.

## Import policy

- проверять magic bytes, а не только extension/MIME;
- resource limits до decompression/allocation;
- ZIP path normalization и duplicate detection;
- XML parser без DTD/external entities;
- SVG не вставляется как live DOM; преобразуется безопасным parser в geometry subset;
- неизвестные native required capabilities блокируют edit;
- imported metadata выводится как text, не HTML;
- STEP entity/count/depth/time limits где позволяет adapter;
- checksum больших embedded sources;
- parser failure не меняет текущий документ.

## File writes

- запись только после explicit user action/permission;
- Save As по умолчанию не перезаписывает import source;
- staging + checksum + close перед публикацией;
- browser handle может стать недействительным — всегда есть download fallback;
- autosave internal и user-visible file save показываются как разные состояния;
- destructive delete требует точного project name/undo/trash policy.

## Supply chain

- exact dependency versions и committed lockfile;
- dependency review для WASM/native artifacts;
- SBOM в release;
- checksums/provenance для prebuilt WASM;
- предпочтительно reproducible custom OCCT/solver builds;
- исходники и build instructions архивируются по требованиям LGPL/GPL;
- Renovate/Dependabot создаёт PR, но auto-merge geometry/WASM dependencies запрещён;
- release подписывается, если hosting pipeline это поддерживает.

## Service worker

- только versioned assets;
- никакой подмены project responses сетью;
- update не активируется посреди committed transaction;
- старые caches удаляются после успешной activation;
- recovery/export до schema migration;
- cache poisoning тестируется.

## Возможный cloud/sync позже

Появление sync требует отдельного threat model:

- explicit opt-in;
- end-to-end encryption предпочтительно;
- отдельные auth/tokens от document content;
- conflict semantics, audit и deletion/export;
- никакой смены local source of truth без ADR;
- GDPR/региональные требования рассматриваются только тогда, когда реально появляется сервис и personal data.

## Сообщение об уязвимости

До появления публичного канала security contact указывается в `SECURITY.md`. Публичный release не должен состояться без private reporting path и политики supported versions.
