export type AgentBoardRunStatus = "queued" | "running" | "needs_review" | "done" | "cancelled" | "failed"

export type AgentBoardColumnID = "blocked" | "open" | "in_progress" | "needs_review" | "closed"

export type BeadsIssue = {
  id: string
  title: string
  status?: string
  priority?: number | string
  description?: string
  blocked?: boolean
  raw: Record<string, unknown>
}

export type AgentBoardDependency = {
  fromIssueID: string
  toIssueID: string
  type: string
}

export type AgentBoardGraphPosition = {
  issueID: string
  x: number
  y: number
  pinned: boolean
}

export type AgentBoardProject = {
  id: string
  worktree: string
  bdDbPath?: string
  enabled: boolean
  time: {
    created: number
    updated: number
  }
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

export type AgentBoardArtifactKind = "session" | "diff" | "todo" | "log" | "pr"

export type AgentBoardArtifact = {
  id: string
  runID: string
  kind: AgentBoardArtifactKind
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

export type AgentBoardColumn = {
  id: AgentBoardColumnID
  title: string
  cards: AgentBoardCard[]
}

export type AgentBoardBoard = {
  project: AgentBoardProject
  generatedAt: number
  columns: AgentBoardColumn[]
  graph: {
    dependencies: AgentBoardDependency[]
    positions: AgentBoardGraphPosition[]
  }
}
