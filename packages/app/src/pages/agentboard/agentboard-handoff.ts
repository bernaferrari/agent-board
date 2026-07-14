import { base64Encode } from "@opencode-ai/core/util/encode"
import { showToast } from "@opencode-ai/ui/toast"
import type { Accessor } from "solid-js"
import { setSessionHandoff } from "@/pages/session/handoff"
import type { AgentBoardBoard, BeadsIssue } from "./api"
import { findCard } from "./board-state"
import type { ComposerDraft } from "./issue-composer"
import {
  agentBoardIssueChatPrompt,
  agentBoardPlanningPrompt,
  agentBoardSetupPrompt,
  agentBoardSuggestionPrompt,
} from "./prompts"

export function createAgentBoardHandoff(input: {
  directory: Accessor<string>
  board: Accessor<AgentBoardBoard | undefined>
  navigate: (path: string) => void
}) {
  function openPrompt(prompt: string) {
    const slug = base64Encode(input.directory())
    setSessionHandoff(slug, { prompt })
    input.navigate(`/${slug}/session?prompt=${encodeURIComponent(prompt)}`)
  }

  function openIssue(issueID: string, fallbackIssue?: BeadsIssue) {
    const card = findCard(input.board(), issueID)
    const issue = card?.issue ?? fallbackIssue
    if (!issue) {
      showToast({
        variant: "error",
        title: "Could not open chat",
        description: "Refresh the board and try again.",
      })
      return
    }
    openPrompt(agentBoardIssueChatPrompt({ issue, column: card?.column }))
  }

  return {
    openSession: (sessionID: string) => {
      input.navigate(`/${base64Encode(input.directory())}/session/${sessionID}`)
    },
    plan: (draft: ComposerDraft) => {
      openPrompt(agentBoardPlanningPrompt(draft))
    },
    suggest: () => {
      openPrompt(agentBoardSuggestionPrompt(input.board()))
    },
    setup: () => {
      openPrompt(agentBoardSetupPrompt())
    },
    openIssue,
  }
}
