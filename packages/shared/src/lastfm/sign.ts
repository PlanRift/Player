import { md5 } from '../auth';

/**
 * Signs Last.fm API parameters according to the Last.fm authentication spec.
 *
 * Sorts all parameters alphabetically by parameter name (excluding 'format' and 'callback'),
 * concatenates them in key-value format without delimiters, appends the shared secret,
 * and returns the MD5 hex digest.
 */
export function sign(params: Record<string, string | number | undefined | null>, secret: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback' && params[k] !== undefined && params[k] !== null)
    .sort();

  let toSign = '';
  for (const k of keys) {
    toSign += `${k}${params[k]}`;
  }
  toSign += secret;

  return md5(toSign);
}
