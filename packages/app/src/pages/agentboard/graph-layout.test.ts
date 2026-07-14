import { describe, expect, test } from "bun:test"
import type { AgentBoardCard } from "./api"
import { buildGraphDependencyLayout, getDependencyEdgeNodes } from "./graph-layout"
import type { AgentBoardGraphNode } from "./graph-state"

const options = {
  nodeWidth: 276,
  nodeHeight: 124,
  nodeGap: 96,
  layerGap: 360,
  columnGap: 440,
  rowGap: 184,
}

function node(
  id: string,
  column: AgentBoardCard["column"] = "open",
  raw: Record<string, unknown> = {},
): AgentBoardGraphNode {
  return {
    id,
    card: {
      column,
      issue: { id, title: id, priority: 1, raw },
      artifacts: [],
      events: [],
    },
    x: 0,
    y: 0,
    depth: 0,
    pinned: false,
    blockedBy: 0,
    unblocks: 0,
    critical: false,
  }
}

describe("agentboard graph dependency layout", () => {
  test("ranks prerequisites outside dependents", () => {
    const nodes = [node("A"), node("B"), node("C")]
    const layout = buildGraphDependencyLayout(
      nodes,
      [
        { sourceIssueID: "A", targetIssueID: "B" },
        { sourceIssueID: "B", targetIssueID: "C" },
      ],
      options,
    )

    expect(layout.layers.A).toBeGreaterThan(layout.layers.B)
    expect(layout.layers.B).toBeGreaterThan(layout.layers.C)
    expect(layout.layers.C).toBe(0)
  })

  test("keeps dependency cycles on one layer instead of inflating forever", () => {
    const nodes = [node("A"), node("B"), node("C")]
    const layout = buildGraphDependencyLayout(
      nodes,
      [
        { sourceIssueID: "A", targetIssueID: "B" },
        { sourceIssueID: "B", targetIssueID: "A" },
        { sourceIssueID: "A", targetIssueID: "C" },
      ],
      options,
    )

    expect(layout.layers.A).toBe(layout.layers.B)
    expect(layout.layers.A).toBeGreaterThan(layout.layers.C)
  })

  test("keeps isolated nodes out of the dependency layers", () => {
    const nodes = [node("A"), node("B"), node("alone")]
    const layout = buildGraphDependencyLayout(nodes, [{ sourceIssueID: "A", targetIssueID: "B" }], options)

    expect(layout.layers.alone).toBe(-1)
    expect(layout.positions.map((position) => position.issueID).sort()).toEqual(["A", "B", "alone"])
  })

  test("uses dependency layers as edge direction source of truth", () => {
    const outer = node("outer")
    const inner = node("inner")
    const edge = getDependencyEdgeNodes(inner, outer, { outer: 2, inner: 0 })

    expect(edge.source?.id).toBe("outer")
    expect(edge.target?.id).toBe("inner")
  })

  test("orders isolated cards by most recently updated first", () => {
    const nodes = [
      node("old", "open", { updated_at: "1700000000" }),
      node("new", "open", { updated_at: "1700009999" }),
      node("mid", "open", { updated_at: "1700005000" }),
    ]
    const layout = buildGraphDependencyLayout(nodes, [], options)
    const topToBottom = [...layout.positions].sort((a, b) => a.y - b.y || a.x - b.x)
    expect(topToBottom.map((position) => position.issueID)).toEqual(["new", "mid", "old"])
  })

  test("orders same-layer siblings by most recently updated first", () => {
    const nodes = [
      node("P"),
      node("older", "open", { updated_at: "1700000000" }),
      node("newer", "open", { updated_at: "1700009999" }),
    ]
    const layout = buildGraphDependencyLayout(
      nodes,
      [
        { sourceIssueID: "P", targetIssueID: "older" },
        { sourceIssueID: "P", targetIssueID: "newer" },
      ],
      options,
    )
    const positionByID = new Map(layout.positions.map((position) => [position.issueID, position]))
    expect(positionByID.get("newer")!.y).toBeLessThan(positionByID.get("older")!.y)
  })

  test("packs short islands beside a tall island instead of below it", () => {
    const tall = [node("P"), ...Array.from({ length: 24 }, (_, index) => node(`PC${index}`))]
    const tallEdges = tall.slice(1).map((child) => ({ sourceIssueID: "P", targetIssueID: child.id }))
    const smallIslands = Array.from({ length: 6 }, (_, index) => [node(`S${index}A`), node(`S${index}B`)])
    const smallEdges = smallIslands.map(([a, b]) => ({ sourceIssueID: a!.id, targetIssueID: b!.id }))

    const nodes = [...tall, ...smallIslands.flat()]
    const layout = buildGraphDependencyLayout(nodes, [...tallEdges, ...smallEdges], options)
    const positionByID = new Map(layout.positions.map((position) => [position.issueID, position]))

    const tallBottom = Math.max(...tall.map((n) => positionByID.get(n.id)!.y)) + options.nodeHeight
    for (const small of smallIslands.flat()) {
      // Row packing would push later small islands onto a new row below the
      // tall island; skyline packing keeps them within its vertical span.
      expect(positionByID.get(small.id)!.y).toBeLessThan(tallBottom)
    }
  })

  test("does not overlap cards in the same dependency island", () => {
    const nodes = ["A", "B", "C", "D", "E", "F", "G"].map((id) => node(id))
    const layout = buildGraphDependencyLayout(
      nodes,
      [
        { sourceIssueID: "A", targetIssueID: "D" },
        { sourceIssueID: "B", targetIssueID: "D" },
        { sourceIssueID: "C", targetIssueID: "D" },
        { sourceIssueID: "D", targetIssueID: "E" },
        { sourceIssueID: "F", targetIssueID: "E" },
        { sourceIssueID: "G", targetIssueID: "E" },
      ],
      options,
    )

    for (let i = 0; i < layout.positions.length; i++) {
      for (let j = i + 1; j < layout.positions.length; j++) {
        const a = layout.positions[i]!
        const b = layout.positions[j]!
        const overlaps =
          a.x < b.x + options.nodeWidth &&
          a.x + options.nodeWidth > b.x &&
          a.y < b.y + options.nodeHeight &&
          a.y + options.nodeHeight > b.y
        expect(overlaps).toBe(false)
      }
    }
  })
})
