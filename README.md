# BullMQ Pipeline

Deno workspace for a future NestJS and BullMQ workflow orchestration library and
its Bull Board pipeline visualization extension.

## Status

The `@nest-mods/bullmq-pipeline` package remains scaffold-only and does not yet
provide a usable pipeline API. The Bull Board pipeline dashboard is implemented
and usable as a trusted Deno runtime extension.

## Repository layout

- `packages/pipeline`: scaffold for the future Node.js 24/NestJS npm library
  `@nest-mods/bullmq-pipeline`, including its npm consumer manifest, empty
  entrypoint, and test placeholder.
- `packages/dashboard`: implemented Deno runtime extension loaded by Bull Board
  through `mod.ts`. It reads pipeline snapshots from Redis and serves the run
  list, run details, dependency graph, and browser assets under `public/`.
- `packages/dashboard/test`: disposable Docker acceptance stack for the real
  Bull Board host integration.

The root `deno.json` owns workspace-wide tasks and registers both packages. Each
package owns its local Deno configuration, while the root `deno.lock` records
the workspace's resolved dependencies.

## Dependency management

Deno is the only dependency and task manager. `packages/pipeline/package.json`
remains the npm package manifest required by NestJS and Node consumers. Deno
reads the workspace manifests, creates `node_modules`, and locks resolved
dependencies in the root `deno.lock`.

Do not use npm, pnpm, or Yarn to install dependencies in this repository.

## Development

Requirement: Deno 2.9.3.

```sh
deno install --frozen
deno task check
deno task test:dashboard
```

`deno task check` verifies formatting, lint rules, the pipeline entrypoint, the
dashboard extension, and its acceptance sources. `deno task test:dashboard` runs
the real dashboard acceptance with Docker: Bull Board, disposable Redis, Nginx
proxying with authentication enabled, the mounted local extension, and a fixed
Puppeteer image running Chromium against the rendered dashboard.

## License

MIT
