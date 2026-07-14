import { AgentBoardRoutes } from "@/agentboard/routes"
import { InstanceStore } from "@/project/instance-store"
import { Cause, Effect, Option, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Hono } from "hono"

function agentBoardApp(worktree: string) {
  // Mount once at /agentboard — client always calls /agentboard/...
  return new Hono().route("/agentboard", AgentBoardRoutes({ worktree: worktree }))
}

function honoRequest(request: HttpServerRequest.HttpServerRequest) {
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Stream.toReadableStream(request.stream)
    init.duplex = "half"
  }
  // Prefer originalUrl so query string is preserved (same as session handlers).
  const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.originalUrl, "http://localhost"))
  return new Request(url, init)
}

function honoResponse(response: Response) {
  if (!response.body) {
    return HttpServerResponse.empty({
      status: response.status,
      headers: response.headers,
    })
  }
  return HttpServerResponse.stream(
    Stream.fromReadableStream({
      evaluate: () => response.body!,
      onError: (error) => error,
    }),
    {
      status: response.status,
      headers: response.headers,
    },
  )
}

function decodeDirectory(input: string) {
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

/** Same directory resolution as WorkspaceRoutingMiddleware. */
function requestDirectory(request: HttpServerRequest.HttpServerRequest, params: Record<string, string | ReadonlyArray<string>>) {
  const fromParams = params.directory
  const directory = typeof fromParams === "string" ? fromParams : Array.isArray(fromParams) ? fromParams[0] : undefined
  if (directory) return directory
  const header = request.headers["x-opencode-directory"]
  if (header) return header
  const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.originalUrl, "http://localhost"))
  return url.searchParams.get("directory") || process.cwd()
}

export const agentBoardRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    // Capture store when the route layer builds (same pattern as uiRoute + FSUtil).
    const store = yield* InstanceStore.Service

    yield* router.add(
      "*",
      "/agentboard/*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const params = yield* HttpServerRequest.ParsedSearchParams
        const directory = decodeDirectory(requestDirectory(request, params))
        // Same load path as InstanceContextMiddleware.
        const instance = yield* store.load({ directory })
        const app = agentBoardApp(instance.worktree)
        const response = yield* Effect.promise(() => Promise.resolve(app.fetch(honoRequest(request))))
        return honoResponse(response)
      }).pipe(
        Effect.catchCause((cause) => {
          const defect = Cause.squash(cause)
          const message = defect instanceof Error ? defect.message : String(defect)
          return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status: 500 }))
        }),
      ),
    )
  }),
)
