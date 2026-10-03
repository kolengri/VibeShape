// The upstream declaration imports Node streams although parseSync is browser-safe.
declare module "dxf-parser/dist/dxf-parser.js" {
  export default class DxfParser {
    parseSync(source: string): unknown
  }
}
