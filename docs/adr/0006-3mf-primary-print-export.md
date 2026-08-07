# ADR-0006: 3MF основной print export

- Статус: **Accepted**
- Дата: 2026-08-07

## Решение

3MF Core — основной формат передачи в slicer; STEP — точный CAD exchange; STL — compatibility. Полноценный встроенный slicer не входит в v1.

## Последствия

- writer обязан соблюдать OPC/XML/spec и проходить independent slicer tests;
- multiple objects/units/metadata имеют явную модель;
- print mesh строится отдельно от display mesh;
- vendor slicer settings не обещаются;
- будущий slicer integration требует нового ADR и license review.
