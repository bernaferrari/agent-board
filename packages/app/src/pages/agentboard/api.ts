import type { ServerConnection } from "@/context/server"

export type AgentBoardRunStatus = "queued" | "running" | "needs_review" | "done" | "cancelled" | "failed"
export type AgentBoardColumnID = "blocked" | "ready" | "running" | "needs_review" | "closed"

export type BeadsIssue = {
  id: string
  title: string
  status?: string
  priority?: number | string
  description?: string
  blocked?: boolean
  raw: Record<string, unknown>
}

export type AgentBoardRun = {
  id: string
  projectID: string
  issueID: string
  opencodeSessionID?: string
  status: AgentBoardRunStatus
  prompt?: string
  agent?: string
  model?: string
  error?: string
  time: {
    created: number
    updated: number
    started?: number
    ended?: number
  }
}

export type AgentBoardArtifact = {
  id: string
  runID: string
  kind: "session" | "diff" | "todo" | "log" | "pr"
  title: string
  url?: string
  path?: string
  data?: unknown
  time: {
    created: number
  }
}

export type AgentBoardRunEvent = {
  id: string
  runID: string
  type:
    | "queued"
    | "lease_acquired"
    | "beads_status_updated"
    | "session_created"
    | "prompt_started"
    | "artifacts_collected"
    | "reconciled"
    | "needs_review"
    | "request_changes"
    | "cancelled"
    | "done"
    | "failed"
    | "lease_released"
  message: string
  data?: unknown
  time: {
    created: number
  }
}

export type AgentBoardCard = {
  issue: BeadsIssue
  column: AgentBoardColumnID
  latestRun?: AgentBoardRun
  activeRun?: AgentBoardRun
  artifacts: AgentBoardArtifact[]
  events: AgentBoardRunEvent[]
}

export type AgentBoardBoard = {
  project: {
    id: string
    worktree: string
    bdDbPath?: string
    enabled: boolean
    time: {
      created: number
      updated: number
    }
  }
  generatedAt: number
  columns: Array<{
    id: AgentBoardColumnID
    title: string
    cards: AgentBoardCard[]
  }>
}

export type AgentBoardStartReadyResult = {
  started: AgentBoardRun[]
  skipped: Array<{ issueID: string; reason: string }>
  failed: Array<{ issueID: string; error: string }>
}

export type AgentBoardRunDetail = {
  run: AgentBoardRun
  artifacts: AgentBoardArtifact[]
  events: AgentBoardRunEvent[]
}

export type AgentBoardClient = ReturnType<typeof createAgentBoardClient>

function headers(server: ServerConnection.HttpBase) {
  const output: Record<string, string> = {
    "content-type": "application/json",
  }
  if (server.password) output.authorization = `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`
  return output
}

export function createAgentBoardClient(input: { server: ServerConnection.HttpBase; directory: string }) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = new URL(`/agentboard${path}`, input.server.url)
    url.searchParams.set("directory", input.directory)
    const response = await fetch(url, {
      ...init,
      headers: {
        ...headers(input.server),
        ...(init?.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init?.headers),
      },
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok) throw new Error(body?.error ?? response.statusText)
    return body as T
  }

  return {
    board: () => request<AgentBoardBoard>("/board"),
    initBeads: () => request<{ ok: true; stdout: string; stderr: string }>("/setup/init", { method: "POST" }),
    createIssue: (input: {
      title: string
      description?: string
      priority?: number
      labels?: string[]
      runImmediately?: boolean
    }) =>
      request<{ issue: BeadsIssue; run?: AgentBoardRun }>("/issues", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    startRun: (issueID: string) => request<AgentBoardRun>(`/cards/${encodeURIComponent(issueID)}/run`, { method: "POST" }),
    startReady: (input?: { limit?: number }) =>
      request<AgentBoardStartReadyResult>("/runs/start-ready", {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      }),
    moveCard: (issueID: string, column: AgentBoardColumnID) =>
      request<boolean>(`/cards/${encodeURIComponent(issueID)}/status`, {
        method: "POST",
        body: JSON.stringify({ column }),
      }),
    cancelRun: (runID: string) => request<AgentBoardRun>(`/runs/${encodeURIComponent(runID)}/cancel`, { method: "POST" }),
    requestChanges: (runID: string, message: string) =>
      request<AgentBoardRun>(`/runs/${encodeURIComponent(runID)}/request-changes`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    markDone: (runID: string) =>
      request<AgentBoardRun>(`/runs/${encodeURIComponent(runID)}/mark-done`, {
        method: "POST",
      }),
    refreshArtifacts: (runID: string) =>
      request<AgentBoardRunDetail>(`/runs/${encodeURIComponent(runID)}/artifacts/refresh`, {
        method: "POST",
      }),
    events: async (signal: AbortSignal, onEvent: (event: { type: string; data: unknown }) => void) => {
      const url = new URL("/agentboard/events", input.server.url)
      url.searchParams.set("directory", input.directory)
      const response = await fetch(url, {
        signal,
        headers: headers(input.server),
      })
      if (!response.ok || !response.body) throw new Error(response.statusText)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() ?? ""
        for (const chunk of chunks) {
          const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "message"
          const data = /^data: (.*)$/m.exec(chunk)?.[1]
          onEvent({ type, data: data ? JSON.parse(data) : undefined })
        }
      }
    },
  }
}
