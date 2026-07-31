const REDACTED = '[REDACTED]';

const COOKIE_KV_RE =
  /(?:^|[;&]\s*)([a-z0-9_-]+)=([^;]+)/gi;

const SENSITIVE_COOKIE_NAMES = new Set([
  'session',
  'sessionid',
  'sid',
  'jsessionid',
  'asp.net_sessionid',
  'phpsessid',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authtoken',
  'auth',
  'csrf',
  'xsrf',
  'jwt',
]);

export function redactCookieString(cookie: string): string {
  if (!cookie) return cookie;
  return cookie.replace(COOKIE_KV_RE, (_match, name: string, _value: string) => {
    if (SENSITIVE_COOKIE_NAMES.has(name.toLowerCase())) {
      return `${name}=${REDACTED}`;
    }
    return _match;
  });
}
