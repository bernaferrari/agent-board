import { AgentBoardRoutes } from "@/agentboard/routes"
import { InstanceRef } from "@/effect/instance-ref"
import { Effect, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"

function honoRequest(request: HttpServerRequest.HttpServerRequest) {
  if (request.source instanceof Request) return request.source
  return new Request(new URL(request.url, "http://localhost"), {
    method: request.method,
    headers: request.headers,
  })
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
        const app = AgentBoardRoutes({ worktree: instance.worktree })
        const response = yield* Effect.tryPromise(() => Promise.resolve(app.fetch(honoRequest(request))))
        return honoResponse(response)
      }),
    )
  }),
)
