import { EventEmitter } from "node:events"

export type AgentBoardEvent =
  | { type: "board.updated"; projectID: string }
  | { type: "run.updated"; projectID: string; runID: string; issueID: string }

const emitter = new EventEmitter()

export const AgentBoardEvents = {
  emit(event: AgentBoardEvent) {
    emitter.emit("event", event)
  },
  on(fn: (event: AgentBoardEvent) => void) {
    emitter.on("event", fn)
    return () => emitter.off("event", fn)
  },
}
