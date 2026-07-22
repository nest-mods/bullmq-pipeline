# Pipeline Dashboard Extension

Deno runtime extension package for visualizing `@nest-mods/bullmq-pipeline`
executions in Bull Board. This baseline only provides a loader-valid no-op
entrypoint; it does not provide a usable dashboard.

Bull Board loads this trusted in-process extension through a pinned HTTPS URL
ending in `packages/dashboard/mod.ts`, or through a local directory that
resolves to `mod.ts`.

The extension has no `package.json`. `packages/dashboard/deno.json` owns its
local Deno configuration, while the repository root owns workspace tasks and the
shared `deno.lock`.
