import type { AssemblyQuaternion, AssemblyRigidPose, AssemblyVector3 } from "./assembly"

function multiplyQuaternion(
  left: AssemblyQuaternion,
  right: AssemblyQuaternion,
): [number, number, number, number] {
  const [x, y, z, w] = left
  const [a, b, c, d] = right
  return [
    w * a + x * d + y * c - z * b,
    w * b - x * c + y * d + z * a,
    w * c + x * b - y * a + z * d,
    w * d - x * a - y * b - z * c,
  ]
}
export function rotateAssemblyVector(
  vector: AssemblyVector3,
  quaternion: AssemblyQuaternion,
): [number, number, number] {
  const [x, y, z, w] = quaternion
  const [a, b, c] = vector
  const tx = 2 * (y * c - z * b)
  const ty = 2 * (z * a - x * c)
  const tz = 2 * (x * b - y * a)
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx]
}
export function composeAssemblyPoses(
  left: AssemblyRigidPose,
  right: AssemblyRigidPose,
): AssemblyRigidPose {
  const translated = rotateAssemblyVector(right.translation, left.quaternion)
  const quaternion = multiplyQuaternion(left.quaternion, right.quaternion)
  const norm = Math.hypot(...quaternion)
  return {
    translation: [
      left.translation[0] + translated[0],
      left.translation[1] + translated[1],
      left.translation[2] + translated[2],
    ],
    quaternion: [
      quaternion[0] / norm,
      quaternion[1] / norm,
      quaternion[2] / norm,
      quaternion[3] / norm,
    ],
  }
}
export function invertAssemblyPose(pose: AssemblyRigidPose): AssemblyRigidPose {
  const [x, y, z, w] = pose.quaternion
  const quaternion: AssemblyQuaternion = [-x, -y, -z, w]
  return {
    translation: rotateAssemblyVector(
      [-pose.translation[0], -pose.translation[1], -pose.translation[2]],
      quaternion,
    ),
    quaternion,
  }
}
