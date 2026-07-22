import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('./compose.yml', import.meta.url));
const cleanupArgs = ['down', '--volumes', '--remove-orphans'];

export interface CommandResult {
  code: number;
  output: string;
}

export interface TerminationSubscription {
  signal: Promise<'SIGINT' | 'SIGTERM'>;
  dispose(): void;
}

export interface DashboardAcceptanceDependencies {
  compose?: (
    args: string[],
    requireSuccess?: boolean,
  ) => Promise<CommandResult>;
  subscribeTermination?: () => TerminationSubscription;
}

export async function runDashboardAcceptance(
  {
    compose: executeCompose = compose,
    subscribeTermination = subscribeToTermination,
  }: DashboardAcceptanceDependencies = {},
): Promise<number> {
  const termination = subscribeTermination();
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => {
    cleanupPromise ??= Promise.resolve()
      .then(() => executeCompose(cleanupArgs))
      .then(() => undefined);
    return cleanupPromise;
  };
  const workflow = runAcceptanceWorkflow(executeCompose, cleanup);

  try {
    const outcome = await Promise.race([
      workflow.then(() => ({ kind: 'completed' }) as const),
      termination.signal.then((signal) =>
        ({ kind: 'terminated', signal }) as const
      ),
    ]);

    if (outcome.kind === 'completed') return 0;

    void workflow.catch(() => {});
    await cleanup();
    return outcome.signal === 'SIGINT' ? 130 : 143;
  } finally {
    termination.dispose();
  }
}

async function runAcceptanceWorkflow(
  executeCompose: NonNullable<DashboardAcceptanceDependencies['compose']>,
  cleanup: () => Promise<void>,
): Promise<void> {
  let primaryFailed = false;
  let primaryError: unknown;
  let cleanupFailed = false;
  let cleanupError: unknown;

  try {
    await executeCompose(['up', '-d', 'redis', 'seed', 'bull-board', 'nginx']);
    await executeCompose(['run', '--rm', '--no-deps', 'bullmq-assertion']);
    await executeCompose(['run', '--rm', '--no-deps', 'acceptance']);
    await executeCompose(['run', '--rm', '--no-deps', 'browser-acceptance']);
    await executeCompose(['run', '--rm', '--no-deps', 'redis-assertion']);
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    console.error('Dashboard acceptance failed; service logs follow.');
    try {
      await executeCompose(
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
      await cleanup();
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
}

function subscribeToTermination(): TerminationSubscription {
  let resolveSignal!: (signal: 'SIGINT' | 'SIGTERM') => void;
  const signal = new Promise<'SIGINT' | 'SIGTERM'>((resolve) => {
    resolveSignal = resolve;
  });
  const onInterrupt = () => resolveSignal('SIGINT');
  const onTerminate = () => resolveSignal('SIGTERM');

  Deno.addSignalListener('SIGINT', onInterrupt);
  if (Deno.build.os !== 'windows') {
    Deno.addSignalListener('SIGTERM', onTerminate);
  }

  return {
    signal,
    dispose() {
      Deno.removeSignalListener('SIGINT', onInterrupt);
      if (Deno.build.os !== 'windows') {
        Deno.removeSignalListener('SIGTERM', onTerminate);
      }
    },
  };
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

if (import.meta.main) {
  Deno.exit(await runDashboardAcceptance());
}
