import { describe, expect, it, vi } from 'vitest';

import {
  RikaFirenetClient,
  parseStoveList,
  serializeControls,
  type FetchLike,
} from '../../src/api/client.js';
import { AuthenticationError, OutdatedRevisionError } from '../../src/api/errors.js';
import { makeControls, makeStatus } from '../helpers/fixtures.js';

const SUMMARY_HTML = `
  <ul id="stoveList">
    <li><a href="/web/stove/68212916" data-ajax="false">Stove A</a></li>
    <li><a href="/web/stove/83265107" data-ajax="false">Stove B</a></li>
  </ul>
`;

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location });
  if (setCookie) {
    headers.append('set-cookie', setCookie);
  }
  return new Response(null, { status: 302, headers });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: FetchLike): RikaFirenetClient {
  return new RikaFirenetClient({ email: 'a@b.c', password: 'secret', fetchImpl });
}

describe('parseStoveList', () => {
  it('extracts id/name pairs from the summary HTML', () => {
    expect(parseStoveList(SUMMARY_HTML)).toEqual([
      { id: '68212916', name: 'Stove A' },
      { id: '83265107', name: 'Stove B' },
    ]);
  });

  it('returns an empty array when there are no stoves', () => {
    expect(parseStoveList('<div>nothing here</div>')).toEqual([]);
  });
});

describe('serializeControls', () => {
  it('encodes booleans and numbers as strings', () => {
    const params = serializeControls(makeControls({ onOff: true, heatingPower: 40, revision: 7 }));
    expect(params.get('onOff')).toBe('true');
    expect(params.get('heatingPower')).toBe('40');
    expect(params.get('revision')).toBe('7');
  });
});

describe('RikaFirenetClient.login', () => {
  it('authenticates and lists stoves on success', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/web/login')) {
        return redirect('/web/summary', 'connect.sid=abc123; Path=/; HttpOnly');
      }
      if (url.includes('/web/summary')) {
        return new Response(SUMMARY_HTML, { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    });

    const client = makeClient(fetchImpl);
    const stoves = await client.login();

    expect(stoves).toHaveLength(2);
    expect(client.isAuthenticated).toBe(true);
    // The cookie is sent on the summary request.
    const summaryCall = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/web/summary'));
    const headers = new Headers(summaryCall![1]!.headers);
    expect(headers.get('cookie')).toBe('connect.sid=abc123');
  });

  it('throws AuthenticationError when the session is rejected', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/web/login')) {
        return redirect('/web/summary', 'connect.sid=bad; Path=/');
      }
      // Summary redirects back to the login page => not authenticated.
      return redirect('/web/');
    });

    const client = makeClient(fetchImpl);
    await expect(client.login()).rejects.toBeInstanceOf(AuthenticationError);
    expect(client.isAuthenticated).toBe(false);
  });
});

describe('RikaFirenetClient.getStatus', () => {
  it('logs in automatically then returns the parsed status', async () => {
    const status = makeStatus();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/web/login')) {
        return redirect('/web/summary', 'connect.sid=sid1; Path=/');
      }
      if (url.includes('/web/summary')) {
        return new Response(SUMMARY_HTML, { status: 200 });
      }
      if (url.includes('/status')) {
        return json(status);
      }
      throw new Error(`unexpected ${url}`);
    });

    const client = makeClient(fetchImpl);
    const result = await client.getStatus('68212916');
    expect(result.stoveID).toBe(status.stoveID);
  });

  it('re-authenticates once on a 401 then retries', async () => {
    const status = makeStatus();
    let statusCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/web/login')) {
        return redirect('/web/summary', 'connect.sid=sid2; Path=/');
      }
      if (url.includes('/web/summary')) {
        return new Response(SUMMARY_HTML, { status: 200 });
      }
      if (url.includes('/status')) {
        statusCalls += 1;
        return statusCalls === 1 ? new Response('Authorisation required!', { status: 401 }) : json(status);
      }
      throw new Error(`unexpected ${url}`);
    });

    const client = makeClient(fetchImpl);
    const result = await client.getStatus('68212916');
    expect(result.stoveID).toBe(status.stoveID);
    expect(statusCalls).toBe(2);
  });
});

describe('RikaFirenetClient.setControls', () => {
  async function primedClient(controlsHandler: (url: string, init?: RequestInit) => Response) {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/web/login')) {
        return redirect('/web/summary', 'connect.sid=sid3; Path=/');
      }
      if (url.includes('/web/summary')) {
        return new Response(SUMMARY_HTML, { status: 200 });
      }
      if (url.includes('/controls')) {
        return controlsHandler(url, init);
      }
      throw new Error(`unexpected ${url}`);
    });
    const client = makeClient(fetchImpl);
    await client.login();
    return { client, fetchImpl };
  }

  it('posts the full controls payload and succeeds on OK', async () => {
    const { client, fetchImpl } = await primedClient(() => new Response('OK', { status: 200 }));
    await client.setControls('68212916', makeControls({ revision: 5 }));

    const call = fetchImpl.mock.calls.find((c) => String(c[0]).includes('/controls'));
    const body = call![1]!.body as URLSearchParams;
    expect(body.get('revision')).toBe('5');
    expect(new Headers(call![1]!.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
  });

  it('throws OutdatedRevisionError when the revision is stale', async () => {
    const { client } = await primedClient(
      () => new Response('Revision 1677289508 is outdated!', { status: 404 }),
    );
    await expect(client.setControls('68212916', makeControls())).rejects.toBeInstanceOf(
      OutdatedRevisionError,
    );
  });
});
