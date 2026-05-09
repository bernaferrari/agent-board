import { AgentBoardRoutes } from "@/agentboard/routes"
import { InstanceRef } from "@/effect/instance-ref"
import { Effect, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Hono } from "hono"

function agentBoardApp(worktree: string) {
  const routes = AgentBoardRoutes({ worktree })
  return new Hono().route("/", routes).route("/agentboard", routes)
}

function honoRequest(request: HttpServerRequest.HttpServerRequest) {
  if (request.source instanceof Request) return request.source
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Stream.toReadableStream(request.stream)
    init.duplex = "half"
  }
  return new Request(new URL(request.url, "http://localhost"), init)
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

export const agentBoardRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add(
      "*",
      "/agentboard/*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const instance = yield* InstanceRef
        if (!instance) return HttpServerResponse.text("No AgentBoard instance context", { status: 500 })
        const app = agentBoardApp(instance.worktree)
        const response = yield* Effect.tryPromise(() => Promise.resolve(app.fetch(honoRequest(request))))
        return honoResponse(response)
      }),
    )
  }),
)
