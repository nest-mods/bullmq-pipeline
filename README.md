# BullMQ Pipeline

NestJS and BullMQ workflow orchestration framework with a companion Bull Board
pipeline visualization extension.

## Status

This repository currently contains initialization scaffolding only. It does not
provide a usable pipeline API or dashboard yet.

## Repository layout

- `packages/pipeline`: future Node.js library published as
  `@nest-mods/bullmq-pipeline`.
- `packages/pipeline/src`: pipeline library source.
- `packages/pipeline/test`: future unit and Redis-backed integration tests.
- `packages/dashboard`: Deno runtime extension loaded by Bull Board through its
  `mod.ts` entrypoint.
- `packages/dashboard/public`: future browser assets for the dashboard.

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
```

The check task verifies formatting, lint rules, the pipeline entrypoint, and the
dashboard extension. No upstream feature implementation is included in this
scaffold.

## License

MIT
