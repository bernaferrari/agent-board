import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import type { AgentBoardBoard } from "./api"
import { findCard } from "./board-state"

export function createAgentBoardDrawerState(
  board: Accessor<AgentBoardBoard | undefined>,
  selectedID: Accessor<string | undefined>,
) {
  const [cardID, setCardID] = createSignal<string>()
  const [open, setOpen] = createSignal(false)
  let closeTimer: number | undefined
  let openFrame: number | undefined

  const card = createMemo(() => {
    const id = cardID()
    if (!id) return undefined
    return findCard(board(), id)
  })

  createEffect(() => {
    const id = selectedID()
    if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    if (openFrame !== undefined) window.cancelAnimationFrame(openFrame)
    closeTimer = undefined
    openFrame = undefined
    if (id) {
      setCardID(id)
      openFrame = window.requestAnimationFrame(() => {
        openFrame = undefined
        setOpen(true)
      })
      return
    }
    setOpen(false)
    closeTimer = window.setTimeout(() => {
      setCardID(undefined)
      closeTimer = undefined
    }, 260)
  })

  onCleanup(() => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer)
    if (openFrame !== undefined) window.cancelAnimationFrame(openFrame)
  })

  return { card, open }
}
