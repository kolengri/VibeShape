import { base64ToBytes, bytesToBase64, sha256Bytes } from "./hash"
import type { ValidatedExtensionPackage } from "./package"
import type { ExtensionSignature } from "./schemas"

const SIGNATURE_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const
const SIGN_OPERATION = { name: "ECDSA", hash: "SHA-256" } as const

export async function createPublisherKeyPair() {
  return crypto.subtle.generateKey(SIGNATURE_ALGORITHM, true, ["sign", "verify"])
}

async function publisherKeyId(publicKey: CryptoKey) {
  return sha256Bytes(new Uint8Array(await crypto.subtle.exportKey("spki", publicKey)))
}

export async function signManifest(
  manifestBytes: Uint8Array,
  keyPair: CryptoKeyPair,
): Promise<ExtensionSignature> {
  const signature = await crypto.subtle.sign(
    SIGN_OPERATION,
    keyPair.privateKey,
    Uint8Array.from(manifestBytes),
  )
  return {
    schemaVersion: 0,
    algorithm: "ECDSA-P256-SHA256",
    keyId: await publisherKeyId(keyPair.publicKey),
    signature: bytesToBase64(new Uint8Array(signature)),
  }
}

export async function verifyPackageSignature(
  extensionPackage: ValidatedExtensionPackage,
  publicKey: CryptoKey,
) {
  const signature = extensionPackage.signature
  if (!signature) return false
  if (signature.keyId !== (await publisherKeyId(publicKey))) return false
  return crypto.subtle.verify(
    SIGN_OPERATION,
    publicKey,
    base64ToBytes(signature.signature),
    Uint8Array.from(extensionPackage.manifestBytes),
  )
}

export function packageTrust(signatureValid: boolean | null) {
  return {
    identity:
      signatureValid === true ? ("verified-publisher" as const) : ("unknown-publisher" as const),
    sandboxRequired: true as const,
  }
}
