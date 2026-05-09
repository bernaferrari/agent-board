import { AppRuntime } from "@/effect/app-runtime"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { AgentBoardStore } from "./store"
import type { AgentBoardArtifact, AgentBoardRun } from "./types"

type SnapshotDiff = {
  file?: string
  path?: string
  name?: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
}

type SessionMessageLike = {
  info: { role: string; time?: { created?: number } }
  parts?: unknown[]
}

type TextPartLike = {
  type: string
  text: string
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function isAssistantMessage(value: unknown): value is SessionMessageLike {
  const message = objectRecord(value)
  const info = objectRecord(message?.info)
  return info?.role === "assistant"
}

function isTextPart(value: unknown): value is TextPartLike {
  const part = objectRecord(value)
  return part?.type === "text" && typeof part.text === "string"
}

function latestAssistantText(messages: unknown[]) {
  const assistantMessages = messages
    .filter(isAssistantMessage)
    .sort((a, b) => (a.info.time?.created ?? 0) - (b.info.time?.created ?? 0))

  const latest = assistantMessages.at(-1)
  if (!latest) return
  const text = (latest.parts ?? [])
    .filter(isTextPart)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

function diffFile(diff: SnapshotDiff) {
  return diff.file ?? diff.path ?? diff.name ?? "changed file"
}

function summarizeDiffs(diffs: SnapshotDiff[]) {
  const additions = diffs.reduce((total, diff) => total + (typeof diff.additions === "number" ? diff.additions : 0), 0)
  const deletions = diffs.reduce((total, diff) => total + (typeof diff.deletions === "number" ? diff.deletions : 0), 0)
  return {
    files: diffs.map((diff) => ({
      file: diffFile(diff),
      status: diff.status ?? "modified",
      additions: diff.additions ?? 0,
      deletions: diff.deletions ?? 0,
    })),
    totals: {
      files: diffs.length,
      additions,
      deletions,
    },
  }
}

function extractSection(text: string, label: string) {
  const pattern = new RegExp(
    `(?:^|\\n)#{0,3}\\s*${label.replaceAll(" ", "\\s+")}\\s*:?[\\t ]*\\n([\\s\\S]*?)(?=\\n#{0,3}\\s*(?:Summary|Changed files|Tests|Risks or blockers|Review notes)\\s*:?[\\t ]*\\n|$)`,
    "i",
  )
  return pattern.exec(text)?.[1]?.trim()
}

function sectionItems(value?: string) {
  if (!value) return []
  return value
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean)
}

function reviewBrief(response: string | undefined, diffs: SnapshotDiff[]) {
  const diffSummary = summarizeDiffs(diffs)
  const summary = response ? extractSection(response, "Summary") : undefined
  const tests = response ? sectionItems(extractSection(response, "Tests")) : []
  const risks = response ? sectionItems(extractSection(response, "Risks or blockers")) : []
  const notes = response ? sectionItems(extractSection(response, "Review notes")) : []
  const items = [
    diffSummary.totals.files > 0
      ? `Review ${diffSummary.totals.files} changed ${diffSummary.totals.files === 1 ? "file" : "files"}`
      : "Confirm there are no code changes to review",
    tests.length > 0 ? "Check the reported test results" : "Ask for tests or run the relevant checks",
    risks.length > 0 ? "Resolve listed risks before marking done" : "Confirm behavior in the app before closing",
  ]
  return {
    summary,
    items,
    tests,
    risks,
    notes,
    files: diffSummary.files,
    totals: diffSummary.totals,
  }
}

export async function collectRunArtifacts(run: AgentBoardRun) {
  if (!run.opencodeSessionID) return
  const sessionID = run.opencodeSessionID as SessionID

  const existing = AgentBoardStore.listArtifacts(run.id)
  if (
    !existing.some(
      (artifact: AgentBoardArtifact) => artifact.kind === "session" && artifact.data && typeof artifact.data === "object",
    )
  ) {
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "session",
      title: "OpenCode session",
      url: `/session/${run.opencodeSessionID}`,
      data: {
        sessionID: run.opencodeSessionID,
      },
    })
  }

  AgentBoardStore.deleteArtifacts(run.id, ["diff", "log", "todo"])

  let diffs: SnapshotDiff[] = []

  try {
    diffs = await AppRuntime.runPromise(Session.Service.use((session) => session.diff(sessionID)))
    const summary = summarizeDiffs(diffs)
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "diff",
      title: `${summary.totals.files} changed ${summary.totals.files === 1 ? "file" : "files"}`,
      data: { diffs, summary },
    })
  } catch (error) {
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "log",
      title: "Diff unavailable",
      data: { error: error instanceof Error ? error.message : String(error) },
    })
  }

  try {
    const messages = await AppRuntime.runPromise(
      Session.Service.use((session) => session.messages({ sessionID, limit: 20 })),
    )
    const response = latestAssistantText(messages)
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "log",
      title: `${messages.length} recent session messages`,
      data: { messages },
    })
    if (response) {
      AgentBoardStore.addArtifact({
        runID: run.id,
        kind: "log",
        title: "Agent response",
        data: { text: response },
      })
    }
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "todo",
      title: "Review brief",
      data: reviewBrief(response, diffs),
    })
  } catch (error) {
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "log",
      title: "Session log unavailable",
      data: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}
