import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const runnerPath = `${testDirectory}/docker.ts`;

Deno.test('dashboard runner executes the real browser acceptance service', async () => {
  const temporaryDirectory = await Deno.makeTempDir();
  const dockerLog = `${temporaryDirectory}/docker.log`;
  const fakeDocker = `${temporaryDirectory}/docker`;

  try {
    await Deno.writeTextFile(
      fakeDocker,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$DASHBOARD_DOCKER_LOG"\n',
      { mode: 0o755 },
    );

    const result = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', runnerPath],
      env: {
        DASHBOARD_DOCKER_LOG: dockerLog,
        PATH: `${temporaryDirectory}:${Deno.env.get('PATH') ?? ''}`,
      },
      stdout: 'piped',
      stderr: 'piped',
    }).output();

    assert.equal(
      result.success,
      true,
      new TextDecoder().decode(result.stderr),
    );
    const commands = (await Deno.readTextFile(dockerLog)).trim().split('\n');
    assert.ok(
      commands.some((command) =>
        command.endsWith('run --rm --no-deps browser-acceptance')
      ),
      `expected browser-acceptance invocation, received:\n${
        commands.join('\n')
      }`,
    );
    assert.match(
      commands.at(-1) ?? '',
      /down --volumes --remove-orphans$/,
      'Docker cleanup must remain the final runner command',
    );
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
});
