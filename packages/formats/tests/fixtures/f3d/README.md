# Synthetic F3D fixture

`synthetic-box.f3d` contains a 10 cm cube B-rep, one XY circle sketch with a
0.5 cm radius, one numeric user parameter (`width = 15 mm`), and an explicitly
unsupported timeline record (`Unsupported1`). It contains no private or
third-party CAD design. The bytes were constructed for this test from documented
record layouts; the synthetic ASM box builder is adapted from Extrudo's
GPL-3.0-or-later `packages/f3d/src/brep-body.test.ts` at commit
`c05d910395f514f4810d3fc76504ce6bb1c73da8` (see the reader's `NOTICE.md`).

The independent sketch is deliberately unrelated to the cube. The expected
import is one immutable exact-body fallback, an editable native Sketch, and an
independent editable numeric variable. The unsupported timeline record must be
reported. The cube's expected normalized bounds are `[0,0,0]` to `[100,100,100]`
mm and its volume is 1,000,000 mm³. This synthetic archive is GPL-3.0-or-later.
