import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { OpenAIExtensions } from "@openai/mcp-extensions/server"
import { z } from "zod"
import { homedir } from "node:os"
import path from "node:path"
import { loadBoard } from "./board"
import { runBd, showIssue } from "./beads"
import { issuePrompt } from "./prompts"
import { createStore } from "./store"
import { readDesktopProjects } from "./desktop-projects"
import { inspectTracker } from "./project-status"
import type { Store } from "./store"
import { IssueType, REVIEW_LABEL, Status } from "./types"

const URI = "ui://agent-board/workspace"
const identity = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const projectID = z.string().uuid()
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

export function createServer(store: Store, html: string, options: { desktopState?: string } = {}) {
  const server = new McpServer({ name: "agent-board", version: "0.1.6" })
  new OpenAIExtensions(server)
  const projectChoices = async () => {
    const desktop = await readDesktopProjects(options.desktopState)
    const projects = store.list()
    const desktopPaths = new Set(desktop.suggestions.map((item) => item.directory))
    const suggestions = [
      ...desktop.suggestions,
      ...store.suggestions().filter((item) => !desktopPaths.has(item.directory)),
    ]
    const statuses = new Map(
      await Promise.all(
        [...new Set([...projects, ...suggestions].map((item) => item.directory))].map(
          async (directory) => [directory, await inspectTracker(directory)] as const,
        ),
      ),
    )
    return {
      projects: projects.map((item) => ({ ...item, tracker: statuses.get(item.directory) })),
      suggestions: suggestions.map((item) => ({ ...item, tracker: statuses.get(item.directory) })),
      ...(desktop.projectProblem ? { projectProblem: desktop.projectProblem } : {}),
    }
  }
  const snapshot = async (id?: string, recover = false) => {
    const projects = store.list()
    const selected = id ?? store.selected() ?? projects[0]?.id
    const project = selected ? store.get(selected) : undefined
    const result = project
      ? await loadBoard(project, store.positions(project.id))
          .then((board) => ({ board }))
          .catch((cause: unknown) => {
            if (!recover) throw cause
            return { board: null, problem: cause instanceof Error ? cause.message : String(cause) }
          })
      : { board: null }
    if (result.board) store.select(result.board.project.id)
    return {
      ...(await projectChoices()),
      ...result,
    }
  }

  registerAppResource(server, "AgentBoard", URI, {}, async () => ({
    contents: [
      {
        uri: URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: html,
        _meta: {
          ui: { csp: { connectDomains: [], resourceDomains: [] } },
          "openai/ui": {
            preferredDisplayMode: "fullscreen",
            availableDisplayModes: ["fullscreen"],
          },
        },
      },
    ],
  }))

  registerAppTool(
    server,
    "board_open",
    {
      title: "AgentBoard Workspace",
      description:
        "Open the local Beads board in ChatGPT desktop. Shows Board, List and Graph views. Call with no arguments to open the workspace or a projectID to select a connected project.",
      inputSchema: { projectID: projectID.optional() },
      annotations: readOnly,
      _meta: {
        ui: { resourceUri: URI },
        "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
      },
    },
    // Opening navigation must never wait for a remembered tracker's database.
    async (input) =>
      response(input.projectID ? await snapshot(input.projectID, true) : { ...(await projectChoices()), board: null }),
  )

  server.registerTool(
    "project_import",
    {
      title: "Import desktop project choices",
      description:
        "Save local project choices returned by the desktop host's list_projects tool. Include only projects on this local host with absolute folder paths; exclude cloud ChatGPT projects and remote hosts. Does not connect, scan, or initialize their trackers. The user chooses a folder in AgentBoard before connecting.",
      inputSchema: { paths: z.array(z.string().trim().min(1).max(4096)).max(200) },
      annotations: write,
    },
    async (input) => {
      store.importProjects(input.paths)
      return response(await projectChoices())
    },
  )

  server.registerTool(
    "board_read",
    {
      title: "Read the Beads board",
      description: "Reload the connected project's board without opening another view.",
      inputSchema: { projectID: projectID.optional() },
      annotations: readOnly,
    },
    async (input) => response(await snapshot(input.projectID, !input.projectID)),
  )

  server.registerTool(
    "project_list",
    {
      title: "List desktop project paths",
      description:
        "List saved local desktop project paths and connected AgentBoard folders. Reads desktop preferences without scanning folders or initializing trackers. Excludes remote and cloud projects.",
      inputSchema: {},
      annotations: readOnly,
    },
    async () => response(await projectChoices()),
  )

  server.registerTool(
    "project_connect",
    {
      title: "Connect a Beads project",
      description:
        "Connect an absolute local folder selected by the user. The folder must already have a .beads tracker. Persists the connection for the desktop plugin.",
      inputSchema: { directory: z.string().min(1).max(4096) },
      annotations: write,
    },
    async (input) => {
      const project = await store.connect(input.directory)
      return response(await snapshot(project.id))
    },
  )

  server.registerTool(
    "issue_context",
    {
      title: "Read issue context",
      description:
        "Reload a Beads issue, its dependencies and a local ChatGPT handoff prompt. Reading context does not start an agent or change the issue.",
      inputSchema: { projectID, issueID: identity },
      annotations: readOnly,
    },
    async (input) => {
      const project = store.get(input.projectID)
      const issue = await showIssue(project.directory, input.issueID)
      return response({ project, issue, prompt: issuePrompt(project, issue) })
    },
  )

  server.registerTool(
    "issue_create",
    {
      title: "Create a Beads issue",
      description:
        "Create a task in a connected project with an actionable title, description and priority. Returns a refreshed board.",
      inputSchema: {
        projectID,
        title: z.string().trim().min(1).max(500),
        description: z.string().max(50000).optional(),
        priority: z.number().int().min(0).max(4).default(2),
        type: IssueType.default("task"),
      },
      annotations: write,
    },
    async (input) => {
      await runBd(store.get(input.projectID).directory, [
        "create",
        "--title",
        input.title,
        "--description",
        input.description ?? "",
        "--priority",
        String(input.priority),
        "--type",
        input.type,
      ])
      return response(await snapshot(input.projectID))
    },
  )

  server.registerTool(
    "issue_update",
    {
      title: "Update a Beads issue",
      description:
        "Move an issue through Open, In Progress, Needs Review and Closed. Needs Review uses the agentboard:review label. Starting blocked work is rejected. Optionally append notes, edit title, description or priority.",
      inputSchema: {
        projectID,
        issueID: identity,
        status: Status.optional(),
        title: z.string().trim().min(1).max(500).optional(),
        description: z.string().max(50000).optional(),
        priority: z.number().int().min(0).max(4).optional(),
        notes: z.string().max(50000).optional(),
        type: IssueType.optional(),
      },
      annotations: write,
    },
    async (input) => {
      const project = store.get(input.projectID)
      if (input.status === "in_progress") {
        const board = await loadBoard(project, store.positions(project.id))
        const card = board.columns.flatMap((column) => column.cards).find((card) => card.issue.id === input.issueID)
        if (!card) throw new Error("Issue no longer exists. Refresh the board.")
        if (card.issue.blocked) throw new Error("Resolve this issue's blockers before starting work.")
      }
      const args = ["update", input.issueID]
      if (input.status)
        args.push(
          "--status",
          input.status === "needs_review" ? "in_progress" : input.status,
          input.status === "needs_review" ? "--add-label" : "--remove-label",
          REVIEW_LABEL,
        )
      if (input.title !== undefined) args.push("--title", input.title)
      if (input.description !== undefined) args.push("--description", input.description)
      if (input.priority !== undefined) args.push("--priority", String(input.priority))
      if (input.notes !== undefined) args.push("--append-notes", input.notes)
      if (input.type !== undefined) args.push("--type", input.type)
      if (args.length === 2) throw new Error("Choose at least one field to update.")
      await runBd(project.directory, args)
      return response(await snapshot(project.id))
    },
  )

  server.registerTool(
    "dependency_update",
    {
      title: "Update an issue dependency",
      description:
        "Add or remove a blocking dependency. issueID depends on dependsOnID. Beads validates cycles. Returns the updated board and graph.",
      inputSchema: {
        projectID,
        issueID: identity,
        dependsOnID: identity,
        action: z.enum(["add", "remove"]),
      },
      annotations: write,
    },
    async (input) => {
      await runBd(store.get(input.projectID).directory, ["dep", input.action, input.issueID, input.dependsOnID])
      return response(await snapshot(input.projectID))
    },
  )

  server.registerTool(
    "graph_save_positions",
    {
      title: "Save graph layout",
      description: "Save graph node coordinates for a connected project. Does not modify Beads issues.",
      inputSchema: {
        projectID,
        positions: z
          .array(
            z.object({
              issueID: identity,
              x: z.number().finite().min(0).max(100000),
              y: z.number().finite().min(0).max(100000),
            }),
          )
          .max(5000),
      },
      annotations: { ...write, idempotentHint: true },
    },
    async (input) => {
      store.get(input.projectID)
      store.savePositions(input.projectID, input.positions)
      return response({ saved: true })
    },
  )

  return server
}

function response(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  }
}

if (import.meta.main) {
  const store = await createStore(
    Bun.env.PLUGIN_DATA ?? Bun.env.AGENTBOARD_DATA_DIR ?? path.join(homedir(), ".agentboard"),
  )
  if (Bun.env.AGENTBOARD_PROJECT_DIRECTORY) await store.connect(Bun.env.AGENTBOARD_PROJECT_DIRECTORY)
  const server = createServer(store, await Bun.file(new URL("./board.html", import.meta.url)).text())
  await server.connect(new StdioServerTransport())
}
