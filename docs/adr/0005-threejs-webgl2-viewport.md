# ADR-0005: raw Three.js и WebGL2 baseline

- Статус: **Accepted**
- Дата: 2026-08-07

## Решение

Использовать raw Three.js adapter на main thread с WebGL2 baseline. React управляет UI shell, но не lifetime CAD scene graph.

## Последствия

- явные picking, sub-shape mapping и dispose;
- viewport API тестируется отдельно;
- WebGPU и OffscreenCanvas MAY появиться после profiling;
- renderer не участвует в точной геометрии и не экспортирует display LOD как print mesh.
