# ADR-0002: Geometry worker boundary

- Статус: **Accepted**
- Дата: 2026-08-07

## Решение

OCCT, solver, rebuild, tessellation и CAD import/export выполняются вне main thread. Граница — versioned structured-clone protocol; большие buffers передаются transfer.

## Последствия

- UI не блокируется синхронными kernel-вызовами;
- kernel handles не протекают в React/Three;
- worker можно перезапустить из committed snapshot;
- cancel часто логический, а не прерывание текущего C++ вызова;
- protocol и diagnostics требуют явного versioning/testing.
