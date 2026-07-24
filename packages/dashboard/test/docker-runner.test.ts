import assert from 'node:assert/strict';
import { runDashboardAcceptance } from './docker.ts';

const cleanupCommand = ['down', '--volumes', '--remove-orphans'];

Deno.test('dashboard runner executes browser acceptance before final cleanup', async () => {
  const commands: RecordedCommand[] = [];

  await runDashboardAcceptance({ compose: recordCommands(commands) });

  assert.deepEqual(
    commands.map(({ args }) => args),
    [
      ['up', '-d', 'redis', 'seed', 'bull-board', 'nginx'],
      ['run', '--rm', '--no-deps', 'bullmq-assertion'],
      ['run', '--rm', '--no-deps', 'acceptance'],
      ['run', '--rm', '--no-deps', 'browser-acceptance'],
      cleanupCommand,
    ],
  );
});

Deno.test('dashboard runner preserves a primary failure after logs and cleanup', async () => {
  const commands: RecordedCommand[] = [];
  const primaryError = new Error('browser acceptance failed');
  const compose = recordCommands(commands, (args) => {
    if (args.at(-1) === 'browser-acceptance') throw primaryError;
  });

  await assert.rejects(
    () => runDashboardAcceptance({ compose }),
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

interface RecordedCommand {
  args: string[];
  requireSuccess: boolean;
}

function recordCommands(
  commands: RecordedCommand[],
  beforeResult: (args: string[]) => void = () => {},
) {
  return async (args: string[], requireSuccess = true) => {
    commands.push({ args: [...args], requireSuccess });
    beforeResult(args);
    await Promise.resolve();
    return { code: 0, output: '' };
  };
}
