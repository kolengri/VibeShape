export const OCCT_BUILD_INPUTS = {
  builderImage:
    "donalffons/opencascade.js@sha256:3069f4c2e3ab62bb82d81843bad2c0f8552ee92373208f8f655ef9bf71c0524d",
  platform: "linux/amd64",
  outputBaseName: "vibeshape_occt",
  sourceBuilder: {
    emscriptenImage:
      "emscripten/emsdk@sha256:4c3e0a0dac61430b719e82118ae9b2c7480902a2713267e80fa296d39f7ab921",
    pythonPackages: ["argparse==1.4.0", "cerberus==1.3.4", "libclang==15.0.6.1", "pyyaml==6.0"],
    registryBaselineOutputs: {
      "vibeshape_occt.js": {
        bytes: 135_503,
        sha256: "d28f69b40b60f3881ccd3a996664a1732527a34cc154e2511dbfa02cd5c5081c",
      },
      "vibeshape_occt.wasm": {
        bytes: 10_852_832,
        sha256: "a6878af17b88a59e97243929ad89bca44fbb43884297077aa5941a42c88b15fd",
      },
      "vibeshape_occt.d.ts": {
        bytes: 410_813,
        sha256: "fa6eb436aad62f5c85f3a1a8e3ce67b3a4202e9a08b7a482db00aae0b6a79152",
      },
    },
  },
  sources: {
    opencascadeJs: {
      revision: "5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7",
      sha256: "7107d5a36712542997895efa17b44ea0e2b956c3908cbe98b7d95c194f1e556f",
      url: "https://github.com/donalffons/opencascade.js/archive/5ff2b750ba4b9a9fdfbff8842712cbb562e78ce7.tar.gz",
    },
    occt: {
      revision: "bb368e271e24f63078129283148ce83db6b9670a",
      sha256: "fabda9f139f2c09e675d5b9717110175b0ad5d9fb09187e3d56687220d2687e6",
      url: "https://github.com/Open-Cascade-SAS/OCCT/archive/bb368e271e24f63078129283148ce83db6b9670a.tar.gz",
    },
    rapidjson: {
      revision: "v1.1.0",
      sha256: "bf7ced29704a1e696fbccf2a2b4ea068e7774fa37f6d7dd4039d0787f8bed98e",
      url: "https://github.com/Tencent/rapidjson/archive/refs/tags/v1.1.0.tar.gz",
    },
    freetype: {
      revision: "VER-2-13-0",
      sha256: "a683f1091aee95d2deaca9292d976f87415610b8ae1ea186abeebcb08e83ab12",
      url: "https://github.com/freetype/freetype/archive/refs/tags/VER-2-13-0.tar.gz",
    },
    replicad: {
      revision: "19fb8212e0bb12a07a7a49f96950f8903903d469",
      sha256: "83a9fd99e39b77d7128270e08764cafd334117fbd0d083792b3a49aaa181787f",
      url: "https://github.com/sgenoud/replicad/archive/19fb8212e0bb12a07a7a49f96950f8903903d469.tar.gz",
    },
  },
} as const

const buildNameAnchor = "  name: replicad_single.js"
const symbolAnchor = "  - symbol: GeomToolsWrapper"
const cppAnchor = "additionalCppCode: |\n  class BRepToolsWrapper"

const diagnosticBindings = `  class VibeShapeAllocatorStats {
  public:
    static double ArenaBytes() {
      return static_cast<double>(mallinfo().arena);
    }
    static double AllocatedBytes() {
      return static_cast<double>(mallinfo().uordblks);
    }
    static double FreeBytes() {
      return static_cast<double>(mallinfo().fordblks);
    }
  };

  class VibeShapeOcctDiagnostics {
  public:
    static double PurgeAllocator() {
      return static_cast<double>(Standard::Purge());
    }
    static double RunNativeBoxCycle() {
      BRepPrimAPI_MakeBox maker(10.0, 10.0, 10.0);
      const TopoDS_Solid solid = maker.Solid();
      return solid.IsNull() ? 0.0 : 1.0;
    }
    static double RunNativeCylinderCycle() {
      BRepPrimAPI_MakeCylinder maker(5.0, 10.0);
      const TopoDS_Solid solid = maker.Solid();
      return solid.IsNull() ? 0.0 : 1.0;
    }
  };

  class BRepToolsWrapper`

function replaceExactlyOnce(source: string, anchor: string, replacement: string) {
  const firstIndex = source.indexOf(anchor)

  if (firstIndex < 0 || firstIndex !== source.lastIndexOf(anchor)) {
    throw new Error(`Expected exactly one OCCT build-config anchor: ${anchor}`)
  }

  return source.replace(anchor, replacement)
}

export function instrumentReplicadBuildConfig(source: string) {
  const withBuildName = replaceExactlyOnce(
    source,
    buildNameAnchor,
    `  name: ${OCCT_BUILD_INPUTS.outputBaseName}.js`,
  )
  const withSymbol = replaceExactlyOnce(
    withBuildName,
    symbolAnchor,
    `${symbolAnchor}\n  - symbol: VibeShapeAllocatorStats\n  - symbol: VibeShapeOcctDiagnostics`,
  )

  return replaceExactlyOnce(
    withSymbol,
    cppAnchor,
    `additionalCppCode: |\n  #include <malloc.h>\n  #include <Standard.hxx>\n\n${diagnosticBindings}`,
  )
}
