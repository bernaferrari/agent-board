import { EventEmitter } from "node:events"

export type AgentBoardEvent =
  | { type: "board.updated"; projectID: string }
  | { type: "run.updated"; projectID: string; runID: string; issueID: string }

export type AgentBoardEvents = ReturnType<typeof createAgentBoardEvents>

export function createAgentBoardEvents() {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  return {
    emit(event: AgentBoardEvent) {
      emitter.emit("event", event)
    },
    on(fn: (event: AgentBoardEvent) => void) {
      emitter.on("event", fn)
      return () => emitter.off("event", fn)
    },
  }
}
