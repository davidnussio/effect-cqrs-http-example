/**
 * The todo aggregate over HTTP, as in
 * https://davidnussio.github.io/effect-cqrs/guides/integration/#http
 *
 * `PORT` is 3000 by default, and events go to the SQLite file `SQLITE_FILE`,
 * `todos.sqlite` by default.
 */
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Config, Effect, Layer } from "effect"
import { AggregateService, CommandApi, SqliteEventStore } from "effect-cqrs"
import { HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiScalar, OpenApi } from "effect/http-api"
import { createServer } from "node:http"
import { Todo, TodoAlreadyCreated, TodoAlreadyDeleted, TodoNotFound, TodoState } from "./todo.ts"

const TodoApi = CommandApi.group(Todo, {
  state: TodoState, // a schema of the state, for GET /todo/:aggregateId
  errors: [TodoAlreadyCreated, TodoNotFound, TodoAlreadyDeleted]
})

class Api extends HttpApi.make("api")
  .add(TodoApi)
  .annotateMerge(OpenApi.annotations({ title: "Todo API", version: "1.0.0" }))
{}

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(CommandApi.layer(Api, "todo", AggregateService.make(Todo)))
  ),
  HttpApiScalar.layer(Api, { path: "/docs" })
)

const HttpLive = Layer.unwrap(Effect.gen(function*() {
  const port = yield* Config.Port("PORT").pipe(Config.withDefault(3000))
  yield* Effect.logInfo(`Documentation at http://localhost:${port}/docs`)
  return HttpRouter.serve(Routes).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
}))

const Storage = Layer.unwrap(Effect.gen(function*() {
  const filename = yield* Config.String("SQLITE_FILE").pipe(Config.withDefault("todos.sqlite"))
  yield* Effect.logInfo(`Storing events in ${filename}`)
  return SqliteEventStore.layer().pipe(Layer.provide(SqliteClient.layer({ filename })))
}))

const Main = HttpLive.pipe(Layer.provide(Storage))

Layer.launch(Main).pipe(NodeRuntime.runMain)
