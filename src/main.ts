/**
 * The todo aggregate over HTTP, as in
 * https://davidnussio.github.io/effect-cqrs/guides/integration/#http
 *
 * Commands and the state of one todo come from `CommandApi`. `GET /todos` reads the
 * list from a view model, and waits for the position in a `Read-After` header, the
 * `Event-Position` a command answered with, so a client reads what it just wrote.
 *
 * `PORT` is 3000 by default, and events go to the SQLite file `SQLITE_FILE`,
 * `todos.sqlite` by default.
 */
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Config, Effect, Layer, Schema } from "effect"
import { AggregateService, Checkpoints, CommandApi, SqliteEventStore, ViewModel } from "effect-cqrs"
import { HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiScalar, OpenApi } from "effect/http-api"
import { createServer } from "node:http"
import { Todo, TodoAlreadyCreated, TodoAlreadyDeleted, TodoNotFound, TodoState } from "./todo.ts"
import { listTodos, TodoItem, TodoList, TodoListStore } from "./todo-list.ts"

const TodoApi = CommandApi.group(Todo, {
  state: TodoState, // a schema of the state, for GET /todo/:aggregateId
  errors: [TodoAlreadyCreated, TodoNotFound, TodoAlreadyDeleted]
})

// A request with `Read-After: <position>` waits until the list has that position.
const TodoListApi = HttpApiGroup.make("todoList")
  .add(
    HttpApiEndpoint.get("list", "/todos", { success: Schema.Array(TodoItem) })
      .annotate(OpenApi.Summary, "Lists the todos that are not deleted")
  )
  .middleware(CommandApi.ReadAfter)

class Api extends HttpApi.make("api")
  .add(TodoApi)
  .add(TodoListApi)
  .annotateMerge(OpenApi.annotations({ title: "Todo API", version: "1.0.0" }))
{}

const TodoListHandlers = HttpApiBuilder.group(Api, "todoList", (handlers) =>
  Effect.gen(function*() {
    const store = yield* TodoListStore
    return handlers.handle("list", () => listTodos(store))
  }))

const Routes = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide([CommandApi.layer(Api, "todo", AggregateService.make(Todo)), TodoListHandlers]),
    // The list's handlers need the middleware, which waits for the view models.
    Layer.provide(CommandApi.layerReadAfter())
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

// The list lives in memory, so its checkpoint does too: it is rebuilt from the events
// on every start.
const ReadSide = ViewModel.layer([TodoList]).pipe(
  Layer.provideMerge(Layer.mergeAll(Storage, Checkpoints.layerMemory, TodoListStore.layer))
)

const Main = HttpLive.pipe(Layer.provide(ReadSide))

Layer.launch(Main).pipe(NodeRuntime.runMain)
