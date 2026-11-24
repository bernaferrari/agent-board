import type { Session } from "@opencode/core/session"
import type { FileDiff } from "@opencode/schema/file-diff"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import type { AgentBoardStore } from "./store"
import type { AgentBoardArtifact, AgentBoardRun } from "./types"

function latestAssistantText(messages: ReadonlyArray<SessionMessage.Info>) {
  const latest = messages.find(
    (message) => message.type === "assistant" && message.content.some((part) => part.type === "text"),
  )
  if (latest?.type !== "assistant") return
  return latest.content
    .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
    .join("\n\n")
}

function summarizeDiffs(diffs: ReadonlyArray<FileDiff.Info>) {
  return {
    files: diffs.map((diff) => ({
      file: diff.file,
      status: diff.status,
      additions: diff.additions,
      deletions: diff.deletions,
    })),
    totals: {
      files: diffs.length,
      additions: diffs.reduce((total, diff) => total + diff.additions, 0),
      deletions: diffs.reduce((total, diff) => total + diff.deletions, 0),
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

function reviewBrief(response: string | undefined, diffs: ReadonlyArray<FileDiff.Info>) {
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

export function collectRunArtifacts(run: AgentBoardRun, store: AgentBoardStore, session: Session.Interface) {
  if (!run.opencodeSessionID) return Effect.void
  const sessionID = run.opencodeSessionID

  const existing = store.listArtifacts(run.id)
  if (
    !existing.some(
      (artifact: AgentBoardArtifact) =>
        artifact.kind === "session" && artifact.data && typeof artifact.data === "object",
    )
  ) {
    store.addArtifact({
      runID: run.id,
      kind: "session",
      title: "OpenCode session",
      url: `/session/${run.opencodeSessionID}`,
      data: {
        sessionID: run.opencodeSessionID,
      },
    })
  }

  store.deleteArtifacts(run.id, ["diff", "log", "todo"])

  return Effect.gen(function* () {
    let diffs: ReadonlyArray<FileDiff.Info> = []

    const diffExit = yield* Effect.exit(session.diff({ sessionID }))
    if (diffExit._tag === "Success") {
      diffs = diffExit.value
      const summary = summarizeDiffs(diffs)
      store.addArtifact({
        runID: run.id,
        kind: "diff",
        title: `${summary.totals.files} changed ${summary.totals.files === 1 ? "file" : "files"}`,
        data: { diffs, summary },
      })
    } else {
      store.addArtifact({
        runID: run.id,
        kind: "log",
        title: "Diff unavailable",
        data: { error: String(diffExit.cause) },
      })
    }

    const messagesExit = yield* Effect.exit(session.messages({ sessionID, limit: 20, order: "desc" }))
    if (messagesExit._tag === "Success") {
      const messages = messagesExit.value
      const response = latestAssistantText(messages)
      store.addArtifact({
        runID: run.id,
        kind: "log",
        title: `${messages.length} recent session messages`,
        data: { messages },
      })
      if (response) {
        store.addArtifact({
          runID: run.id,
          kind: "log",
          title: "Agent response",
          data: { text: response },
        })
      }
      store.addArtifact({
        runID: run.id,
        kind: "todo",
        title: "Review brief",
        data: reviewBrief(response, diffs),
      })
    } else {
      store.addArtifact({
        runID: run.id,
        kind: "log",
        title: "Session log unavailable",
        data: { error: String(messagesExit.cause) },
      })
    }
  })
}
