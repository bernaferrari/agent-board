import { z } from "zod"

export const Status = z.enum(["open", "in_progress", "needs_review", "closed"])
export type AgentBoardColumnID = z.infer<typeof Status>
export const IssueType = z.enum(["task", "bug", "feature", "epic", "chore", "decision"])
export const Issue = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    status: z.string().optional(),
    description: z.string().optional(),
    priority: z.union([z.number(), z.string()]).optional(),
    labels: z.array(z.string()).optional(),
    blocked: z.boolean().optional(),
  })
  .passthrough()
export type BeadsIssue = z.infer<typeof Issue> & {
  raw: Record<string, unknown>
}
export type AgentBoardDependency = {
  fromIssueID: string
  toIssueID: string
  type: string
}
export type AgentBoardCard = { issue: BeadsIssue; column: AgentBoardColumnID }
export type Project = { id: string; name: string; directory: string }
export type ProjectSuggestion = { name: string; directory: string }
export type Position = { issueID: string; x: number; y: number }
export type AgentBoardBoard = {
  project: Project
  generatedAt: number
  columns: { id: AgentBoardColumnID; title: string; cards: AgentBoardCard[] }[]
  graph: { dependencies: AgentBoardDependency[]; positions: Position[] }
}
export type Snapshot = {
  projects: Project[]
  suggestions: ProjectSuggestion[]
  board: AgentBoardBoard | null
  problem?: string
}
export const COLUMN_TITLES = {
  open: "Open",
  in_progress: "In Progress",
  needs_review: "Needs Review",
  closed: "Closed",
}
export const REVIEW_LABEL = "agentboard:review"
