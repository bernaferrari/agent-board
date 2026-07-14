import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { For, Show } from "solid-js"
import type { AgentBoardColumnID } from "./api"
import { COLUMN_ACCENT } from "./ui-tokens"

const MINIMAP_STATUS_FILL: Record<AgentBoardColumnID, string> = {
  blocked: "#ff7b72",
  open: "#7ee787",
  in_progress: "#f2cc60",
  needs_review: "#79c0ff",
  closed: "#d2a8ff",
}

export type GraphMinimapNode = {
  id: string
  column: AgentBoardColumnID
  selected: boolean
  active: boolean
  related: boolean
  muted: boolean
  x: number
  y: number
}

export type GraphMinimapEdge = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  critical?: boolean
  active: boolean
  muted: boolean
}

export type GraphViewportBounds = {
  left: number
  top: number
  width: number
  height: number
}

export function GraphMinimap(props: {
  scale: number
  nodes: GraphMinimapNode[]
  edges: GraphMinimapEdge[]
  viewportBounds?: GraphViewportBounds
  columnStats: Array<{ column: AgentBoardColumnID; count: number }>
  onFit: () => void
  onPointerDown: (event: PointerEvent) => void
}) {
  return (
    <>
      <div class="absolute bottom-4 right-4 hidden w-44 rounded-lg border border-border-weaker-base bg-background-base/95 p-2 shadow-lg backdrop-blur md:block">
        <div class="mb-1 flex items-center justify-between text-10-semibold uppercase tracking-wide text-text-weak">
          <span>Map</span>
          <div class="flex items-center gap-1.5">
            <span class="tabular-nums">{Math.round(props.scale * 100)}%</span>
            <Tooltip placement="top" value="Fit graph to view">
              <IconButton
                icon="expand"
                variant="ghost"
                size="small"
                onClick={props.onFit}
                aria-label="Fit graph to view"
              />
            </Tooltip>
          </div>
        </div>
        <div
          class="relative h-24 cursor-crosshair overflow-hidden rounded-md bg-surface-raised-base shadow-xs-border-base touch-none"
          onPointerDown={props.onPointerDown}
        >
          <svg class="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <For each={props.edges}>
              {(edge) => (
                <line
                  class={
                    edge.active
                      ? "text-text-strong"
                      : edge.critical
                        ? "text-[#f85149]"
                        : edge.muted
                          ? "text-border-strong-base"
                          : "text-border-strong-base"
                  }
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke="currentColor"
                  stroke-opacity={edge.active ? 0.95 : edge.muted ? 0.28 : edge.critical ? 0.72 : 0.62}
                  stroke-width={edge.active ? 1.05 : edge.critical ? 0.75 : 0.55}
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
            <For each={props.nodes}>
              {(node) => (
                <rect
                  x={node.x - (node.active || node.selected ? 2.6 : node.column === "closed" ? 1.7 : 2.1)}
                  y={node.y - (node.active || node.selected ? 1.8 : node.column === "closed" ? 1.1 : 1.35)}
                  width={node.active || node.selected ? 5.2 : node.column === "closed" ? 3.4 : 4.2}
                  height={node.active || node.selected ? 3.6 : node.column === "closed" ? 2.2 : 2.7}
                  rx={0.8}
                  fill={MINIMAP_STATUS_FILL[node.column]}
                  fill-opacity={node.muted ? 0.22 : node.column === "closed" ? 0.64 : 0.95}
                  stroke={
                    node.active || node.selected
                      ? "rgba(255, 255, 255, 0.92)"
                      : node.related
                        ? "rgba(255, 255, 255, 0.52)"
                        : "rgba(13, 17, 23, 0.72)"
                  }
                  stroke-width={node.active || node.selected ? 0.95 : node.related ? 0.6 : 0.35}
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
          </svg>
          <Show when={props.viewportBounds}>
            {(bounds) => (
              <div
                class="pointer-events-none absolute z-20 rounded-md border border-[#58a6ff] bg-[#58a6ff]/12 shadow-[0_0_0_999px_rgba(0,0,0,0.16),0_0_0_1px_rgba(255,255,255,0.16)_inset,0_0_12px_rgba(88,166,255,0.30)]"
                style={{
                  left: `${bounds().left}%`,
                  top: `${bounds().top}%`,
                  width: `${bounds().width}%`,
                  height: `${bounds().height}%`,
                }}
              />
            )}
          </Show>
        </div>
      </div>
      <Show when={props.columnStats.length > 0}>
        <div class="pointer-events-none absolute bottom-4 left-4 hidden max-w-[calc(100%-14rem)] rounded-lg border border-border-weaker-base bg-background-base/92 px-2.5 py-2 shadow-lg backdrop-blur md:flex">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <For each={props.columnStats}>
              {(item) => (
                <span class="inline-flex items-center gap-1.5 text-11-regular text-text-weak">
                  <span class={`size-2 rounded-full ${COLUMN_ACCENT[item.column].dot}`} />
                  <span class="capitalize">{item.column.replaceAll("_", " ")}</span>
                  <span class="font-mono text-10-semibold tabular-nums text-text-base">{item.count}</span>
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
    </>
  )
}
