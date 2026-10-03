export function transformDeterminant(matrix: readonly number[]) {
  const [a, b, c, , d, e, f, , g, h, i] = matrix
  return (
    (a ?? 0) * ((e ?? 0) * (i ?? 0) - (f ?? 0) * (h ?? 0)) -
    (d ?? 0) * ((b ?? 0) * (i ?? 0) - (c ?? 0) * (h ?? 0)) +
    (g ?? 0) * ((b ?? 0) * (f ?? 0) - (c ?? 0) * (e ?? 0))
  )
}
