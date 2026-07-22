# Repository Guide

## Project Overview

This repository is a Deno workspace for the future Node/NestJS npm library
`@nest-mods/bullmq-pipeline` and its companion Bull Board dashboard extension.

- `packages/pipeline` contains the future Node/NestJS npm library.
- `packages/dashboard` contains the Deno runtime extension. Its `mod.ts` file is
  the extension entrypoint, and `public/` contains browser assets.

## Toolchain And Commands

- Use Deno 2.9.3 as the only dependency and task manager. Node.js 24 is the
  consumer and build target for the pipeline package.
- Do not use npm, pnpm, or Yarn to install dependencies.
- Treat the root `deno.lock` as authoritative. Deno manages `node_modules`,
  which remains ignored.
- Run `deno install --frozen` and `deno task check` before committing. Run
  `deno task test:dashboard` for dashboard integration changes.
- Check the root `deno.json` for additional package or E2E tasks added later.

## Implementation Boundaries

- Keep changes scoped to the requested package and avoid unrelated refactors.
- Keep the dashboard as a Deno extension without a `package.json`. Implement
  against the extension contract in `bull-board-docker/extensions`, using the
  host-provided `context.redis`, `context.router`, `context.pages`, and
  `context.addLink` APIs.
- Resolve dashboard assets relative to `import.meta.url`. Do not fork or patch
  the Bull Board host to implement extension features.
- The pipeline package may keep `package.json` for npm consumers, but manage its
  dependencies and tasks through Deno. Do not replace the Node library build
  with an unproven Deno declaration bundle.

## Testing And Data Safety

- Verify dashboard integration behavior with `deno task test:dashboard`. It uses
  the real `diluka/bull-board:next` image plus disposable Docker Redis and Nginx
  with authentication enabled. Do not replace this critical E2E path with mocks.
- Never read from or write to production or formal data sources during
  development or tests.
- Redis writes in tests must target disposable Docker fixtures only.

## Formatting, Generated Files, And Documentation

- Follow the root Deno formatting and lint settings. Keep imports explicit and
  files focused.
- Do not commit `node_modules`, `dist`, coverage output, `.env` files,
  `.vscode`, `.superpowers`, or planning artifacts.
- Update package README files whenever public behavior or commands change.
