export const SOLVESPACE_BUILD_INPUTS = {
  builderImage:
    "emscripten/emsdk@sha256:1107465ce37d6d95942e53774ef2d272bea3880bb07d37fe63213469ef2d05dc",
  platform: "linux/arm64",
  outputModule: "vibeshape_slvs.mjs",
  outputWasm: "vibeshape_slvs.wasm",
  toolchain: {
    emscriptenCommit: "ce75e06884093bcefb86a6b8fd56a5d62a4cc245",
    emscriptenVersion: "6.0.6",
  },
  sources: {
    solvespace: {
      revision: "27b6a080c8b669421bd4d444650c3b8eddec5687",
      release: "v3.2",
      sha256: "dce38b12e26ba221c1a5aa3388d1188c152207664e364a99d71f290512352cb1",
      url: "https://github.com/solvespace/solvespace/archive/27b6a080c8b669421bd4d444650c3b8eddec5687.tar.gz",
    },
    eigen: {
      revision: "3147391d946bb4b6c68edd901f2add6ac1f31f8c",
      sha256: "0c8c490764f9c2a793133491adca0cd073b73e0bde965c68cbe58d91b5ed4261",
      url: "https://gitlab.com/libeigen/eigen/-/archive/3147391d946bb4b6c68edd901f2add6ac1f31f8c/eigen-3147391d946bb4b6c68edd901f2add6ac1f31f8c.tar.gz",
    },
    mimalloc: {
      revision: "f81bf1b31af819a31195e08f9546dc80f8931587",
      sha256: "b9dffb5b3d3218cd402fd7ca9d6b123d46c29d06485d769ebbfa7bb23c6773c2",
      url: "https://github.com/microsoft/mimalloc/archive/f81bf1b31af819a31195e08f9546dc80f8931587.tar.gz",
    },
  },
} as const

export function assertLocalSolveSpaceBuild(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.CI && environment.CI !== "false") {
    throw new Error(
      "SolveSpace source builds and evidence runs are local-only and must not consume CI minutes.",
    )
  }
}
