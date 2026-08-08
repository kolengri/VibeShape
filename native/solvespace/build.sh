#!/usr/bin/env bash
set -euo pipefail

readonly input_root="/input"
readonly work_root="/work"
readonly source_root="${work_root}/solvespace"
readonly build_root="${work_root}/build"
readonly output_root="/output"

rm -rf "${work_root}"
mkdir -p \
  "${source_root}" \
  "${source_root}/extlib/eigen" \
  "${source_root}/extlib/mimalloc" \
  "${build_root}" \
  "${output_root}"

tar -xzf "${input_root}/sources/solvespace.tar.gz" --strip-components=1 -C "${source_root}"
tar -xzf "${input_root}/sources/eigen.tar.gz" --strip-components=1 -C "${source_root}/extlib/eigen"
tar -xzf "${input_root}/sources/mimalloc.tar.gz" --strip-components=1 -C "${source_root}/extlib/mimalloc"
cp "${input_root}/native/vibeshape_solver_abi.cpp" "${source_root}/src/slvs/vibeshape_solver_abi.cpp"
patch --directory="${source_root}" --strip=1 < "${input_root}/patches/solvespace-v3.2-vibeshape.patch"

export EM_CACHE="${work_root}/emscripten-cache"
export LC_ALL=C
export SOURCE_DATE_EPOCH=1774563433
export TZ=UTC
emcmake cmake \
  -S "${source_root}" \
  -B "${build_root}" \
  -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_CLI=OFF \
  -DENABLE_GUI=OFF \
  -DENABLE_LTO=ON \
  -DENABLE_TESTS=OFF \
  -DFORCE_VENDORED_Eigen3=ON
emmake cmake --build "${build_root}" --target slvs-wasm --parallel

cp "${build_root}/bin/vibeshape_slvs.mjs" "${output_root}/vibeshape_slvs.mjs"
cp "${build_root}/bin/vibeshape_slvs.wasm" "${output_root}/vibeshape_slvs.wasm"
