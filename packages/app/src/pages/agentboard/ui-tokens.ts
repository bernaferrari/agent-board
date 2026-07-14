import type { IconProps } from "@opencode-ai/ui/icon"
import type { AgentBoardCard, AgentBoardColumnID } from "./api"

export const PRIORITY_OPTIONS = [
  {
    value: 0,
    label: "P0",
    tone: "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45",
  },
  {
    value: 1,
    label: "P1",
    tone: "bg-[#bc4c00]/14 text-[color-mix(in_oklch,#bc4c00_62%,var(--text-strong))] ring-[#f0883e]/45",
  },
  {
    value: 2,
    label: "P2",
    tone: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
  },
  {
    value: 3,
    label: "P3",
    tone: "bg-[#656d76]/12 text-[color-mix(in_oklch,#57606a_62%,var(--text-strong))] ring-[#8c959f]/40",
  },
] as const

export type ColumnAccent = {
  dot: string
  text: string
  tint: string
  pill: string
  ring: string
  glow: string
  drop: string
}

export const COLUMN_ACCENT: Record<AgentBoardColumnID, ColumnAccent> = {
  blocked: {
    dot: "bg-[#f85149]",
    text: "text-[#cf222e]",
    tint: "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))]",
    pill: "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45",
    ring: "ring-[#f85149]/35",
    glow: "shadow-xs-border-critical-base",
    drop: "bg-[#da3633]/10 ring-[#f85149]/30",
  },
  open: {
    dot: "bg-[#3fb950]",
    text: "text-[#1a7f37]",
    tint: "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))]",
    pill: "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45",
    ring: "ring-[#3fb950]/35",
    glow: "shadow-xs-border-base",
    drop: "bg-[#238636]/10 ring-[#3fb950]/30",
  },
  in_progress: {
    dot: "bg-[#d29922]",
    text: "text-[#9a6700]",
    tint: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))]",
    pill: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
    ring: "ring-[#d29922]/45",
    glow: "shadow-xs-border-base",
    drop: "bg-[#9e6a03]/10 ring-[#d29922]/30",
  },
  needs_review: {
    dot: "bg-[#58a6ff]",
    text: "text-[#0969da]",
    tint: "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))]",
    pill: "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45",
    ring: "ring-[#58a6ff]/35",
    glow: "shadow-xs-border-base",
    drop: "bg-[#58a6ff]/10 ring-[#58a6ff]/30",
  },
  closed: {
    dot: "bg-[#8957e5]",
    text: "text-[#8250df]",
    tint: "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))]",
    pill: "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))] ring-[#a371f7]/45",
    ring: "ring-[#a371f7]/45",
    glow: "shadow-xs-border-base",
    drop: "bg-[#8957e5]/10 ring-[#a371f7]/30",
  },
}

export const COLUMN_ICON: Record<AgentBoardColumnID, IconProps["name"]> = {
  blocked: "circle-ban-sign",
  open: "circle-check",
  in_progress: "brain",
  needs_review: "review",
  closed: "archive",
}

export function priorityTone(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  if (!Number.isFinite(value)) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  return (
    PRIORITY_OPTIONS.find((option) => option.value === value)?.tone ??
    "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  )
}

export function priorityClass(priority: number | string | undefined, closed?: boolean) {
  return closed
    ? `${priorityTone(priority)} opacity-60 line-through decoration-current decoration-1`
    : priorityTone(priority)
}

export function closedBadgeClass(closed?: boolean) {
  return closed ? "opacity-60 line-through decoration-current decoration-1" : ""
}

export function issueIDTone() {
  return "rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-10-semibold text-text-weak ring-1 ring-inset ring-border-weaker-base"
}

export function statusTone(status?: string) {
  const value = status?.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
  if (!value) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  if (value === "failed" || value === "cancelled") {
    return "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45"
  }
  if (value === "blocked") {
    return "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45"
  }
  if (value === "needs_review" || value === "review") {
    return "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45"
  }
  if (value === "running" || value === "in_progress") {
    return "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45"
  }
  if (value === "queued") return "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45"
  if (value === "ready" || value === "open") {
    return "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45"
  }
  if (value === "done" || value === "closed") {
    return "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))] ring-[#a371f7]/45"
  }
  return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
}

export function statusLabel(status?: string, options?: { capitalize?: boolean }) {
  const raw = (status ?? "open").replaceAll("_", " ")
  const value = raw.toLowerCase() === "running" ? "in progress" : raw
  if (!options?.capitalize) return value
  if (value.toLowerCase() === "in progress") return "In Progress"
  if (value.toLowerCase() === "needs review") return "Needs Review"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function visibleStatus(card: AgentBoardCard) {
  const run = card.latestRun
  if (run && run.status !== "cancelled") return run.status
  if (card.column === "blocked") return "blocked"
  if (card.issue.status) return card.issue.status
  if (card.column === "open") return "open"
  if (card.column === "in_progress") return "in_progress"
  if (card.column === "closed") return "closed"
  return card.column
}

export function cardSummary(card: AgentBoardCard) {
  if (card.column === "closed") return ""
  const desc = card.issue.description?.trim()
  if (!desc) return ""
  return desc.length > 140 ? `${desc.slice(0, 137)}…` : desc
}
