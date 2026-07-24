# Pipeline Dashboard Extension

Deno runtime extension for visualizing `@nest-mods/bullmq-pipeline` executions
inside Bull Board. It provides a paged recent-run list, folded Stage graph,
status-filtered Node pages, and links back to BullMQ jobs in the host board.

## Runtime And Dependencies

Bull Board loads this as a trusted, in-process Deno runtime extension. The
entrypoint imports its public extension type from
`bull-board-docker/extensions`. The dashboard intentionally has no
`package.json`; `packages/dashboard/deno.json` pins its imports, and the shared
root `deno.lock` records their resolved versions.

## Loading The Extension

`BULL_BOARD_EXTENSIONS` is a JSON array of extension specifiers. A local
directory resolves to its `mod.ts`, so a container can mount
`packages/dashboard` at `/extensions/pipeline-dashboard` and load it with:

```sh
BULL_BOARD_EXTENSIONS='["/extensions/pipeline-dashboard"]'
```

The optional `prefix` is the Pipeline runtime namespace used to construct every
dashboard Redis key. It defaults to `pipeline` and follows the runtime's prefix
format: start with a letter or number, then use letters, numbers, dots,
underscores, or hyphens.

```sh
BULL_BOARD_EXTENSIONS='[{"specifier":"/extensions/pipeline-dashboard","options":{"prefix":"example"}}]'
```

For HTTPS loading, point directly to `mod.ts` and replace `<commit-sha>` with an
immutable full commit SHA:

```sh
BULL_BOARD_EXTENSIONS='["https://raw.githubusercontent.com/nest-mods/bullmq-pipeline/<commit-sha>/packages/dashboard/mod.ts"]'
```

## Routes And Host Integration

- The extension page is `/ext/pipeline-dashboard/` relative to the Bull Board
  host. Run details use `/ext/pipeline-dashboard/?runId=<encoded-id>`.
- `GET /api/pipelines?page=1&pageSize=25` returns a bounded Run page. Page size
  defaults to 25 and is capped at 100.
- `GET /api/pipelines/:runId` returns Run metadata and folded Stage summaries.
- `GET /api/pipelines/:runId/stages/:stageId/nodes?status=FAILED&page=1&pageSize=25`
  returns one status-specific Node page.
- BullMQ job links resolve from the host board root as
  `/queue/{queueName}/{jobId}`, with both path segments encoded.
- Authentication is inherited from the Bull Board host. Page, API, asset, and
  job URLs also retain a configured Bull Board proxy path.
- Run data refreshes only when the page opens or the user selects **Refresh**.
  Refresh reloads the current list or run page from its initial position.
- Every Stage remains folded at every Node count. Stage summaries and Node rows
  use distinct pending, running, retrying, completed, and failed treatments.
- The graph draws one edge for each real parent Stage relationship. Individual
  Node relationships remain available in Redis but are not drawn on the first
  screen.

## Redis Data Contract

The dashboard reads these keys:

- `pipeline:runs`: sorted-set index of run IDs.
- `pipeline:run:{runId}`: run summary hash.
- `pipeline:run:{runId}:node:{nodeId}`: node snapshot hash.
- `pipeline:run:{runId}:stages`: sorted-set index of Stage IDs.
- `pipeline:run:{runId}:stage:{stageId}`: Stage metadata hash.
- `pipeline:run:{runId}:stage:{stageId}:parents`: parent Stage set.
- `pipeline:run:{runId}:stage:{stageId}:counts`: Node status counts.
- `pipeline:run:{runId}:stage:{stageId}:nodes:{status}`: status-specific Node
  index.

These are the default keys. When `prefix` is set to `example`, the same keys
start with `example:`, such as `example:runs` and `example:run:{runId}`. Run
hashes use `pipelineName` as their Pipeline identity. Node hashes use `stepName`
for the Step identity and `stageId` for Stage membership.

The list API reads only the requested range plus one entry from the Run index.
Run details read Stage summaries without scanning the Run Node index. A Node
request reads only the selected Stage, status, and page. The extension is a
read-only consumer: missing snapshots are skipped, while the Pipeline runtime
owns index retention and expired Run cleanup.

## Acceptance Test

From the repository root, run:

```sh
deno task test:dashboard
```

This first runs focused resource-lifecycle and Docker-runner tests, then the
real disposable Docker acceptance path. It starts `diluka/bull-board:next`,
Redis, and Nginx with authentication enabled, mounts the local extension, and
creates real BullMQ jobs covering completion, retry-then-completion, and
exhausted retries. Fixtures exercise 100, 500, 1000, and 5000 Node Runs while
the first screen remains bounded to Stage summaries. A fixed
`ghcr.io/puppeteer/puppeteer:24.16.0` image runs Chromium through login, manual
refresh, Stage/Node navigation, Job navigation, responsive media modes, and
session expiry. The suite removes its disposable fixtures afterward.
