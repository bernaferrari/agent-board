import { AgentBoardRoutes } from "@/agentboard/routes"
import { Effect, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Hono } from "hono"

const app = new Hono().route("/agentboard", AgentBoardRoutes())

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
  return HttpServerResponse.stream(Stream.fromReadableStream(() => response.body!, (error) => error), {
    status: response.status,
    headers: response.headers,
  })
}

export const agentBoardRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    yield* router.add(
      "*",
      "/agentboard/*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const response = yield* Effect.promise(() => app.fetch(honoRequest(request)))
        return honoResponse(response)
      }),
    )
  }),
)
