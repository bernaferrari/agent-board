import type { AgentBoardColumnID } from "./types"

export function beadsStatusForColumn(column: AgentBoardColumnID) {
  if (column === "blocked") throw new Error("Blocked is dependency-derived and cannot be set directly.")
  if (column === "open") return "open"
  if (column === "in_progress") return "in_progress"
  if (column === "needs_review") return "in_progress"
  if (column === "closed") return "closed"
  return undefined
}
