import { strToU8, zipSync } from "fflate"
import { bytesToBase64, sha256Bytes } from "./hash"
import type { ExtensionCapability, ExtensionManifest, ExtensionSignature } from "./schemas"

const FIXED_ARCHIVE_TIME = new Date("1980-01-01T00:00:00.000Z")
const PANEL_SCRIPT = `let port=null;let session=null;addEventListener("message",(event)=>{if(event.source!==parent||event.data?.type!=="vibeshape.extension.initialize"||port)return;port=event.ports[0];session=event.data;document.querySelector("button").addEventListener("click",()=>port.postMessage({schemaVersion:0,extensionId:session.extensionId,sessionNonce:session.sessionNonce,sequence:1,type:"command",capability:"ui.command",commandId:"org.example.threaded-insert.create",opaqueOrigin:location.origin==="null"}));document.body.dataset.ready="true";port.postMessage({schemaVersion:0,extensionId:session.extensionId,sessionNonce:session.sessionNonce,sequence:0,type:"ready",capability:"ui.command",commandId:null,opaqueOrigin:location.origin==="null"});},{once:true});`

function section(id: number, payload: readonly number[]) {
  return [id, payload.length, ...payload]
}

export function scalarFeatureWasm(multiplier: number) {
  if (!Number.isInteger(multiplier) || multiplier < 0 || multiplier > 127) {
    throw new Error("The scalar fixture multiplier must fit one unsigned LEB128 byte.")
  }
  return Uint8Array.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, [0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f]),
    ...section(3, [0x01, 0x00]),
    ...section(7, [0x01, 0x08, ...strToU8("evaluate"), 0x00, 0x00]),
    ...section(10, [0x01, 0x07, 0x00, 0x20, 0x00, 0x41, multiplier, 0x6c, 0x0b]),
  ])
}

export function infiniteLoopWasm() {
  return Uint8Array.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, [0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f]),
    ...section(3, [0x01, 0x00]),
    ...section(7, [0x01, 0x08, ...strToU8("evaluate"), 0x00, 0x00]),
    ...section(10, [0x01, 0x09, 0x00, 0x03, 0x40, 0x0c, 0x00, 0x0b, 0x41, 0x00, 0x0b]),
  ])
}

export function undeclaredImportWasm() {
  return Uint8Array.from([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    ...section(1, [0x02, 0x60, 0x00, 0x00, 0x60, 0x01, 0x7f, 0x01, 0x7f]),
    ...section(2, [0x01, 0x03, ...strToU8("env"), 0x05, ...strToU8("fetch"), 0x00, 0x00]),
    ...section(3, [0x01, 0x01]),
    ...section(7, [0x01, 0x08, ...strToU8("evaluate"), 0x00, 0x01]),
    ...section(10, [0x01, 0x06, 0x00, 0x10, 0x00, 0x20, 0x00, 0x0b]),
  ])
}

async function panelHtml() {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(strToU8(PANEL_SCRIPT))),
  )
  const policy = `default-src 'none'; script-src 'sha256-${bytesToBase64(digest)}'; style-src 'none'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`
  return strToU8(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>Threaded Insert</title></head><body><button type="button">Create threaded insert</button><script>${PANEL_SCRIPT}</script></body></html>`,
  )
}

function canonicalJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

export async function buildExtensionArchive(input: {
  manifest: ExtensionManifest
  files: Readonly<Record<string, Uint8Array>>
  signature?: ExtensionSignature
}) {
  const archive: Record<string, [Uint8Array, { level: 0; mtime: Date }]> = {
    "vibeshape-extension.json": [
      strToU8(canonicalJson(input.manifest)),
      { level: 0, mtime: FIXED_ARCHIVE_TIME },
    ],
  }
  for (const name of Object.keys(input.files).sort()) {
    const bytes = input.files[name]
    if (bytes) archive[name] = [bytes, { level: 0, mtime: FIXED_ARCHIVE_TIME }]
  }
  if (input.signature) {
    archive["signature.json"] = [
      strToU8(canonicalJson(input.signature)),
      { level: 0, mtime: FIXED_ARCHIVE_TIME },
    ]
  }
  return zipSync(archive)
}

export async function extensionFixture(input: {
  version: string
  multiplier: number
  capabilities?: ExtensionCapability[]
  signature?: ExtensionSignature
}) {
  const files = {
    LICENSE: strToU8("SPDX-License-Identifier: GPL-3.0-or-later\n"),
    "feature/main.wasm": scalarFeatureWasm(input.multiplier),
    "ui/panel.html": await panelHtml(),
  }
  const fileChecksums = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([name, bytes]) => [name, await sha256Bytes(bytes)] as const),
    ),
  )
  const manifest: ExtensionManifest = {
    schemaVersion: 1,
    id: "org.example.threaded-insert",
    name: "Threaded Insert",
    version: input.version,
    apiVersion: "1.0",
    license: "GPL-3.0-or-later",
    entrypoints: { feature: "feature/main.wasm", ui: "ui/panel.html" },
    capabilities: input.capabilities ?? ["ui.command", "ui.panel"],
    files: fileChecksums,
  }
  const archiveInput = input.signature
    ? { manifest, files, signature: input.signature }
    : { manifest, files }
  return {
    manifest,
    files,
    archive: await buildExtensionArchive(archiveInput),
  }
}
