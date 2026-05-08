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

function node(id: string, column: AgentBoardCard["column"] = "ready"): AgentBoardGraphNode {
  return {
    id,
    card: {
      column,
      issue: { id, title: id, priority: 1, raw: {} },
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
