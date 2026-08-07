# Функциональная спецификация

## Приоритеты

- **P0 / alpha:** без функции нельзя доказать основной поток.
- **P1 / v1:** функция нужна для регулярной практической работы.
- **P2 / later:** расширение после стабилизации ядра.
- **Out:** сознательно не планируется в обозримой версии.

## Проекты и local-first

| Возможность | Приоритет | Условие готовности |
|---|---:|---|
| Локальная библиотека проектов | P0 | карточка, preview, дата, дублирование, удаление с подтверждением |
| Autosave и crash recovery | P0 | журнал транзакций восстанавливает последнюю подтверждённую команду |
| `.vshape` import/export | P0 | round-trip без потери параметрики |
| Save/Open через системный picker | P1 | progressive enhancement; download/upload fallback обязателен |
| Снимки/именованные версии | P1 | immutable snapshot с восстановлением |
| Ветки и merge | P2 | только после формальной модели конфликтов операций |
| Облачная синхронизация | P2 | отдельный opt-in adapter, не зависимость ядра |

## Viewport и навигация

| Возможность | Приоритет | Примечание |
|---|---:|---|
| Orbit/pan/zoom, fit, standard views | P0 | предсказуемые CAD-пресеты мыши/трекпада |
| Perspective/orthographic | P0 | orthographic по умолчанию для эскизов |
| Выбор body/face/edge/vertex | P0 | фильтры выбора и hover preselection |
| Shaded, edges, wireframe | P0 | без повторной CAD-тесселяции |
| Grid, axes, origin planes | P0 | единицы и шаг сетки видимы |
| Section/clipping plane | P1 | одна интерактивная плоскость |
| Exploded view | P2 | зависит от assemblies |
| WebGPU renderer | P2 | экспериментальный adapter, не baseline |

## Эскиз

| Возможность | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Point, line/polyline, rectangle | ✓ |  |  |
| Circle, arc (center/3-point) | ✓ |  |  |
| Construction geometry, trim, extend | ✓ |  |  |
| Slot, polygon, ellipse, spline |  | ✓ |  |
| Project/use edge |  | ✓ |  |
| Text/SVG contours |  | ✓ |  |
| Offset sketch entities |  | ✓ |  |
| Sketch patterns/mirror |  | ✓ |  |
| 3D sketch |  |  | ✓ |

Обязательные P0 constraints:

- coincidence;
- horizontal/vertical;
- parallel/perpendicular;
- equal;
- tangent;
- concentric;
- point-on-line/curve;
- fixed;
- distance horizontal/vertical/general;
- angle;
- radius/diameter.

Solver MUST показывать `under-constrained`, `fully-constrained`, `over-constrained` и набор конфликтующих ограничений. Удалять constraint автоматически без подтверждения запрещено.

## Параметрические 3D-операции

| Операция | P0 | P1 | P2 |
|---|:---:|:---:|:---:|
| Extrude: new/add/remove/intersect | ✓ |  |  |
| Revolve: new/add/remove/intersect | ✓ |  |  |
| Boolean union/cut/common | ✓ |  |  |
| Fillet/chamfer | ✓ |  |  |
| Mirror feature/body |  | ✓ |  |
| Linear/circular pattern |  | ✓ |  |
| Shell |  | ✓ |  |
| Sweep/pipe |  | ✓ |  |
| Loft |  | ✓ |  |
| Draft, split, replace face |  |  | ✓ |
| Direct face move/delete |  |  | ✓ |
| Surface modeling |  |  | ✓ |

Для каждой операции обязательны:

- стабильный `FeatureId`;
- типизированные параметры с единицами;
- ссылки на входы через `TopoRef`/`EntityRef`;
- `active/suppressed/error`;
- диагностическое сообщение;
- детерминированный hash входов;
- atomically применяемые edit/cancel.

## Variables и expressions

P1 включает:

- именованные document variables;
- арифметику `+ - * / ^`, скобки;
- литералы `mm`, `cm`, `m`, `in`, `deg`, `rad`;
- функции `min`, `max`, `abs`, `round`, `sin`, `cos`, `tan`;
- dimension checking: длину нельзя сложить с безразмерным числом;
- обнаружение циклов;
- явный десятичный разделитель `.` в файле, локализованный ввод в UI.

Произвольный JavaScript в документе запрещён: native-файл не должен быть исполняемым.

## Bodies, parts и assemblies

| Возможность | Приоритет |
|---|---:|
| Несколько bodies в документе | P0 |
| Видимость, цвет, имя, material label | P0 |
| Multi-body boolean | P0 |
| Components/instances | P1 |
| Простые rigid transforms | P1 |
| Assemblies и mates | P2 |
| BOM | P2 |
| Drawings | P2 |

## Измерения и анализ

- P0: point-to-point, minimum distance, edge length, angle, radius/diameter, face area, body volume, bounding box, center of mass.
- P0: OCCT shape validity и closed-solid check.
- P0: mesh manifoldness, inverted/degenerate triangles, disconnected shells.
- P1: minimum wall approximation, minimum hole/feature, overhang visualization, build-volume collision, clearance/interference.
- P2: tolerance stack, draft analysis, mass по material density, basic FEA adapter.

Printability-предупреждение — эвристика, а не гарантия успешной печати.

## Импорт и экспорт

| Формат | Import | Export | Роль |
|---|---:|---:|---|
| `.vshape` | P0 | P0 | параметрический native-проект |
| STEP AP242/AP214 | P0 | P0 | точный B-Rep обмен |
| STL binary | P0 | P0 | mesh-совместимость |
| 3MF Core | P1 в alpha, P0 для v1 | P0 | основной печатный обмен |
| SVG/DXF 2D | P1 | P1 | эскизы/шаблоны |
| OBJ/glTF | P2 | P2 | визуальные mesh-сценарии |
| IGES | P2 | P2 | legacy CAD |
| проприетарные CAD | Out | Out | нужны коммерческие SDK/конвертеры |

Импорт STL создаёт `MeshBody`, не фальшивый точный `SolidBody`. Автоматическое mesh-to-B-Rep не обещается.

## Undo/redo и история

- P0: undo/redo на уровне пользовательских команд, не отдельных pointer events.
- P0: редактирование ранней операции и downstream recompute.
- P0: suppress/unsuppress.
- P1: reorder с валидацией DAG.
- P1: compare двух snapshots по feature/parameter/geometry metrics.
- P2: branch/merge.

## Интерфейс и доступность

- desktop-first, минимальная рабочая ширина 1024 px;
- все основные команды имеют команды/shortcuts и доступны из command palette;
- focus indicator, semantic labels, управление диалогами с клавиатуры;
- цвет статуса дублируется формой/текстом;
- touch/tablet позже; phone — view/export-only;
- локализация архитектурно готова, но alpha может быть на одном языке.

## Явно отложено

- marketplace/plugins и выполнение непроверенного кода;
- realtime multi-user;
- встроенная отправка G-code на принтер;
- генеративный/AI CAD до появления детерминированного command API и sandbox;
- обещание полной совместимости с Onshape/FreeCAD/SolidWorks.
