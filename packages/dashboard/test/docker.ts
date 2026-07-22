import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('./compose.yml', import.meta.url));

let primaryFailed = false;
let primaryError: unknown;
let cleanupFailed = false;
let cleanupError: unknown;

try {
  await compose(['up', '-d', 'redis', 'seed', 'bull-board', 'nginx']);
  await compose(['run', '--rm', '--no-deps', 'bullmq-assertion']);
  await compose(['run', '--rm', '--no-deps', 'acceptance']);
  await compose(['run', '--rm', '--no-deps', 'browser-acceptance']);
  await compose(['run', '--rm', '--no-deps', 'redis-assertion']);
} catch (error) {
  primaryFailed = true;
  primaryError = error;
  console.error('Dashboard acceptance failed; service logs follow.');
  try {
    await compose(
      [
        'logs',
        '--no-color',
        'redis',
        'seed',
        'bull-board',
        'nginx',
        'bullmq-assertion',
        'browser-acceptance',
        'redis-assertion',
      ],
      false,
    );
  } catch (logError) {
    console.error('Unable to collect Docker service logs.', logError);
  }
} finally {
  try {
    await compose(['down', '--volumes', '--remove-orphans']);
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }
}

if (primaryFailed && cleanupFailed) {
  throw new AggregateError(
    [primaryError, cleanupError],
    'Dashboard acceptance and Docker cleanup both failed',
  );
}
if (primaryFailed) throw primaryError;
if (cleanupFailed) throw cleanupError;

interface CommandResult {
  code: number;
  output: string;
}

async function compose(
  args: string[],
  requireSuccess = true,
): Promise<CommandResult> {
  console.log(`docker compose ${args.join(' ')}`);
  const result = await new Deno.Command('docker', {
    args: ['compose', '-f', composeFile, ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (stdout) console.log(stdout.trimEnd());
  if (stderr) console.error(stderr.trimEnd());
  const output = `${stdout}\n${stderr}`;
  if (requireSuccess && !result.success) {
    throw new Error(
      `docker compose ${args.join(' ')} exited with code ${result.code}`,
    );
  }
  return { code: result.code, output };
}
