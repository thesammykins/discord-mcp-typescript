import { readFile } from 'node:fs/promises';
import { Miniflare, Response as WorkerResponse } from 'miniflare';
import { describe, expect, it } from 'vitest';
import { env, fixtureFetch, message, owner, parent, rpc } from './fixtures.js';

async function dispatch(mf: Miniflare, request: Request) {
  return mf.dispatchFetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.text(),
  });
}

describe('actual workerd runtime, no nodejs_compat', () => {
  it('executes bundled discovery, owner gates, scoped reads and mock reply writes', async () => {
    let outbound = 0;
    let writes = 0;
    const paths: string[] = [];
    const source = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
    const mf = new Miniflare({
      modules: true,
      script: source,
      compatibilityDate: '2026-07-28',
      bindings: { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' },
      outboundService: async (request) => {
        outbound++;
        paths.push(`${request.method} ${new URL(request.url).pathname}`);
        expect(new URL(request.url).origin).toBe('https://discord.com');
        const body = ['POST', 'PATCH'].includes(request.method) ? await request.text() : undefined;
        if (request.method === 'POST') {
          writes++;
          expect(JSON.parse(body!)).toMatchObject({
            allowed_mentions: { parse: [], replied_user: false },
            message_reference: {
              channel_id: parent,
              message_id: message,
              fail_if_not_exists: true,
            },
          });
        }
        const response = await fixtureFetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          ...(body === undefined ? {} : { body }),
        });
        return new WorkerResponse(response.status === 204 ? null : await response.arrayBuffer(), {
          status: response.status,
          headers: Object.fromEntries(response.headers),
        });
      },
    });
    try {
      const discovered = (await (
        await mf.dispatchFetch('https://gateway.example/mcp', {
          method: 'POST',
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
      ).json()) as { result: { tools: { name: string }[] } };
      expect(discovered.result.tools).toHaveLength(15);
      expect(outbound).toBe(0);
      const rejected = (await (
        await dispatch(mf, rpc('discord_messages_read', { channel_id: parent }, 'other'))
      ).json()) as { result: { structuredContent: { code: string } } };
      expect(rejected.result.structuredContent.code).toBe('OWNER_IDENTITY_REJECTED');
      expect(outbound).toBe(0);
      const read = (await (
        await dispatch(mf, rpc('discord_messages_read', { channel_id: parent, limit: 1 }))
      ).json()) as {
        result: { isError: boolean; structuredContent: { messages: { author_id: string }[] } };
      };
      expect(read.result.isError, JSON.stringify({ result: read.result, paths })).toBe(false);
      expect(read.result.structuredContent.messages[0]!.author_id).toBe(owner);
      const send = (await (
        await dispatch(
          mf,
          rpc('discord_messages_send', {
            channel_id: parent,
            content: 'synthetic',
            reply_to_message_id: message,
            __approve: true,
          }),
        )
      ).json()) as { result: { isError: boolean } };
      expect(send.result.isError).toBe(false);
      expect(writes).toBe(1);
    } finally {
      await mf.dispose();
    }
  });
  it('starts without credentials and keeps the connector disabled in a native Worker', async () => {
    const source = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
    const mf = new Miniflare({
      modules: true,
      script: source,
      compatibilityDate: '2026-07-28',
      outboundService: () => {
        throw new Error('No external request permitted');
      },
    });
    try {
      const status = await (await mf.dispatchFetch('https://gateway.example/healthz')).json();
      expect(status).toMatchObject({ discord_enabled: false, owner_bound: false });
      const call = (await (
        await dispatch(mf, rpc('discord_channels_get', { channel_id: parent }))
      ).json()) as { result: { structuredContent: { code: string } } };
      expect(call.result.structuredContent.code).toBe('CONNECTOR_DISABLED');
    } finally {
      await mf.dispose();
    }
  });
});
