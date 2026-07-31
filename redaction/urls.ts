export interface RedactedUrl {
  url: string;
  query: Record<string, string>;
}

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'api_key',
  'apikey',
  'api-key',
  'key',
  'secret',
  'password',
  'pwd',
  'auth',
  'authorization',
  'code',
  'session',
  'sessionid',
  'sid',
  'jwt',
  'id_token',
  'private_key',
]);

const REDACTED = '[REDACTED]';

export function redactUrl(input: string): RedactedUrl {
  if (!input) return { url: input, query: {} };
  try {
    const url = new URL(input);
    const query: Record<string, string> = {};
    const params = new URLSearchParams(url.search);
    let modified = false;
    for (const [name, value] of params.entries()) {
      if (SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
        query[name] = REDACTED;
        params.set(name, REDACTED);
        modified = true;
      } else {
        query[name] = value;
      }
    }
    const out = modified ? url.origin + url.pathname + '?' + params.toString() + url.hash : input;
    return { url: out, query };
  } catch {
    return { url: input, query: {} };
  }
}

export function redactUrlsInText(text: string): string {
  if (!text) return text;
  const urlRe = /(https?:\/\/[^\s"'<>]+)/g;
  return text.replace(urlRe, (m) => redactUrl(m).url);
}
