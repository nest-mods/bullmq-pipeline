import assert from 'node:assert/strict';
import { runDashboardAcceptance } from './docker.ts';

const cleanupCommand = ['down', '--volumes', '--remove-orphans'];

Deno.test('dashboard runner executes browser acceptance before final cleanup', async () => {
  const commands: RecordedCommand[] = [];
  let disposals = 0;

  const result = await runDashboardAcceptance({
    compose: recordCommands(commands),
    subscribeTermination: () => ({
      signal: new Promise<never>(() => {}),
      dispose: () => disposals++,
    }),
  });

  assert.equal(result, 0);
  assert.deepEqual(
    commands.map(({ args }) => args),
    [
      ['up', '-d', 'redis', 'seed', 'bull-board', 'nginx'],
      ['run', '--rm', '--no-deps', 'bullmq-assertion'],
      ['run', '--rm', '--no-deps', 'acceptance'],
      ['run', '--rm', '--no-deps', 'browser-acceptance'],
      ['run', '--rm', '--no-deps', 'redis-assertion'],
      cleanupCommand,
    ],
  );
  assert.equal(disposals, 1);
});

Deno.test('dashboard runner preserves a primary failure after logs and cleanup', async () => {
  const commands: RecordedCommand[] = [];
  const primaryError = new Error('browser acceptance failed');
  const compose = recordCommands(commands, (args) => {
    if (args.at(-1) === 'browser-acceptance') throw primaryError;
  });

  await assert.rejects(
    () =>
      runDashboardAcceptance({
        compose,
        subscribeTermination: neverTerminates,
      }),
    (error) => error === primaryError,
  );

  const logCommand = commands.find(({ args }) => args[0] === 'logs');
  assert.ok(logCommand, 'failure must request Docker service logs');
  assert.equal(logCommand.requireSuccess, false);
  assert.deepEqual(commands.at(-1)?.args, cleanupCommand);
  assert.equal(
    commands.filter(({ args }) => args[0] === 'down').length,
    1,
    'cleanup must run exactly once',
  );
});

Deno.test('dashboard runner maps termination signals after one final cleanup', async () => {
  const cases = [
    { signal: 'SIGINT', status: 130 },
    { signal: 'SIGTERM', status: 143 },
  ] as const;

  for (const testCase of cases) {
    const commands: RecordedCommand[] = [];
    const termination = deferred<(typeof cases)[number]['signal']>();
    let disposals = 0;
    const compose = recordCommands(commands, (args) => {
      if (args[0] === 'up') return new Promise<never>(() => {});
    });

    const running = runDashboardAcceptance({
      compose,
      subscribeTermination: () => ({
        signal: termination.promise,
        dispose: () => disposals++,
      }),
    });
    termination.resolve(testCase.signal);

    assert.equal(await running, testCase.status);
    assert.deepEqual(commands.at(-1)?.args, cleanupCommand);
    assert.equal(
      commands.filter(({ args }) => args[0] === 'down').length,
      1,
      `${testCase.signal} must clean up exactly once`,
    );
    assert.equal(disposals, 1);
  }
});

interface RecordedCommand {
  args: string[];
  requireSuccess: boolean;
}

function recordCommands(
  commands: RecordedCommand[],
  beforeResult: (
    args: string[],
  ) => void | Promise<never> = () => {},
) {
  return async (args: string[], requireSuccess = true) => {
    commands.push({ args: [...args], requireSuccess });
    await beforeResult(args);
    return { code: 0, output: '' };
  };
}

function neverTerminates() {
  return {
    signal: new Promise<never>(() => {}),
    dispose() {},
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
