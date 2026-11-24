import type { Database } from "@opencode/core/database/database"
import type { Session } from "@opencode/core/session"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { realpath, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { ServerAuth } from "../auth"
import { authorizedRequest, unauthorizedResponse } from "../middleware/authorization"
import { createAgentBoardEvents } from "./events"
import { createAgentBoardReconciler } from "./reconcile"
import { AgentBoardRoutes } from "./routes"
import { createAgentBoardRuns } from "./runs"
import { createAgentBoardStore } from "./store"

export function agentBoardLayer(database: Database.Interface, sessions: Session.Interface, auth: ServerAuth.Info) {
  return HttpRouter.use((router) =>
    Effect.gen(function* () {
      const stop = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => stop.abort()))
      const store = createAgentBoardStore(database.db)
      const events = createAgentBoardEvents()
      const runs = createAgentBoardRuns(store, events, sessions, stop.signal)
      const reconciler = createAgentBoardReconciler(store, events, sessions, runs.pending)

      yield* router.add("*", "/api/agentboard/*", (request) =>
        Effect.gen(function* () {
          if (ServerAuth.required(auth) && !(yield* authorizedRequest(request, auth))) {
            return unauthorizedResponse(request)
          }

          const url = new URL(request.url, "http://localhost")
          const directory = url.searchParams.get("location[directory]")
          if (!directory || !isAbsolute(directory)) {
            return HttpServerResponse.jsonUnsafe({ error: "Choose an absolute project directory." }, { status: 400 })
          }

          const worktree = yield* Effect.promise(() =>
            realpath(directory)
              .then(async (path) => ((await stat(path)).isDirectory() ? path : undefined))
              .catch(() => undefined),
          )
          if (!worktree) {
            return HttpServerResponse.jsonUnsafe({ error: "Project directory not found." }, { status: 404 })
          }

          const webRequest = yield* HttpServerRequest.toWeb(request)
          const app = AgentBoardRoutes({ worktree, store, events, runs, reconciler })
          const response = yield* Effect.promise(() => Promise.resolve(app.fetch(webRequest)))
          return HttpServerResponse.fromWeb(response)
        }).pipe(
          Effect.catchCause((cause) => {
            const error = Cause.squash(cause)
            return Effect.succeed(
              HttpServerResponse.jsonUnsafe(
                { error: error instanceof Error ? error.message : String(error) },
                { status: 500 },
              ),
            )
          }),
        ),
      )
    }),
  )
}
