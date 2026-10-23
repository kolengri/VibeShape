import { createRoot, type Root } from "react-dom/client"
import { ViewportGrid, ViewportGridBottom, ViewportGridItem } from "../shell/viewport-grid"

let root: Root | undefined

function LeftFixtureItems({
  fullHeight,
  visible,
  inner,
}: {
  fullHeight: boolean
  visible: boolean
  inner: boolean
}) {
  const fullHeightId = inner ? "left-second" : "left-first"
  return [
    { id: "left-first", height: 120, label: "Left first" },
    { id: "left-second", height: 80, label: "Left second" },
  ].map(({ id, height, label }) => (
    <ViewportGridItem
      key={id}
      id={id}
      area="left"
      width={200}
      fullHeight={fullHeight && id === fullHeightId}
      visible={visible || id !== fullHeightId}
    >
      <div style={{ height }}>{label}</div>
    </ViewportGridItem>
  ))
}

export function renderViewportGridFixture({
  firstFullHeight = false,
  firstVisible = true,
  firstHeight = "",
  leftFullHeight = false,
  leftVisible = true,
  innerFullHeight = false,
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
            <LeftFixtureItems
              fullHeight={leftFullHeight}
              visible={leftVisible}
              inner={innerFullHeight}
            />
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
            <ViewportGridItem
              id="right-fill"
              area="right"
              width={240}
              fullHeight
              order={innerFullHeight ? -100 : 100}
            >
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
