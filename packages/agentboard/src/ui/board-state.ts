import type { AgentBoardBoard } from "../types"
export function allCards(board: AgentBoardBoard) {
  return board.columns.flatMap((column) => column.cards)
}
