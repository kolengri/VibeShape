# Локальный deployment

## Решение

Production VibeShape — набор статических файлов, но запускать его через `file://` нельзя. Нужен локальный или self-hosted HTTP(S) server, потому что module workers, WASM, service worker и storage APIs зависят от origin/secure context.

## Режимы

| Режим | Назначение | Сеть после установки |
|---|---|---|
| `localhost` static server | полностью локальная установка/разработка | не нужна для core после наличия assets |
| Self-hosted HTTPS | домашняя сеть, школа, организация | нужна только для загрузки/updates; CAD local |
| Installable PWA | desktop-like launch/offline | core offline после первой успешной установки |
| Public static host | удобная доставка | файлы проекта всё равно обрабатываются локально |

Desktop wrapper/Tauri/Electron не нужен для v1. Он MAY появиться как дополнительная упаковка того же web build, но не должен стать отдельной логикой продукта.

## Обязательные свойства server

- корректный MIME для `.wasm` (`application/wasm`), JS modules и manifest;
- immutable cache для content-hashed assets;
- no-cache/revalidation для entry HTML/service-worker control files;
- SPA fallback только для UI routes, не для assets/formats;
- CSP и security headers;
- byte-range только если реально нужен large asset strategy;
- compression Brotli/gzip для JS/WASM, без двойной компрессии ZIP/3MF;
- отсутствие CDN runtime dependencies.

## Secure context

`localhost` считается secure context в современных browsers для многих web APIs; self-hosted по сети должен использовать HTTPS. Конкретные API feature-detect, а не предполагаются по protocol/UA.

## COOP/COEP

Baseline не требует `SharedArrayBuffer` и multithreaded WASM. Если profiling докажет необходимость threads:

- добавить `Cross-Origin-Opener-Policy: same-origin`;
- добавить `Cross-Origin-Embedder-Policy: require-corp` или согласованную credentialless policy;
- self-host все subresources с корректными CORP/CORS;
- проверить OAuth/popups/embedding и third-party integrations;
- зафиксировать change отдельным ADR.

Не включать isolation «на всякий случай»: он меняет hosting и integration surface.

## Offline/update flow

1. Первая загрузка получает versioned app shell/worker/WASM.
2. Service worker precache завершается и сообщает offline readiness.
3. Новый build скачивается в фоне.
4. При dirty/open project activation ждёт.
5. UI предлагает сохранить snapshot/экспортировать и перезагрузить.
6. После reload storage migrations идут backup-first.
7. При failure предыдущий semantic snapshot остаётся читаемым; app shell rollback strategy тестируется.

## Локальный дистрибутив позже

Release MAY включать:

- статический архив;
- маленький open-source local server launcher;
- checksums/signatures;
- SBOM и source bundles OCCT/SolveSpace;
- инструкции Windows/macOS/Linux.

Launcher не получает доступ к проектам и не поднимает backend API без отдельной необходимости. Открытие браузера/автообновление — packaging details, не CAD architecture.

## Acceptance

- clean install и offline reopen на browser matrix;
- WASM загружается с правильным MIME;
- no network request в offline core workflow;
- update не теряет открытый документ;
- self-host deployment не требует proprietary service;
- license/source/notices доступны без сети;
- storage origin видим пользователю: смена host/port создаёт другое browser storage и об этом нужно предупреждать.
