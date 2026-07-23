export interface PipelineDashboardOptions {
  prefix: string;
}

export function parsePipelineDashboardOptions(
  value: unknown,
): PipelineDashboardOptions {
  if (value === undefined) return { prefix: 'pipeline' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Pipeline dashboard options must be an object');
  }

  if (!('prefix' in value)) return { prefix: 'pipeline' };
  if (typeof value.prefix !== 'string') {
    throw new TypeError(
      'Pipeline dashboard option "prefix" must be a string',
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.prefix)) {
    throw new TypeError(
      'Pipeline dashboard option "prefix" must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens',
    );
  }
  return { prefix: value.prefix };
}
