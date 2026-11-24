import type { AgentBoardBoard, AgentBoardCard } from "./api"
import type { DrawerTab } from "./detail-drawer"

const STORAGE_KEY = "agentboard.notify"
const NOTIFY_STATUSES = new Set(["needs_review", "failed", "done"])
const NOTIFY_TITLES: Record<string, string> = {
  needs_review: "Ready for review",
  failed: "Run failed",
  done: "Run finished",
}

export function createAgentBoardNotifications(onOpen: (issueID: string, tab: DrawerTab) => void) {
  const open = new Set<Notification>()
  let enabled = false
  let initialized = false
  let lastRunStatus = new Map<string, string>()

  function initialize() {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return
    try {
      enabled = localStorage.getItem(STORAGE_KEY) === "true"
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }

  function notify(card: AgentBoardCard) {
    const run = card.latestRun
    if (!run || typeof Notification === "undefined" || Notification.permission !== "granted") return
    try {
      const notification = new Notification(`${NOTIFY_TITLES[run.status] ?? "Run updated"} · ${card.issue.id}`, {
        body: run.status === "failed" && run.error ? run.error : card.issue.title,
        tag: `agentboard:${run.id}:${run.status}`,
        silent: false,
      })
      open.add(notification)
      notification.onclick = () => {
        window.focus()
        onOpen(card.issue.id, run.status === "failed" || run.status === "needs_review" ? "timeline" : "details")
        notification.close()
      }
      notification.onclose = () => open.delete(notification)
    } catch {
      // Notification construction may fail outside a secure context.
    }
  }

  function process(board: AgentBoardBoard) {
    const cards = board.columns.flatMap((column) => column.cards)
    const nextStatus = new Map(
      cards.flatMap((card) => (card.latestRun ? [[card.latestRun.id, card.latestRun.status] as const] : [])),
    )
    if (initialized && enabled) {
      for (const card of cards) {
        const run = card.latestRun
        if (!run || lastRunStatus.get(run.id) === run.status || !NOTIFY_STATUSES.has(run.status)) continue
        notify(card)
      }
    }
    lastRunStatus = nextStatus
    initialized = true
  }

  function dispose() {
    for (const notification of open) notification.close()
    open.clear()
  }

  return { initialize, process, dispose }
}
