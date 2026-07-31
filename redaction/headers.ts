const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
  'api-key',
]);

const REDACTED = '[REDACTED]';

export function redactHeaderValue(name: string, _value: string): string {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? REDACTED : _value;
}

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = redactHeaderValue(name, value);
  }
  return out;
}
