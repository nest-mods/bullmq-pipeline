export type ResourceCleanup<T> = (
  resource: T,
) => unknown | Promise<unknown>;

export interface ResourceScope {
  open<T>(create: () => T, cleanup: ResourceCleanup<T>): T;
  reportError(error: unknown): void;
}

export async function withResourceScope<T>(
  action: (scope: ResourceScope) => T | Promise<T>,
): Promise<T> {
  const cleanups: Array<() => unknown | Promise<unknown>> = [];
  const secondaryErrors: unknown[] = [];
  const scope: ResourceScope = {
    open(create, cleanup) {
      const resource = create();
      cleanups.push(() => cleanup(resource));
      return resource;
    },
    reportError(error) {
      secondaryErrors.push(error);
    },
  };
  let result: T | undefined;
  let primaryError: unknown;
  let primaryFailed = false;

  try {
    result = await action(scope);
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
  }

  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      secondaryErrors.push(error);
    }
  }

  if (primaryFailed && secondaryErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...secondaryErrors],
      'Resource execution and cleanup both failed',
    );
  }
  if (primaryFailed) throw primaryError;
  if (secondaryErrors.length > 0) {
    throw new AggregateError(secondaryErrors, 'Resource cleanup failed');
  }
  return result as T;
}
