// A separate classic script satisfies the parent's self-only CSP without granting package code.
const runtimeUrl = new URL("./ui-panel-runtime.js?no-inline", import.meta.url).href

export function uiPanelHtml(sessionNonce: string, theme: "dark" | "light") {
  if (!/^[0-9a-f]{48}$/.test(sessionNonce)) throw new Error("The panel nonce is invalid.")
  const policy = `default-src 'none'; script-src 'nonce-${sessionNonce}'; style-src 'nonce-${sessionNonce}'; connect-src 'none'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
  const scheme = theme === "dark" ? "dark" : "light"
  const style = `:root{color-scheme:${scheme}}body{font:14px system-ui;margin:16px;color:CanvasText;background:Canvas}h1{font-size:18px}[role=group],section{display:grid;gap:12px}label{display:grid;grid-template-columns:minmax(0,1fr) 9em 3em;gap:8px;align-items:center}input,button{font:inherit;padding:6px}button{cursor:pointer}p[role=alert]:not(:empty){padding:8px;border:1px solid CanvasText;font-weight:600}section{margin-top:16px}output{font-weight:600}`
  const source = runtimeUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style nonce="${sessionNonce}">${style}</style></head><body><script nonce="${sessionNonce}" data-session="${sessionNonce}" crossorigin="anonymous" src="${source}"></script></body></html>`
}
