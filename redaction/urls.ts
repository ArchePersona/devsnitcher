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
        modified = true;
      } else {
        query[name] = value;
      }
    }

    const redactedHash = redactFragment(url.hash);
    const fragmentModified = redactedHash !== url.hash;

    let out: string;
    if (modified || fragmentModified) {
      if (modified) {
        const qs = Array.from(params.entries())
          .map(([name, value]) => {
            const safeValue = SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())
              ? REDACTED
              : encodeURIComponent(value);
            return `${encodeURIComponent(name)}=${safeValue}`;
          })
          .join('&');
        out = url.origin + url.pathname + (qs ? '?' + qs : '') + redactedHash;
      } else {
        // Only the fragment changed: keep the untouched query string.
        out = url.origin + url.pathname + (url.search || '') + redactedHash;
      }
    } else {
      out = input;
    }
    return { url: out, query };
  } catch {
    return { url: input, query: {} };
  }
}

/**
 * Redacts sensitive parameter-style values inside a URL fragment (hash) while
 * leaving non-parameter anchors untouched. Uses the same sensitive-name policy
 * as the query-string redaction. Only fragments that look like `name=value`
 * pairs (contain `=` or `&`) are treated as parameters; a bare anchor such as
 * `#section-name` is preserved unchanged.
 */
function redactFragment(hash: string): string {
  if (!hash) return hash;
  let body = hash.slice(1);
  const hadQueryPrefix = body.startsWith('?');
  if (hadQueryPrefix) body = body.slice(1);
  if (!body) return hash;
  if (!body.includes('=') && !body.includes('&')) return hash;

  const params = new URLSearchParams(body);
  let modified = false;
  for (const name of params.keys()) {
    if (SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
      modified = true;
      break;
    }
  }
  if (!modified) return hash;

  const rebuilt = Array.from(params.entries())
    .map(([name, value]) => {
      const safeValue = SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())
        ? REDACTED
        : value;
      return `${name}=${safeValue}`;
    })
    .join('&');

  return '#' + (hadQueryPrefix ? '?' : '') + rebuilt;
}

export function redactUrlsInText(text: string): string {
  if (!text) return text;
  const urlRe = /(https?:\/\/[^\s"'<>]+)/g;
  return text.replace(urlRe, (m) => redactUrl(m).url);
}
