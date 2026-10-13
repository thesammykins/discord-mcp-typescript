import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { server as discordMock } from '@discord-mcp/server-mocks';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { HttpResponse, http, passthrough } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHttp } from './http.js';

vi.mock('@discordjs/rest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@discordjs/rest')>();
  return {
    ...actual,
    REST: class extends actual.REST {
      constructor(options: ConstructorParameters<typeof actual.REST>[0]) {
        super({
          ...options,
          makeRequest: fetch as unknown as NonNullable<
            import('@discordjs/rest').RESTOptions['makeRequest']
          >,
        });
      }
    },
  };
});
const env = { ...process.env };
const guild = '111122223333444455',
  parent = '222233334444555566',
  owner = '444455556666777788',
  bot = '555566667777888899',
  message = '777788889999000111';
let server: Server | undefined;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let writes = 0;
function url(path = '/mcp') {
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}${path}`;
}
async function token(
  scope = 'discord.read',
  sub = 'subject-owner',
  aud = 'https://discord.example/mcp',
  expiry = '5m',
) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://issuer.example')
    .setSubject(sub)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(keys.privateKey);
}
beforeEach(async () => {
  writes = 0;
  keys = await generateKeyPair('RS256');
  Object.assign(process.env, {
    DISCORD_TOKEN: 'x'.repeat(60),
    DISCORD_EXPECTED_BOT_ID: bot,
    ALLOWED_GUILDS: guild,
    MCP_OWNER_USER_ID: owner,
    MCP_ALLOWED_CHANNEL_IDS: parent,
    MCP_PUBLIC_URL: 'https://discord.example/mcp',
    MCP_OAUTH_ISSUER: 'https://issuer.example',
    MCP_OAUTH_JWKS_URI: 'https://issuer.example/jwks',
    MCP_OAUTH_OWNER_SUBJECT: 'subject-owner',
    LOG_LEVEL: 'fatal',
    MCP_AUDIT_SINK: 'none',
  });
  delete process.env.DISCORD_MCP_ACCESS_TOKEN;
  discordMock.use(
    http.all(/^http:\/\/127\.0\.0\.1/, () => passthrough()),
    http.get('https://discord.com/api/v10/users/%40me', () =>
      HttpResponse.json({ id: bot, bot: true }),
    ),
    http.get('https://discord.com/api/v10/channels/:id', ({ params }) =>
      HttpResponse.json({ id: params.id, guild_id: guild, type: 0, name: 'parent' }),
    ),
    http.get('https://discord.com/api/v10/channels/:id/messages', ({ params }) =>
      HttpResponse.json([
        {
          id: message,
          channel_id: params.id,
          content: 'synthetic',
          timestamp: '2026-01-01T00:00:00Z',
          edited_timestamp: null,
          author: { id: owner, username: 'owner' },
        },
      ]),
    ),
    http.post('https://discord.com/api/v10/channels/:id/messages', async ({ params, request }) => {
      const body = (await request.json()) as {
        allowed_mentions: { parse: unknown[]; replied_user: boolean };
        message_reference: { message_id: string };
      };
      expect(body.allowed_mentions).toEqual({ parse: [], replied_user: false });
      expect(body.message_reference.message_id).toBe(message);
      writes++;
      return HttpResponse.json({
        id: message,
        channel_id: params.id,
        guild_id: guild,
        content: 'synthetic',
        timestamp: '2026-01-01T00:00:00Z',
      });
    }),
    http.post('https://discord.com/api/v10/users/@me/channels', () => {
      writes++;
      return HttpResponse.json({});
    }),
  );
  server = await startHttp({
    port: 0,
    registerSignalHandlers: false,
    ownerVerifyKey: async () => keys.publicKey,
  });
});
afterEach(async () => {
  if (server !== undefined)
    await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
  server = undefined;
  process.env = { ...env };
});
async function clientWith(access: string) {
  const client = new Client({ name: 'owner-http-test', version: '1' }, { capabilities: {} });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url()), {
      requestInit: { headers: { Authorization: `Bearer ${access}` } },
    }),
  );
  return client;
}
describe('owner remote OAuth transport', () => {
  it('resolves an ephemeral HTTPS JWKS and serves liveness without client credentials', async () => {
    await new Promise<void>((resolve, reject) => server!.close((e) => (e ? reject(e) : resolve())));
    const jwk = await exportJWK(keys.publicKey);
    discordMock.use(
      http.get('https://issuer.example/jwks', () =>
        HttpResponse.json({ keys: [{ ...jwk, alg: 'RS256' }] }),
      ),
    );
    server = await startHttp({ port: 0, registerSignalHandlers: false });
    expect((await fetch(url('/livez'))).status).toBe(200);
    expect((await fetch(url('/healthz'))).status).toBe(401);
    const client = await clientWith(await token());
    try {
      expect((await client.listTools()).tools).toHaveLength(15);
    } finally {
      await client.close();
    }
  });
  it('publishes canonical resource metadata and verifies complete actual remote discovery/read/send contract', async () => {
    const metadata = await (await fetch(url('/.well-known/oauth-protected-resource'))).json();
    expect(metadata).toMatchObject({
      resource: 'https://discord.example/mcp',
      authorization_servers: ['https://issuer.example'],
    });
    const client = await clientWith(await token('discord.read discord.write'));
    try {
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(15);
      expect(new Set(tools.map((t) => t.name)).size).toBe(15);
      expect(
        tools.every((t) => typeof t.inputSchema === 'object' && typeof t.outputSchema === 'object'),
      ).toBe(true);
      const result = await client.callTool({
        name: 'messages_read',
        arguments: { channel_id: parent, limit: 1 },
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ next_after: message });
      const send = await client.callTool({
        name: 'messages_send',
        arguments: { channel_id: parent, content: 'synthetic', reply_to_message_id: message },
      });
      expect(send.isError).toBe(false);
      expect(writes).toBe(1);
    } finally {
      await client.close();
    }
  });
  it('fails missing/invalid/expired/wrong-owner/wrong-audience authentication without exposing credentials', async () => {
    for (const access of [
      '',
      'invalid',
      await token('discord.read', 'other'),
      await token('discord.read', 'subject-owner', 'https://other.example/mcp'),
      await token('discord.read', 'subject-owner', 'https://discord.example/mcp', '-2m'),
    ]) {
      const response = await fetch(url(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(access || 'token');
    }
    expect(writes).toBe(0);
  });
  it('requires read scope and blocks every mutation before Discord under read-only grants', async () => {
    const { OWNER_WRITE_TOOL_NAMES } = await import('@discord-mcp/core');
    const read = await token();
    for (const name of OWNER_WRITE_TOOL_NAMES) {
      const response = await fetch(url(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${read}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: {} },
        }),
      });
      expect(response.status).toBe(403);
    }
    expect(
      (
        await fetch(url(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${await token('discord.write')}` },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(writes).toBe(0);
  });
  it('rejects wrong origins and malformed/batched RPC before any Discord mutation', async () => {
    const access = await token('discord.read discord.write');
    expect(
      (
        await fetch(url(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${access}`, Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    for (const body of ['[]', 'null', '{'])
      expect(
        (
          await fetch(url(), {
            method: 'POST',
            headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
            body,
          })
        ).status,
      ).toBe(400);
    expect(writes).toBe(0);
  });
});
