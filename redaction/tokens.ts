const REDACTED = '[REDACTED]';

const BEARER_RE = /(bearer\s+)([A-Za-z0-9._~+/=-]+)/gi;
const BASIC_AUTH_RE = /(basic\s+)([A-Za-z0-9._~+/=-]+)(:?==?)/gi;

const KEY_NAMES = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'api_key',
  'apikey',
  'api-key',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'authtoken',
  'auth_token',
  'client_secret',
  'clientsecret',
  'private_key',
  'privatekey',
  'session_token',
  'sessiontoken',
].join('|');

const KEY_VALUE_RE = new RegExp(
  `(["']?(?:${KEY_NAMES})["']?\\s*[:=]\\s*)(["']?)[^"'}\\s,]+(\\2)`,
  'gi',
);

export function redactTokens(text: string): string {
  if (!text) return text;
  let out = text.replace(BEARER_RE, `$1${REDACTED}`);
  out = out.replace(BASIC_AUTH_RE, `$1${REDACTED}$3`);
  out = out.replace(KEY_VALUE_RE, `$1$2${REDACTED}$3`);
  return out;
}
