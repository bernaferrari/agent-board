import { describe, expect, test } from "bun:test"
import type { AgentBoardGraphNode } from "./graph-state"
import {
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  graphNodeBounds,
  reduceTransitiveGraphEdges,
  resolveGraphNodeOverlaps,
} from "./graph-geometry"

function node(id: string, x: number, y: number): AgentBoardGraphNode {
  return {
    id,
    x,
    y,
    depth: 0,
    pinned: false,
    blockedBy: 0,
    unblocks: 0,
    critical: false,
    card: {
      column: "open",
      issue: { id, title: id, raw: {} },
      artifacts: [],
      events: [],
    },
  }
}

describe("agentboard graph geometry", () => {
  test("measures node bounds including negative canvas coordinates", () => {
    expect(graphNodeBounds([node("A", -40, -20), node("B", 300, 200)])).toEqual({
      minX: -40,
      minY: -20,
      maxX: 300 + GRAPH_NODE_WIDTH,
      maxY: 200 + GRAPH_NODE_HEIGHT,
      width: 340 + GRAPH_NODE_WIDTH,
      height: 220 + GRAPH_NODE_HEIGHT,
    })
  })

  test("separates overlapping nodes within the same graph column", () => {
    const resolved = resolveGraphNodeOverlaps([node("A", 0, 10), node("B", 20, 20)])

    expect(resolved[0].y).toBe(10)
    expect(resolved[1].y).toBe(10 + GRAPH_NODE_HEIGHT + 36)
  })

  test("removes redundant blocking edges but preserves non-blocking relationships", () => {
    const reduced = reduceTransitiveGraphEdges([
      { id: "a-b", sourceIssueID: "A", targetIssueID: "B", type: "blocks" },
      { id: "b-c", sourceIssueID: "B", targetIssueID: "C", type: "blocks" },
      { id: "a-c", sourceIssueID: "A", targetIssueID: "C", type: "blocks" },
      { id: "a-c-related", sourceIssueID: "A", targetIssueID: "C", type: "related" },
    ])

    expect(reduced.map((edge) => edge.id)).toEqual(["a-b", "b-c", "a-c-related"])
  })
})
