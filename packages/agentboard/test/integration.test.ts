import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createServer } from "../src/server"
import { createStore } from "../src/store"
import { runBd, normalizeIssue } from "../src/beads"
import { projectBoard } from "../src/board"
import { buildAgentBoardGraph } from "../src/ui/graph-state"
import type { Snapshot } from "../src/types"

const fixture = await mkdtemp(path.join(os.tmpdir(), "agentboard-test-"))
const directory = path.join(fixture, "project")
const store = await createStore(path.join(fixture, "data"))
const server = createServer(store, "<!doctype html><title>AgentBoard</title>")
const client = new Client({ name: "agentboard-integration", version: "1.0.0" })
const transport = InMemoryTransport.createLinkedPair()

beforeAll(async () => {
  await mkdir(directory)
  const init = Bun.spawn(["bd", "init", "--prefix", "test", "--skip-agents", "--skip-hooks"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, error] = await Promise.all([init.exited, new Response(init.stderr).text()])
  if (code !== 0) throw new Error(error)
  await server.connect(transport[0])
  await client.connect(transport[1])
}, 60000)

afterAll(async () => {
  await client.close()
  await server.close()
  store.close()
  await Bun.spawn(["bd", "dolt", "stop"], {
    cwd: directory,
    stdout: "ignore",
    stderr: "ignore",
  }).exited
  await rm(fixture, { recursive: true, force: true })
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(JSON.stringify(result.content))
  return result.structuredContent as Snapshot
}

describe("local MCP plugin with real Beads", () => {
  test("discovers workspace entrypoints and a fullscreen self-contained resource", async () => {
    const tools = await client.listTools()
    expect(tools.tools.find((tool) => tool.name === "board_open")?._meta?.["openai/ui"]).toEqual({
      entrypoints: [{ type: "global" }, { type: "thread" }],
    })
    const resource = await client.readResource({
      uri: "ui://agent-board/workspace",
    })
    expect(resource.contents[0]._meta?.["openai/ui"]).toEqual({
      preferredDisplayMode: "fullscreen",
      availableDisplayModes: ["fullscreen"],
    })
    expect((await call("board_open")).board).toBeNull()
  })

  test("connects folders, creates issues, enforces blockers, reviews and closes work", async () => {
    const connected = await call("project_connect", { directory })
    const projectID = connected.board!.project.id
    const duplicate = await call("project_connect", { directory })
    expect(duplicate.projects).toHaveLength(1)
    await call("issue_create", { projectID, title: "Foundation", priority: 1 })
    const created = await call("issue_create", {
      projectID,
      title: "Dependent",
      description: "Acceptance criteria: works after foundation.",
    })
    const cards = created.board!.columns.flatMap((column) => column.cards)
    const foundation = cards.find((card) => card.issue.title === "Foundation")!.issue.id
    const dependent = cards.find((card) => card.issue.title === "Dependent")!.issue.id
    const linked = await call("dependency_update", {
      projectID,
      issueID: dependent,
      dependsOnID: foundation,
      action: "add",
    })
    expect(linked.board!.graph.dependencies).toContainEqual({
      fromIssueID: dependent,
      toIssueID: foundation,
      type: "blocks",
    })
    expect(linked.board!.columns[0].cards.find((card) => card.issue.id === dependent)?.issue.blocked).toBe(true)
    const rejected = await client.callTool({
      name: "issue_update",
      arguments: { projectID, issueID: dependent, status: "in_progress" },
    })
    expect(rejected.isError).toBe(true)
    await call("issue_update", {
      projectID,
      issueID: foundation,
      status: "closed",
    })
    const started = await call("issue_update", {
      projectID,
      issueID: dependent,
      status: "in_progress",
    })
    expect(started.board!.columns[1].cards[0].issue.id).toBe(dependent)
    const review = await call("issue_update", {
      projectID,
      issueID: dependent,
      status: "needs_review",
      notes: "Tests passed.",
    })
    expect(review.board!.columns[2].cards[0].issue.labels).toContain("agentboard:review")
    expect(review.board!.columns[2].cards[0].issue.raw.notes).toBe("Tests passed.")
    const context = await client.callTool({
      name: "issue_context",
      arguments: { projectID, issueID: dependent },
    })
    expect((context.structuredContent as Record<string, unknown>)?.prompt).toContain(directory)
    expect((context.structuredContent as Record<string, unknown>)?.prompt).toContain(dependent)
    const closed = await call("issue_update", {
      projectID,
      issueID: dependent,
      status: "closed",
    })
    expect(closed.board!.columns[3].cards).toHaveLength(2)
    expect(
      closed.board!.columns[3].cards.find((card) => card.issue.id === dependent)?.issue.labels ?? [],
    ).not.toContain("agentboard:review")
    await call("graph_save_positions", {
      projectID,
      positions: [{ issueID: dependent, x: 200, y: 350 }],
    })
    expect((await call("board_read", { projectID })).board!.graph.positions).toEqual([
      { issueID: dependent, x: 200, y: 350 },
    ])
    expect(await runBd(directory, ["list", "--all", "--limit", "0", "--tree=false"])).toHaveLength(2)
  }, 60000)

  test("rejects relative folders, unregistered projects and CLI option injection", async () => {
    expect(
      (
        await client.callTool({
          name: "project_connect",
          arguments: { directory: "../project" },
        })
      ).isError,
    ).toBe(true)
    expect(
      (
        await client.callTool({
          name: "board_read",
          arguments: { projectID: crypto.randomUUID() },
        })
      ).isError,
    ).toBe(true)
    expect(
      (
        await client.callTool({
          name: "issue_context",
          arguments: { projectID: store.list()[0].id, issueID: "--help" },
        })
      ).isError,
    ).toBe(true)
  })
})

test("graph retains dependency direction and all visible issue statuses", () => {
  const board = projectBoard({ id: crypto.randomUUID(), name: "Project", directory }, [
    normalizeIssue({
      id: "base",
      title: "Base",
      status: "closed",
      priority: 0,
    }),
    normalizeIssue({
      id: "next",
      title: "Next",
      status: "in_progress",
      labels: ["agentboard:review"],
      dependencies: [{ depends_on_id: "base", type: "blocks" }],
    }),
  ])
  const graph = buildAgentBoardGraph(board)
  expect(graph.nodes).toHaveLength(2)
  expect(graph.edges[0].sourceIssueID).toBe("base")
  expect(graph.edges[0].targetIssueID).toBe("next")
  expect(graph.nodes.find((node) => node.id === "base")!.x).toBeLessThan(
    graph.nodes.find((node) => node.id === "next")!.x,
  )
  expect(board.columns[2].cards[0].issue.blocked).toBe(false)
})

test("dependency impact counts each downstream issue once in a diamond", () => {
  const board = projectBoard({ id: crypto.randomUUID(), name: "Project", directory }, [
    normalizeIssue({ id: "base", title: "Base" }),
    normalizeIssue({ id: "left", title: "Left", dependencies: ["base"] }),
    normalizeIssue({ id: "right", title: "Right", dependencies: ["base"] }),
    normalizeIssue({ id: "tip", title: "Tip", dependencies: ["left", "right"] }),
  ])
  const graph = buildAgentBoardGraph(board)
  expect(graph.nodes.find((node) => node.id === "base")?.unblocks).toBe(3)
})
