import {
  type AssemblyRigidPose,
  type AssemblyVector3,
  assemblyRigidPoseSchema,
} from "@vibeshape/domain/assembly"
import {
  type AssemblyConstraintDiagnosticCode,
  type AssemblyConstraintSolveResult,
  type AssemblyMateGraph,
  type AssemblyMateJoint,
  assemblyMateGraphSchema,
} from "@vibeshape/domain/assembly-mates"
import {
  composeAssemblyPoses,
  invertAssemblyPose,
  rotateAssemblyVector,
} from "@vibeshape/domain/assembly-poses"
import {
  type FlatSketchSystemInput,
  flatSketchSystemSchema,
  type NativeSketchSolverModule,
  nativeFlatSolveResultSchema,
} from "./abi"

const POSITION_TOLERANCE_MM = 1e-7
const ANGLE_TOLERANCE = 1e-7
const identity: AssemblyRigidPose = { translation: [0, 0, 0], quaternion: [0, 0, 0, 1] }
type Body = {
  origin: number
  normal: number
  plane: number
  parameterOffset: number
  frame: AssemblyRigidPose
  grounded: boolean
}
type Frame = { origin: number; z: number; x: number; y: number; local: AssemblyRigidPose }

function add(a: AssemblyVector3, b: AssemblyVector3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function subtract(a: AssemblyVector3, b: AssemblyVector3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function dot(a: AssemblyVector3, b: AssemblyVector3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: AssemblyVector3, b: AssemblyVector3): [number, number, number] {
  // fallow-ignore-next-line code-duplication -- Elementary vector math stays within the solver boundary.
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function scale(a: AssemblyVector3, v: number): [number, number, number] {
  return [a[0] * v, a[1] * v, a[2] * v]
}
function basis(axis: AssemblyVector3) {
  const index =
    [0, 1, 2].sort((a, b) => Math.abs(axis[a] ?? 0) - Math.abs(axis[b] ?? 0) || a - b)[0] ?? 0
  const seed: [number, number, number] = [0, 0, 0]
  seed[index] = 1
  const projected = subtract(seed, scale(axis, dot(seed, axis)))
  const x = scale(projected, 1 / Math.hypot(...projected))
  return { x, y: cross(axis, x), z: axis }
}
function driveRotation(axis: AssemblyVector3, angle: number): AssemblyRigidPose {
  const s = Math.sin(angle / 2)
  return {
    translation: [0, 0, 0],
    quaternion: [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)],
  }
}
function failure(
  code: Extract<AssemblyConstraintSolveResult, { ok: false }>["code"],
  message: string,
  jointIds: readonly string[] = [],
): AssemblyConstraintSolveResult {
  return { ok: false, code, message, jointIds: [...jointIds].sort() }
}

function drivenCoordinate(value: number, driven: boolean) {
  return driven ? value : null
}
function mateAxis(joint: AssemblyMateJoint): AssemblyVector3 {
  return joint.kind === "fixed" || joint.kind === "ball" ? [0, 0, 1] : joint.axis
}
function requiredPose(frames: ReadonlyMap<string, AssemblyRigidPose>, id: string) {
  const pose = frames.get(id)
  if (!pose) throw new Error("Validated occurrence frames must exist.")
  return pose
}
function mateCoordinates(joint: AssemblyMateJoint): {
  angle: number | null
  translation: number | null
} {
  switch (joint.kind) {
    case "fixed":
      return { angle: 0, translation: 0 }
    case "ball":
      return { angle: null, translation: null }
    case "revolute":
      return { angle: drivenCoordinate(joint.value, joint.driven), translation: 0 }
    case "prismatic":
      return { angle: 0, translation: drivenCoordinate(joint.value, joint.driven) }
    case "cylindrical":
      return {
        angle: drivenCoordinate(joint.angle, joint.rotationDriven),
        translation: drivenCoordinate(joint.translation, joint.translationDriven),
      }
  }
}
function axialMate(joint: AssemblyMateJoint) {
  return joint.kind === "prismatic" || joint.kind === "cylindrical"
}
function nominalMobility(joint: AssemblyMateJoint) {
  if (joint.kind === "ball") return 3
  const coordinate = mateCoordinates(joint)
  return Number(coordinate.angle === null) + Number(coordinate.translation === null)
}
function initialOccurrencePose(instance: AssemblyMateGraph["instances"][number]) {
  return instance.grounded ? instance.worldFrame : instance.initialFrame
}
function branchAngle(axis: AssemblyVector3, parent: AssemblyRigidPose, child: AssemblyRigidPose) {
  const axes = basis(axis),
    z = rotateAssemblyVector(axes.z, parent.quaternion)
  const px = rotateAssemblyVector(axes.x, parent.quaternion),
    cx = rotateAssemblyVector(axes.x, child.quaternion)
  return Math.atan2(dot(z, cross(px, cx)), dot(px, cx))
}
/** Transport analytical frame alignment while keeping passive coordinates from the authored branch. */
function seededRelativePose(
  joint: AssemblyMateJoint,
  parent: AssemblyRigidPose,
  child: AssemblyRigidPose,
) {
  const p = composeAssemblyPoses(parent, joint.parentFrame),
    c = composeAssemblyPoses(child, joint.childFrame)
  let drive: AssemblyRigidPose
  if (joint.kind === "fixed") drive = identity
  else if (joint.kind === "ball") {
    const relative = composeAssemblyPoses(invertAssemblyPose(p), c)
    drive = { translation: identity.translation, quaternion: relative.quaternion }
  } else {
    const coordinates = mateCoordinates(joint)
    const distance = dot(
      subtract(c.translation, p.translation),
      rotateAssemblyVector(joint.axis, p.quaternion),
    )
    const angle = coordinates.angle ?? branchAngle(joint.axis, p, c)
    drive = {
      ...driveRotation(joint.axis, angle),
      translation: scale(joint.axis, coordinates.translation ?? distance),
    }
  }
  return composeAssemblyPoses(
    composeAssemblyPoses(joint.parentFrame, drive),
    invertAssemblyPose(joint.childFrame),
  )
}
class AssemblyCompiler {
  readonly metadata: number[] = []
  readonly values: number[] = []
  readonly entities: number[] = []
  readonly constraints: number[] = []
  readonly constraintValues: number[] = []
  readonly bodies = new Map<string, Body>()
  readonly handles = new Map<number, string>()
  #parameter = 0
  #entity = 0
  #constraint = 0
  parameter(group: number, value: number) {
    this.metadata.push(++this.#parameter, group)
    this.values.push(value)
    return this.#parameter
  }
  entity(
    group: number,
    type: number,
    plane = 0,
    points: readonly number[] = [],
    normal = 0,
    parameters: readonly number[] = [],
  ) {
    const h = ++this.#entity
    this.entities.push(
      h,
      group,
      type,
      plane,
      ...[0, 1, 2, 3].map((i) => points[i] ?? 0),
      normal,
      0,
      ...[0, 1, 2, 3].map((i) => parameters[i] ?? 0),
    )
    return h
  }
  point(group: number, point: AssemblyVector3) {
    return this.entity(
      group,
      50000,
      0,
      [],
      0,
      point.map((v) => this.parameter(group, v)),
    )
  }
  constraint(
    type: number,
    options: {
      plane?: number
      a?: number
      b?: number
      entityA?: number
      entityB?: number
      value?: number
      jointId?: string
    } = {},
  ) {
    const h = ++this.#constraint
    this.constraints.push(
      h,
      2,
      type,
      options.plane ?? 0,
      options.a ?? 0,
      options.b ?? 0,
      options.entityA ?? 0,
      options.entityB ?? 0,
      0,
      0,
      0,
      0,
    )
    this.constraintValues.push(options.value ?? 0)
    if (options.jointId) this.handles.set(h, options.jointId)
  }
  body(instance: AssemblyMateGraph["instances"][number], seed?: AssemblyRigidPose) {
    const group = instance.grounded ? 1 : 2,
      frame = checkedPose(instance.grounded ? instance.worldFrame : (seed ?? instance.initialFrame))
    const parameterOffset = this.values.length
    const origin = this.point(group, frame.translation)
    const [x, y, z, w] = frame.quaternion
    const normal = this.entity(
      group,
      60000,
      0,
      [],
      0,
      [w, x, y, z].map((v) => this.parameter(group, v)),
    )
    const body = {
      origin,
      normal,
      plane: this.entity(group, 80000, 0, [origin], normal),
      parameterOffset,
      frame,
      grounded: instance.grounded,
    }
    this.bodies.set(instance.id, body)
  }
  marker(body: Body, local: AssemblyVector3) {
    if (local.every((v) => v === 0)) return body.origin
    const uv = this.entity(2, 50001, body.plane, [], 0, [
      this.parameter(1, local[0]),
      this.parameter(1, local[1]),
    ])
    if (local[2] === 0) return uv
    const world = add(body.frame.translation, rotateAssemblyVector(local, body.frame.quaternion))
    const point = this.point(body.grounded ? 1 : 2, world)
    if (!body.grounded) {
      this.constraint(100000, { plane: body.plane, a: uv, b: point })
      this.constraint(100002, { a: point, entityA: body.plane, value: local[2] })
    }
    return point
  }
  line(body: Body, frame: AssemblyRigidPose, axis: AssemblyVector3, origin: number) {
    const point = this.marker(
      body,
      add(frame.translation, rotateAssemblyVector(axis, frame.quaternion)),
    )
    // SolveSpace vectors run from point[1] to point[0].
    return this.entity(2, 80001, 0, [point, origin])
  }
  frame(body: Body, local: AssemblyRigidPose, axis: AssemblyVector3): Frame {
    const origin = this.marker(body, local.translation),
      axes = basis(axis)
    return {
      origin,
      local,
      z: this.line(body, local, axes.z, origin),
      x: this.line(body, local, axes.x, origin),
      y: this.line(body, local, axes.y, origin),
    }
  }
  requiredBody(id: string) {
    const body = this.bodies.get(id)
    if (!body) throw new Error("Validated mate endpoints must exist.")
    return body
  }
  mate(joint: AssemblyMateJoint) {
    const parent = this.requiredBody(joint.parentInstanceId),
      child = this.requiredBody(joint.childInstanceId)
    const axis = mateAxis(joint)
    const p = this.frame(parent, joint.parentFrame, axis),
      c = this.frame(child, joint.childFrame, axis)
    const jointId = joint.id
    if (!axialMate(joint)) this.constraint(100000, { a: p.origin, b: c.origin, jointId })
    else this.constraint(100006, { a: c.origin, entityA: p.z, jointId })
    if (joint.kind === "ball") return
    this.constraint(100025, { entityA: p.z, entityB: c.z, jointId })
    const coordinates = mateCoordinates(joint)
    if (coordinates.angle !== null) {
      const rotated = rotateAssemblyVector(
        basis(axis).y,
        driveRotation(axis, coordinates.angle).quaternion,
      )
      const target = this.line(parent, joint.parentFrame, rotated, p.origin)
      this.constraint(100026, { entityA: target, entityB: c.x, jointId })
    }
    if (axialMate(joint) && coordinates.translation !== null)
      this.constraint(100030, {
        a: p.origin,
        b: c.origin,
        entityA: p.z,
        value: coordinates.translation,
        jointId,
      })
  }

  input(): FlatSketchSystemInput {
    return {
      parameterMetadata: new Uint32Array(this.metadata),
      parameterValues: new Float64Array(this.values),
      entityRecords: new Uint32Array(this.entities),
      constraintRecords: new Uint32Array(this.constraints),
      constraintValues: new Float64Array(this.constraintValues),
      draggedParameters: new Uint32Array(),
      solveGroup: 2,
      calculateFailedConstraints: true,
    }
  }
}

function components(assembly: AssemblyMateGraph) {
  const neighbors = new Map(assembly.instances.map(({ id }) => [id, new Set<string>()]))
  for (const joint of assembly.joints) {
    neighbors.get(joint.parentInstanceId)?.add(joint.childInstanceId)
    neighbors.get(joint.childInstanceId)?.add(joint.parentInstanceId)
  }
  const remaining = new Set(assembly.instances.map(({ id }) => id)),
    result: AssemblyMateGraph[] = []
  for (const instance of [...assembly.instances].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!remaining.has(instance.id)) continue
    const ids = new Set<string>(),
      queue: string[] = [instance.id]
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      if (!id || ids.has(id)) continue
      ids.add(id)
      remaining.delete(id as typeof instance.id)
      queue.push(...(neighbors.get(id as typeof instance.id) ?? []))
    }
    result.push({
      ...assembly,
      instances: assembly.instances.filter(({ id }) => ids.has(id)),
      joints: assembly.joints.filter((j) => ids.has(j.parentInstanceId)),
    })
  }
  return result
}
function initialOrSeededPose(
  assembly: AssemblyMateGraph,
  frames: ReadonlyMap<string, AssemblyRigidPose>,
  id: string,
) {
  const instance = assembly.instances.find((instance) => instance.id === id)
  if (!instance) throw new Error("Validated seed endpoints must exist.")
  return frames.get(id) ?? initialOccurrencePose(instance)
}
function seedAcrossJoint(
  joint: AssemblyMateJoint,
  id: string,
  frames: Map<string, AssemblyRigidPose>,
  assembly: AssemblyMateGraph,
) {
  if (joint.parentInstanceId !== id && joint.childInstanceId !== id) return null
  const forward = joint.parentInstanceId === id,
    target = forward ? joint.childInstanceId : joint.parentInstanceId
  if (frames.has(target)) return null
  const relative = seededRelativePose(
    joint,
    initialOrSeededPose(assembly, frames, joint.parentInstanceId),
    initialOrSeededPose(assembly, frames, joint.childInstanceId),
  )
  frames.set(
    target,
    composeAssemblyPoses(
      requiredPose(frames, id),
      forward ? relative : invertAssemblyPose(relative),
    ),
  )
  return target
}
function drivenSeeds(assembly: AssemblyMateGraph) {
  const frames = new Map<string, AssemblyRigidPose>()
  const queue = assembly.instances
    .filter((i) => i.grounded)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((i) => {
      frames.set(i.id, i.worldFrame)
      return i.id
    })
  const joints = [...assembly.joints].sort(
    (a, b) => nominalMobility(a) - nominalMobility(b) || (a.id < b.id ? -1 : 1),
  )
  for (const id of queue)
    for (const joint of joints) {
      const target = seedAcrossJoint(joint, id, frames, assembly)
      if (target) queue.push(target)
    }
  return frames
}
class AssemblyResultFailure extends Error {
  constructor(
    readonly code: AssemblyConstraintDiagnosticCode,
    message: string,
  ) {
    super(message)
  }
}
function checkedPose(pose: unknown) {
  const parsed = assemblyRigidPoseSchema.safeParse(pose)
  if (!parsed.success)
    throw new AssemblyResultFailure(
      "world-bounds",
      "A solved assembly pose exceeds its finite world coordinate budget.",
    )
  return parsed.data
}
function readFrames(assembly: AssemblyMateGraph, compiler: AssemblyCompiler, values: Float64Array) {
  const frames = new Map<string, AssemblyRigidPose>()
  for (const instance of assembly.instances) {
    const body = compiler.bodies.get(instance.id)
    if (!body) throw new Error("Solved occurrence parameters are unavailable.")
    if (body.grounded) {
      frames.set(instance.id, body.frame)
      continue
    }
    const o = body.parameterOffset
    frames.set(
      instance.id,
      checkedPose({
        translation: [values[o], values[o + 1], values[o + 2]],
        quaternion: [values[o + 4], values[o + 5], values[o + 6], values[o + 3]],
      }),
    )
  }
  return frames
}
function within(value: number, bound: { min: number; max: number }) {
  return value >= bound.min - POSITION_TOLERANCE_MM && value <= bound.max + POSITION_TOLERANCE_MM
}
function mateLimits(joint: AssemblyMateJoint, angle: number, distance: number) {
  switch (joint.kind) {
    case "revolute":
      return within(angle, joint.limits)
    case "prismatic":
      return within(distance, joint.limits)
    case "cylindrical":
      return within(angle, joint.angleLimits) && within(distance, joint.translationLimits)
    default:
      return true
  }
}
function authoredAngle(joint: AssemblyMateJoint) {
  if (joint.kind === "revolute") return joint.value
  return joint.kind === "cylindrical" ? joint.angle : 0
}
function mateResidual(joint: AssemblyMateJoint, frames: ReadonlyMap<string, AssemblyRigidPose>) {
  const p = composeAssemblyPoses(requiredPose(frames, joint.parentInstanceId), joint.parentFrame)
  const c = composeAssemblyPoses(requiredPose(frames, joint.childInstanceId), joint.childFrame)
  const axis = mateAxis(joint)
  const axes = basis(axis),
    z = rotateAssemblyVector(axes.z, p.quaternion),
    cz = rotateAssemblyVector(axes.z, c.quaternion)
  const delta = subtract(c.translation, p.translation),
    distance = dot(delta, z)
  const positional = axialMate(joint)
    ? Math.hypot(...subtract(delta, scale(z, distance)))
    : Math.hypot(...delta)
  if (joint.kind === "ball") return { position: positional, angle: 0, limits: true }
  const px = rotateAssemblyVector(axes.x, p.quaternion),
    cx = rotateAssemblyVector(axes.x, c.quaternion)
  const rawAngle = Math.atan2(dot(z, cross(px, cx)), dot(px, cx))
  const angle =
    rawAngle + 2 * Math.PI * Math.round((authoredAngle(joint) - rawAngle) / (2 * Math.PI))
  const coordinates = mateCoordinates(joint)
  const clock = coordinates.angle === null ? 0 : Math.abs(angle - coordinates.angle)
  const drive = coordinates.translation === null ? 0 : Math.abs(distance - coordinates.translation)
  const axialError = Math.max(Math.hypot(...cross(z, cz)), dot(z, cz) < 0 ? 2 : 0)
  return {
    position: Math.max(positional, drive),
    angle: Math.max(axialError, clock),
    limits: mateLimits(joint, angle, distance),
  }
}
function validateMateResiduals(
  assembly: AssemblyMateGraph,
  frames: ReadonlyMap<string, AssemblyRigidPose>,
) {
  for (const joint of assembly.joints) {
    const residual = mateResidual(joint, frames)
    if (!residual.limits)
      return failure("drive-limit", "A solved mate coordinate lies outside its closed limits.", [
        joint.id,
      ])
    if (residual.position > POSITION_TOLERANCE_MM || residual.angle > ANGLE_TOLERANCE)
      return failure(
        "did-not-converge",
        "The numerical result does not satisfy the authored oriented mate frames.",
        [joint.id],
      )
  }
  return null
}
function nativeDiagnostic(
  result: ReturnType<typeof nativeFlatSolveResultSchema.parse>,
  parameterCount: number,
  jointIds: readonly string[],
) {
  if (
    result.abiStatus !== 0 ||
    result.parameterValues.length !== parameterCount ||
    !result.parameterValues.every(Number.isFinite)
  )
    return failure(
      "invalid-solver-result",
      "The native solver returned invalid assembly evidence.",
      jointIds,
    )
  switch (result.solverStatus) {
    case 0:
    case 4:
      return null
    case 3:
      return failure(
        "solver-budget",
        "The native solver rejected the component's equation budget.",
        jointIds,
      )
    case 1:
      return failure(
        "conflicting-mates",
        "The current mate constraints are inconsistent at the authored assembly branch.",
        jointIds,
      )
    default:
      return failure(
        "did-not-converge",
        "The mate solver did not converge from the authored assembly poses.",
        jointIds,
      )
  }
}

function compileComponent(assembly: AssemblyMateGraph) {
  if (!assembly.instances.some((instance) => instance.grounded))
    throw new AssemblyResultFailure(
      "unanchored-component",
      "Each connected mate component requires an explicit grounded occurrence.",
    )
  if (assembly.joints.some((j) => j.parentBinding || j.childBinding))
    throw new AssemblyResultFailure(
      "topology-missing",
      "Topology bindings must resolve against verified frozen geometry before numerical solving.",
    )
  const compiler = new AssemblyCompiler()
  const seeds = drivenSeeds(assembly)
  for (const instance of [...assembly.instances].sort((a, b) => (a.id < b.id ? -1 : 1)))
    compiler.body(instance, seeds.get(instance.id))
  for (const joint of [...assembly.joints].sort((a, b) => (a.id < b.id ? -1 : 1)))
    compiler.mate(joint)
  const unknowns = compiler.metadata.filter((value, index) => index % 2 === 1 && value === 2).length
  if (unknowns > 1900 || compiler.constraintValues.length > 1900)
    throw new AssemblyResultFailure(
      "solver-budget",
      "The mate component exceeds the reviewed native solver's unknown/equation budget.",
    )
  return { compiler, input: flatSketchSystemSchema.parse(compiler.input()) }
}
function solvedOccurrences(
  assembly: AssemblyMateGraph,
  frames: ReadonlyMap<string, AssemblyRigidPose>,
) {
  return assembly.instances.map((instance) => {
    const worldFrame = requiredPose(frames, instance.id)
    const definition = assembly.definitions.find((d) => d.id === instance.definitionId)
    if (!definition) throw new Error("Validated occurrence definitions must exist.")
    const geometryFrame = checkedPose(
      composeAssemblyPoses(worldFrame, invertAssemblyPose(definition.sourceFrame)),
    )
    return {
      instanceId: instance.id,
      definitionId: instance.definitionId,
      worldFrame,
      geometryFrame,
    }
  })
}
function solveComponent(
  module: NativeSketchSolverModule,
  assembly: AssemblyMateGraph,
): AssemblyConstraintSolveResult {
  const { compiler, input } = compileComponent(assembly)
  const result = nativeFlatSolveResultSchema.parse(
    module.solveFlatSystem(
      input.parameterMetadata,
      input.parameterValues,
      input.entityRecords,
      input.constraintRecords,
      input.constraintValues,
      input.draggedParameters,
      2,
      true,
    ),
  )
  const jointIds = [
    ...new Set([...result.failedConstraints].flatMap((h) => compiler.handles.get(h) ?? [])),
  ]
  const diagnostic = nativeDiagnostic(result, input.parameterValues.length, jointIds)
  if (diagnostic) return diagnostic
  const frames = readFrames(assembly, compiler, result.parameterValues)
  const residualFailure = validateMateResiduals(assembly, frames)
  if (residualFailure) return residualFailure
  if (
    result.maximumResidual > POSITION_TOLERANCE_MM ||
    result.degreesOfFreedom < 0 ||
    result.degreesOfFreedom > 6 * assembly.instances.filter((instance) => !instance.grounded).length
  )
    return failure(
      "invalid-solver-result",
      "The native solver returned an unresolved residual or rank.",
      jointIds,
    )
  const instances = solvedOccurrences(assembly, frames)
  return {
    ok: true,
    status: result.degreesOfFreedom === 0 ? "fully-constrained" : "under-constrained",
    degreesOfFreedom: result.degreesOfFreedom,
    maximumResidual: result.maximumResidual,
    redundant: result.solverStatus === 4,
    redundantJointIds: result.solverStatus === 4 ? jointIds : [],
    instances,
  }
}

/** A local, deterministic constraint solve; free motion and global uniqueness are never inferred from convergence. */
export function solveAssemblyConstraints(
  module: NativeSketchSolverModule,
  raw: unknown,
): AssemblyConstraintSolveResult {
  const parsed = assemblyMateGraphSchema.safeParse(raw)
  if (!parsed.success)
    return failure("invalid-assembly", "The version-2 assembly graph is invalid.")
  try {
    const results: Extract<AssemblyConstraintSolveResult, { ok: true }>[] = []
    for (const component of components(parsed.data)) {
      const result = solveComponent(module, component)
      if (!result.ok) return result
      results.push(result)
    }
    const dof = results.reduce((sum, r) => sum + r.degreesOfFreedom, 0)
    return {
      ok: true,
      status: dof === 0 ? "fully-constrained" : "under-constrained",
      degreesOfFreedom: dof,
      maximumResidual: Math.max(0, ...results.map((r) => r.maximumResidual)),
      redundant: results.some((r) => r.redundant),
      redundantJointIds: results.flatMap((r) => r.redundantJointIds).sort(),
      instances: results
        .flatMap((r) => r.instances)
        .sort((a, b) => (a.instanceId < b.instanceId ? -1 : 1)),
    }
  } catch (error) {
    return failure(
      error instanceof AssemblyResultFailure ? error.code : "invalid-solver-result",
      error instanceof AssemblyResultFailure
        ? error.message
        : "Assembly constraint solving failed before publication.",
    )
  }
}
