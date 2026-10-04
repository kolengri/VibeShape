import type { LocalToolName } from "./local-tools"

export const localToolDescriptions: Record<LocalToolName, string> = {
  create_face_extent_extrude:
    "Stage Extrude v7 up-to-face using an exact body-bound finite face, captured current support hash, authored profile set, typed startOffset/draftAngle and explicit targetBody for Add/Remove/Intersect. New uses null targetBody. Obtain the stable face reference from body topology; dependencies are target first, optional sketch support, then a distinct endpoint owner. References retain only sketch support. Planar endpoints use exact plane clipping; curved endpoints require one complete reachable cap, with every new cap on the selected finite face. Partial or neighboring-face coverage fails closed. Preview before ordinary manual browser review; no transient indices or approximate surface extension.",
  update_face_extent_extrude:
    "Update an existing Extrude as v7 up-to-face through its owned draft, preserving feature identity and complete typed profiles, operation, startOffset, draftAngle, targetBody, exact finite face and captured support hash. Resubmit canonical target/support/endpoint dependencies and sketch support reference. Explicit upgrade from legacy is reviewed; v7 remains v7 when choosing a planar endpoint. Preview must pass exact cap coverage before ordinary manual review.",
  create_placement:
    "Stage a Placement of one exact targetBody in an owned draft. Supply its sole dependency, empty references, typed XYZ translation in mm and XYZ rotation in radians; expressions retain authored variable intent. Preserve source body identity through ordinary exact preview and commit review.",
  update_placement:
    "Update an existing Placement preserving feature identity. Resubmit exact targetBody, its sole dependency, no references and full typed translation/rotation. Preview downstream geometry before ordinary commit.",
  create_sketch_text:
    "Generate an editable text group in an owned sketch draft using the pinned bundled Noto Sans font. Supply new UUIDv7 groupId, sketchId, current draft revision, explicit text/height/alignment/tracking/kerning and XY origin in mm. Outline geometry IDs and digest are generated internally; no font bytes, source hash or raw authority accepted. Single-line supported scripts and existing text budgets apply. Preview before ordinary commit.",
  update_sketch_text:
    "Regenerate an existing text group preserving groupId and editable intent. Resubmit layout/origin and explicitly choose removeAttachedConstraints; false fails if constraints attach to replaced geometry. New outline IDs invalidate former downstream profile selectors; rediscover and repair before preview/commit. Async preparation cannot overwrite an edited, expired or revoked draft.",
  detach_sketch_text:
    "Detach one existing text group's editable font intent in an owned draft, retaining all current geometry and constraints. Supply exact groupId/sketchId, fresh commandId and current draft revision. Preview and ordinary commit; detached geometry is no longer regenerated as text.",
