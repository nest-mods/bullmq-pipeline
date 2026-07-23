export interface PipelineDashboardOptions {
  keyPrefix: string;
}

export function parsePipelineDashboardOptions(
  value: unknown,
): PipelineDashboardOptions {
  if (value === undefined) return { keyPrefix: '' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Pipeline dashboard options must be an object');
  }

  if (!('keyPrefix' in value)) return { keyPrefix: '' };
  if (typeof value.keyPrefix !== 'string') {
    throw new TypeError(
      'Pipeline dashboard option "keyPrefix" must be a string',
    );
  }
  return { keyPrefix: value.keyPrefix };
}
