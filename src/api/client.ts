import { AuthenticationError, OutdatedRevisionError, StoveNotFoundError } from './errors.js';
import type { StoveControls, StoveStatus, StoveSummary } from './types.js';

const DEFAULT_BASE_URL = 'https://www.rika-firenet.com';
const SESSION_COOKIE_NAME = 'connect.sid';

/** Minimal logger surface so the client can be reused without Homebridge. */
export interface ClientLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface RikaFirenetClientOptions {
  email: string;
  password: string;
  baseUrl?: string;
  /** Injectable fetch implementation (defaults to global `fetch`); eases testing. */
  fetchImpl?: FetchLike;
  logger?: ClientLogger;
}

const noopLogger: ClientLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Thin, dependency-free client for the RIKA Firenet web API.
 *
 * Holds a single `connect.sid` session cookie in memory and transparently
 * re-authenticates when the session expires (HTTP 401). It performs no
 * polling of its own; scheduling is the {@link StovePoller}'s responsibility.
 */
export class RikaFirenetClient {
  private readonly email: string;
  private readonly password: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly log: ClientLogger;

  private sessionCookie: string | null = null;

  constructor(options: RikaFirenetClientOptions) {
    this.email = options.email;
    this.password = options.password;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.log = options.logger ?? noopLogger;
  }

  /** Whether a session cookie is currently held. */
  get isAuthenticated(): boolean {
    return this.sessionCookie !== null;
  }

  /**
   * Authenticates against `/web/login` and validates the session by listing
   * the available stoves. Throws {@link AuthenticationError} on bad credentials.
   */
  async login(): Promise<StoveSummary[]> {
    this.sessionCookie = null;
    const body = new URLSearchParams({
      email: this.email,
      password: this.password,
    });
    const res = await this.request('/web/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    this.captureCookie(res);

    if (!this.sessionCookie) {
      throw new AuthenticationError('No session cookie returned by RIKA Firenet login');
    }

    // The login endpoint returns the same 302 regardless of success, so the
    // session is validated by attempting to list stoves.
    return this.listStoves();
  }

  /** Lists the stoves available to the signed-in account (`GET /web/summary`). */
  async listStoves(): Promise<StoveSummary[]> {
    const res = await this.request('/web/summary', { method: 'GET' });
    this.captureCookie(res);

    if (this.isRedirectToLogin(res)) {
      this.sessionCookie = null;
      throw new AuthenticationError('RIKA Firenet session is not authenticated');
    }

    const html = await res.text();
    return parseStoveList(html);
  }

  /** Fetches the full status object for a stove (`GET /api/client/{id}/status`). */
  async getStatus(stoveId: string): Promise<StoveStatus> {
    return this.withAuthRetry(async () => {
      const res = await this.request(`/api/client/${stoveId}/status`, { method: 'GET' });
      this.captureCookie(res);

      if (res.status === 401) {
        throw new AuthenticationError();
      }
      if (res.status === 500) {
        throw new StoveNotFoundError(`Stove ${stoveId} is not registered for this account`);
      }
      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status} fetching stove ${stoveId} status`);
      }
      return (await res.json()) as StoveStatus;
    });
  }

  /**
   * Sends a complete controls object (`POST /api/client/{id}/controls`).
   * The RIKA API requires the *entire* controls payload including the current
   * `revision`. Throws {@link OutdatedRevisionError} when the revision is stale.
   */
  async setControls(stoveId: string, controls: StoveControls): Promise<void> {
    await this.withAuthRetry(async () => {
      const res = await this.request(`/api/client/${stoveId}/controls`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: serializeControls(controls),
      });
      this.captureCookie(res);

      if (res.status === 401) {
        throw new AuthenticationError();
      }

      const text = await res.text();
      if (res.status === 404 || /outdated/i.test(text)) {
        throw new OutdatedRevisionError(text.trim() || undefined);
      }
      if (!res.ok || !/OK/i.test(text)) {
        throw new Error(`Stove ${stoveId} controls update failed: ${res.status} ${text.trim()}`);
      }
    });
  }

  /** Ends the RIKA Firenet session (`GET /web/logout`). */
  async logout(): Promise<void> {
    if (!this.sessionCookie) {
      return;
    }
    try {
      await this.request('/web/logout', { method: 'GET' });
    } catch (err) {
      this.log.debug('Logout request failed (ignored)', err);
    } finally {
      this.sessionCookie = null;
    }
  }

  /**
   * Runs an operation, transparently re-authenticating once if it fails with
   * {@link AuthenticationError}.
   */
  private async withAuthRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      if (!this.sessionCookie) {
        await this.login();
      }
      return await operation();
    } catch (err) {
      if (err instanceof AuthenticationError) {
        this.log.debug('Session expired, re-authenticating');
        await this.login();
        return operation();
      }
      throw err;
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.sessionCookie) {
      headers.set('cookie', `${SESSION_COOKIE_NAME}=${this.sessionCookie}`);
    }
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      redirect: 'manual',
    });
  }

  private captureCookie(res: Response): void {
    const setCookies = readSetCookies(res);
    for (const cookie of setCookies) {
      const match = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
      if (match && match[1]) {
        this.sessionCookie = match[1];
      }
    }
  }

  private isRedirectToLogin(res: Response): boolean {
    if (res.status < 300 || res.status >= 400) {
      return false;
    }
    const location = res.headers.get('location') ?? '';
    return !location.includes('/web/summary');
  }
}

/** Reads `Set-Cookie` headers across runtimes that expose `getSetCookie()`. */
function readSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

/** Extracts `{ id, name }` pairs from the `/web/summary` stove list HTML. */
export function parseStoveList(html: string): StoveSummary[] {
  const stoves: StoveSummary[] = [];
  const regex = /href="\/web\/stove\/(\d+)"[^>]*>\s*([^<]+?)\s*</g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    const name = match[2];
    if (id && name) {
      stoves.push({ id, name: name.trim() });
    }
  }
  return stoves;
}

/** Serializes a controls object to `application/x-www-form-urlencoded`. */
export function serializeControls(controls: StoveControls): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(controls)) {
    if (value === undefined || value === null) {
      continue;
    }
    params.set(key, typeof value === 'boolean' ? String(value) : String(value));
  }
  return params;
}
