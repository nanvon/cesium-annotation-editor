export function cloneProperties<T extends Record<string, unknown> | undefined>(properties: T): T {
  if (!properties) {
    return undefined as T;
  }
  return cloneJsonLike(properties) as T;
}

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJsonLike);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      output[key] = cloneJsonLike(nestedValue);
    }
    return output;
  }

  return value;
}
