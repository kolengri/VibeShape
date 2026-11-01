// Minimal platform API declaration keeps DOM/Node ambient types out of this library.
declare const TextDecoder: {
  new (encoding?: string): { decode(input: Uint8Array): string }
}
export const F3dTextDecoder = TextDecoder
