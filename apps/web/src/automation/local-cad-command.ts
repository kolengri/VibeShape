import { applyAutomationDraftCommandRequestSchema } from "@vibeshape/automation-api/drafts"
import type { LocalOperation } from "@vibeshape/automation-api/local-tools"
import { type CommandActor, datumPlaneFeatureType, featureRecordSchema } from "@vibeshape/domain"
import {
  booleanFeatureType,
  extrusionFeatureType,
  extrusionFeatureTypeV3,
  extrusionFeatureTypeV4,
  extrusionFeatureTypeV5,
  extrusionFeatureTypeV6,
  extrusionFeatureTypeV7,
  revolveFeatureType,
  revolveFeatureTypeV5,
  revolveFeatureTypeV6,
} from "@vibeshape/domain/part-design"
import {
  compoundFeatureTypeV2,
  unionFeatureTypeV2,
} from "@vibeshape/domain/part-design-body-combination"
import {
  holeFeatureParametersSchema,
  holeFeatureParametersV2Schema,
  holeFeatureParametersV3Schema,
  holeFeatureType,
  holeFeatureTypeV2,
  holeFeatureTypeV3,
} from "@vibeshape/domain/part-design-hole"
import { loftFeatureType } from "@vibeshape/domain/part-design-loft"
import {
  mirrorFeatureType,
  mirrorFeatureTypeV2,
  mirrorFeatureTypeV3,
} from "@vibeshape/domain/part-design-mirror"
import { patternFeatureType, patternFeatureTypeV2 } from "@vibeshape/domain/part-design-pattern"
import { placementFeatureType } from "@vibeshape/domain/part-design-placement"
import { shellFeatureTypeV2 } from "@vibeshape/domain/part-design-shell"
import { splitFeatureType, splitFeatureTypeV2 } from "@vibeshape/domain/part-design-split"
import { sweepFeatureType } from "@vibeshape/domain/part-design-sweep"
import { threadFeatureType, threadFeatureTypeV2 } from "@vibeshape/domain/part-design-thread"

type CadOperation = Extract<
  LocalOperation,
  {
    tool:
      | "create_placement"
      | "update_placement"
      | "create_sketch"
      | "update_sketch"
      | "create_extrude"
      | "update_extrude"
      | "create_face_extent_extrude"
      | "update_face_extent_extrude"
      | "create_revolve"
      | "update_revolve"
      | "create_hole"
      | "update_hole"
      | "create_reference_mirror"
      | "update_reference_mirror"
      | "create_reference_split"
      | "update_reference_split"
      | "create_reference_body_pattern"
      | "update_reference_body_pattern"
      | "create_mirror"
      | "update_mirror"
      | "create_shell"
      | "update_shell"
      | "create_thread"
      | "update_thread"
      | "create_body_pattern"
      | "update_body_pattern"
      | "create_split"
      | "update_split"
      | "create_loft"
      | "update_loft"
      | "create_sweep"
      | "update_sweep"
      | "create_datum_plane"
      | "update_datum_plane"
      | "create_boolean"
      | "update_boolean"
      | "create_union"
      | "update_union"
      | "create_compound"
      | "update_compound"
  }
>

const directCadFeatureTypes = {
  create_face_extent_extrude: extrusionFeatureTypeV7.type,
  update_face_extent_extrude: extrusionFeatureTypeV7.type,
  create_placement: placementFeatureType.type,
  update_placement: placementFeatureType.type,
