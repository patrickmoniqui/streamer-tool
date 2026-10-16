import { getTwitchConnectToken } from './twitchConnect';
import { getApiBaseUrl } from './config';
export const dancefloorApiUrl = (path: string) => `${getApiBaseUrl()}/dancefloor${path}`;
export class DancefloorRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function dancefloorRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = path.startsWith('/channels/') ? null : getTwitchConnectToken();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(dancefloorApiUrl(path), {
      method, credentials: 'omit', signal: controller.signal,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new DancefloorRequestError('Dancefloor could not reach its service. Check the Worker is running.', response.status);
    const result = await response.json();
    if (!response.ok) throw new DancefloorRequestError(result.error || 'Unable to reach Dancefloor.', response.status);
    return result as T;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}
