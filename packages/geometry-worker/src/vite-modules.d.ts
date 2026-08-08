declare module "*?worker" {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}

declare module "*.wasm?url" {
  const wasmUrl: string
  export default wasmUrl
}

interface ImportMetaEnv {
  readonly MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
