import type { AgentBoardColumnID } from "./types"

export function beadsStatusForColumn(column: AgentBoardColumnID) {
  if (column === "blocked") throw new Error("Blocked is dependency-derived and cannot be set directly.")
  if (column === "ready") return "open"
  if (column === "running") return "in_progress"
  if (column === "closed") return "closed"
  return undefined
}
