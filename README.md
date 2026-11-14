# effect-cqrs HTTP example

The [HTTP example](https://davidnussio.github.io/effect-cqrs/guides/integration/#http) of
the [effect-cqrs](https://github.com/davidnussio/effect-cqrs) integration guide, as a
server that runs: a todo aggregate behind `CommandApi`, with events in a SQLite file, a
list of todos that reads its own writes, and OpenAPI documentation.

```bash
pnpm install
pnpm start
```

It needs Node.js 24 or later, which runs the TypeScript sources as they are. The
documentation is then at http://localhost:3000/docs.

- `src/todo.ts`: the aggregate, its events, errors and state
- `src/todo-list.ts`: the list of todos, a view model kept in memory
- `src/main.ts`: the API, the server and the storage

## Try it

```bash
curl -X POST localhost:3000/todo/t1/createTodo -H 'content-type: application/json' -d '{"title":"Buy milk"}'
curl -X POST localhost:3000/todo/t1/completeTodo
curl localhost:3000/todo/t1
curl 'localhost:3000/todo/t1/history?payload=true'
```

| Request | Answer |
| --- | --- |
| `createTodo` on `t1` again | `422` with `TodoAlreadyCreated` |
| `createTodo` with `{"title":""}` | `400` with `InvalidCommand` |
| `completeTodo` on an unknown id | `404` with `TodoNotFound`, which sets `httpApiStatus` |
| A command with `If-Match: 1` once the todo is at version 2 | `409` with `WrongExpectedVersion` |
| The same command twice with one `Idempotency-Key` | The first result, both times |

## Read your own writes

`GET /todo/t1` folds the todo's events, so it always shows the last command. `GET /todos`
reads a view model, which runs a moment behind. Every command answers with the position of
its last event in an `Event-Position` header. Send it back as `Read-After`, and the list
waits until it includes that command:

```bash
curl -i -X POST localhost:3000/todo/t2/createTodo -H 'content-type: application/json' -d '{"title":"Call Bob"}'
# event-position: 3
curl localhost:3000/todos -H 'read-after: 3'
```

| Request | Answer |
| --- | --- |
| `GET /todos` without `Read-After` | The list at once, as far as it has got |
| `Read-After` the list doesn't reach in 5 seconds | `503` with `NotCaughtUp` |
| `Read-After: abc` | `400` |

The list and its checkpoint live in memory, so the list is rebuilt from the events on
every start.

## Configuration

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `SQLITE_FILE` | `todos.sqlite` |

## The effect-cqrs version

The example uses effect-cqrs 0.4.0 from npm. `pnpm-workspace.yaml` exempts effect-cqrs from
pnpm's `minimumReleaseAge`, so a new release can be installed the day it comes out:

```bash
pnpm add effect-cqrs@latest
```
