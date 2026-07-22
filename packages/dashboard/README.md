# Pipeline Dashboard Extension

Deno runtime extension for visualizing `@nest-mods/bullmq-pipeline` executions
inside Bull Board. It provides a recent-run list, query-based run details, a
dependency graph grouped by pipeline and step, and links back to BullMQ jobs in
the host board.

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

For HTTPS loading, point directly to `mod.ts` and replace `<commit-sha>` with an
immutable full commit SHA:

```sh
BULL_BOARD_EXTENSIONS='["https://raw.githubusercontent.com/nest-mods/bullmq-pipeline/<commit-sha>/packages/dashboard/mod.ts"]'
```

## Routes And Host Integration

- The extension page is `/ext/pipeline-dashboard/` relative to the Bull Board
  host. Run details use `/ext/pipeline-dashboard/?runId=<encoded-id>`.
- The extension-relative APIs are `GET /api/pipelines` and
  `GET /api/pipelines/:runId` under that mount.
- BullMQ job links resolve from the host board root as
  `/queue/{queueName}/{jobId}`, with both path segments encoded.
- Authentication is inherited from the Bull Board host. Page, API, asset, and
  job URLs also retain a configured Bull Board proxy path.

## Redis Data And Cleanup

The dashboard reads these keys:

- `pietra:pipeline:runs`: sorted-set index of run IDs.
- `pietra:pipeline:run:{runId}`: run summary hash.
- `pietra:pipeline:run:{runId}:nodes`: sorted-set index of node IDs.
- `pietra:pipeline:run:{runId}:node:{nodeId}`: node snapshot hash.

The list API reads the complete run sorted-set index in descending score order,
filters stale entries, and then returns at most 100 runs by default. It does not
modify run or node hash snapshots. A list read does use `ZREM` on
`pietra:pipeline:runs` to remove IDs whose run hash is missing and finished
`COMPLETED` or `FAILED` runs whose `expiresAt` has passed. Expired runs in any
non-finished status remain in the index.

## Acceptance Test

From the repository root, run:

```sh
deno task test:dashboard
```

This first runs focused resource-lifecycle and Docker-runner tests, then the
real disposable Docker acceptance path. It starts `diluka/bull-board:next`,
Redis, and Nginx with authentication enabled, mounts the local extension, and
creates real BullMQ jobs covering completion, retry-then-completion, and
exhausted retries. A fixed `ghcr.io/puppeteer/puppeteer:24.16.0` image
automatically runs Chromium through login, polling, detail/job navigation,
responsive media modes, and session expiry. The suite also verifies proxied
APIs, job states, Redis cleanup without snapshot deletion, and removes the
Docker fixtures afterward.
