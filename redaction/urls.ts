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

    // Decode query params solely to build the informational `query` map and to
    // learn which sensitive names are present. The URL itself is redacted
    // directly on the encoded component, never via this decoded reconstruction.
    const query: Record<string, string> = {};
    for (const [name, value] of new URLSearchParams(url.search).entries()) {
      if (SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
        query[name] = REDACTED;
      } else {
        query[name] = value;
      }
    }

    // Redact only sensitive values in place, preserving every non-sensitive
    // segment byte-for-byte (encoding, order, separators, duplicates).
    const redactedSearch = redactComponent(url.search);
    const searchModified = redactedSearch !== url.search;

    // `url.hash` starts with `#`; `redactComponent` handles the inner body and
    // any optional leading `?` (the `#?...` prefix form). A URL with no fragment
    // must not gain a spurious trailing `#`.
    const hashBody = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const redactedHashBody = redactComponent(hashBody);
    const hashModified = redactedHashBody !== hashBody;
    const redactedHash = '#' + redactedHashBody;

    let out: string;
    if (!searchModified && !hashModified) {
      out = input;
    } else {
      out =
        url.origin +
        url.pathname +
        (searchModified ? redactedSearch : url.search) +
        (hashModified ? redactedHash : url.hash);
    }
    return { url: out, query };
  } catch {
    return { url: input, query: {} };
  }
}

/**
 * Redacts sensitive `name=value` segments inside an already-encoded query or
 * fragment body (with no leading `?`/`#`), rewriting ONLY the value of segments
 * whose decoded name matches the sensitive-name policy. Every non-sensitive
 * segment is preserved byte-for-byte: original percent-encoding, duplicate
 * names, ordering and separators are untouched, and no unrelated syntax is
 * re-encoded or normalized. A leading `?` prefix (used by `#?...` fragments) is
 * kept. Segments without an `=` (e.g. a bare anchor such as `#section-name`)
 * carry no value and are left unchanged.
 */
function redactComponent(raw: string): string {
  if (!raw) return raw;
  let prefix = '';
  let body = raw;
  if (body.startsWith('?')) {
    prefix = '?';
    body = body.slice(1);
  }

  let modified = false;
  const parts = body.split('&').map((segment) => {
    const eq = segment.indexOf('=');
    if (eq === -1) return segment; // no value to redact
    const nameRaw = segment.slice(0, eq);
    let name = nameRaw;
    try {
      name = decodeURIComponent(nameRaw);
    } catch {
      // Malformed encoding: fall back to the raw bytes for the sensitivity check.
    }
    if (!SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) return segment;
    modified = true;
    return nameRaw + '=' + REDACTED;
  });

  if (!modified) return raw;
  return prefix + parts.join('&');
}

export function redactUrlsInText(text: string): string {
  if (!text) return text;
  const urlRe = /(https?:\/\/[^\s"'<>]+)/g;
  return text.replace(urlRe, (m) => redactUrl(m).url);
}
