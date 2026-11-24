import { showToast } from "@opencode/ui/toast"
import type { Accessor } from "solid-js"
import { useServer } from "@/runtime/server/current"
import { useTabs } from "@/shell/tabs/tabs"
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
}) {
  const server = useServer()
  const tabs = useTabs()

  function openPrompt(prompt: string) {
    void tabs.newDraft({ server: server.key, directory: input.directory() }, prompt)
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
      tabs.select(tabs.addSessionTab({ server: server.key, sessionId: sessionID }))
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
