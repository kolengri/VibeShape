import { createRoot, type Root } from "react-dom/client"
import { ViewportGrid, ViewportGridBottom, ViewportGridItem } from "../shell/viewport-grid"

let root: Root | undefined

export function renderViewportGridFixture({
  firstFullHeight = false,
  firstVisible = true,
  firstHeight = "",
} = {}) {
  if (!root) {
    const host = document.createElement("div")
    host.style.cssText = "position:fixed;inset:0;z-index:1000"
    document.body.append(host)
    root = createRoot(host)
  }
  root.render(
    <main className="cad-shell">
      <div className="application-bar">Overlay layout fixture</div>
      <ViewportGrid>
        <div className="editor-workbench">
          <nav data-sketch-mode="false">Toolbar</nav>
          <div className="editor-model-area">
            <div className="workspace-viewport">
              <canvas aria-label="Fixture viewport" style={{ width: "100%", height: "100%" }} />
            </div>
            <ViewportGridItem id="left-first" area="left" width={200}>
              <div style={{ height: 120 }}>Left first</div>
            </ViewportGridItem>
            <ViewportGridItem id="left-second" area="left" width={200}>
              <div style={{ height: 80 }}>Left second</div>
            </ViewportGridItem>
            <ViewportGridItem
              id="right-first"
              area="right"
              width={220}
              visible={firstVisible}
              fullHeight={firstFullHeight}
              height={firstHeight}
            >
              <div style={{ minHeight: 120 }}>
                <input aria-label="Retained slot draft" defaultValue="12" />
              </div>
            </ViewportGridItem>
            <ViewportGridItem id="right-second" area="right" width={240}>
              <div style={{ height: 160 }}>Right second</div>
            </ViewportGridItem>
            <ViewportGridItem id="right-fill" area="right" width={240} fullHeight order={100}>
              <div>Full-height item</div>
            </ViewportGridItem>
            <ViewportGridItem id="bottom-first" area="bottom">
              <div style={{ height: 40 }}>Bottom first</div>
            </ViewportGridItem>
            <ViewportGridItem id="bottom-second" area="bottom" order={50}>
              <div style={{ height: 30 }}>Bottom second</div>
            </ViewportGridItem>
          </div>
          <ViewportGridBottom />
          <footer>Status</footer>
        </div>
      </ViewportGrid>
    </main>,
  )
}
