# ADR-0003: Feature DAG и stable TopoRef

- Статус: **Accepted**
- Дата: 2026-08-07

## Решение

Design intent хранится как DAG параметрических features. Ссылки на faces/edges/vertices используют producing feature, semantic/history lineage, geometric/adjacency signature и intent hints.

Неоднозначный match возвращает `ambiguous` и требует repair; выбор ближайшего кандидата без достаточного margin запрещён.

## Последствия

- больше работы до широкого набора features;
- формат references становится частью native schema;
- datum/origin references предпочтительны;
- property-based parameter/topology tests являются release gate;
- система честно показывает часть перестроений как требующие вмешательства.
