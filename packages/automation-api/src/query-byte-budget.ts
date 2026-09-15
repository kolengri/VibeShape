/** Counting stops once a response cannot fit; callers only compare the result to their budget. */
export function serializedQueryBytes(value: unknown, maximum = 128 * 1024) {
  let bytes = 0
  for (const character of JSON.stringify(value)) {
    const point = character.codePointAt(0) ?? 0
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
    if (bytes > maximum) return bytes
  }
  return bytes
}
