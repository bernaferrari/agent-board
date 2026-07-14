import { describe, expect, test } from "bun:test"
import type { AgentBoardBoard, AgentBoardCard } from "./api"
import { buildAgentBoardGraph } from "./graph-state"

const foundation: AgentBoardCard = {
  column: "open",
  issue: { id: "AB-1", title: "Foundation", priority: 0, raw: {} },
  artifacts: [],
  events: [],
}

const dependent: AgentBoardCard = {
  column: "open",
  issue: { id: "AB-2", title: "Dependent", priority: 1, blocked: true, raw: {} },
  artifacts: [],
  events: [],
}

function board(): AgentBoardBoard {
  return {
    project: { id: "project-1", worktree: "/tmp/project", enabled: true, time: { created: 1, updated: 1 } },
    generatedAt: 1,
    graph: {
      dependencies: [{ fromIssueID: "AB-2", toIssueID: "AB-1", type: "blocks" }],
      positions: [],
    },
    columns: [
      { id: "open", title: "Open", cards: [dependent, foundation] },
      { id: "in_progress", title: "In Progress", cards: [] },
      { id: "needs_review", title: "Needs Review", cards: [] },
      { id: "closed", title: "Closed", cards: [] },
    ],
  }
}

describe("agentboard graph state", () => {
  test("lays out dependencies from prerequisite to dependent", () => {
    const graph = buildAgentBoardGraph(board())

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["AB-1", "AB-2"])
    expect(graph.edges).toMatchObject([
      {
        sourceIssueID: "AB-1",
        targetIssueID: "AB-2",
        type: "blocks",
      },
    ])
    expect(graph.nodes.find((node) => node.id === "AB-2")!.depth).toBeGreaterThan(
      graph.nodes.find((node) => node.id === "AB-1")!.depth,
    )
  })

  test("only blocking dependencies count as blocked", () => {
    const input = board()
    input.graph.dependencies = [
      { fromIssueID: "AB-2", toIssueID: "AB-1", type: "dependency" },
    ]

    const graph = buildAgentBoardGraph(input)

    expect(graph.nodes.find((node) => node.id === "AB-2")?.blockedBy).toBe(0)
  })

  test("ignores saved graph positions in base layout", () => {
    const input = board()
    input.graph.positions = [{ issueID: "AB-2", x: 500, y: 240, pinned: true }]

    const graph = buildAgentBoardGraph(input)

    expect(graph.nodes.find((node) => node.id === "AB-2")).toMatchObject({
      pinned: false,
    })
    expect(graph.nodes.find((node) => node.id === "AB-2")?.x).not.toBe(500)
    expect(graph.nodes.find((node) => node.id === "AB-2")?.y).not.toBe(240)
  })

  test("increases auto-layout spacing for large graphs", () => {
    const cards = Array.from({ length: 130 }, (_, index): AgentBoardCard => {
      const id = `AB-${index + 1}`
      return {
        column: "open",
        issue: { id, title: id, raw: {} },
        artifacts: [],
        events: [],
      }
    })
    const input: AgentBoardBoard = {
      project: { id: "project-1", worktree: "/tmp/project", enabled: true, time: { created: 1, updated: 1 } },
      generatedAt: 1,
      graph: { dependencies: [], positions: [] },
      columns: [
        { id: "open", title: "Open", cards },
        { id: "in_progress", title: "In Progress", cards: [] },
        { id: "needs_review", title: "Needs Review", cards: [] },
        { id: "closed", title: "Closed", cards: [] },
      ],
    }

    const graph = buildAgentBoardGraph(input)
    const first = graph.nodes.find((node) => node.id === "AB-1")!
    const second = graph.nodes.find((node) => node.id === "AB-2")!

    expect(second.y - first.y).toBeGreaterThan(220)
  })
})
