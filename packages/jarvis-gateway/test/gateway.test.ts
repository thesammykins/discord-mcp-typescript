import { describe, expect, it, vi } from 'vitest';
import {
  OWNER_TOOL_NAMES,
  OWNER_WRITE_TOOL_NAMES,
} from '../../mcp-core/src/middleware/owner-scope.js';
import { tools } from '../worker/contract.js';
import { gateway } from '../worker/index.js';
import {
  bot,
  channel,
  dm,
  env,
  fixtureFetch,
  guild,
  history,
  message,
  owner,
  parent,
  rpc,
  thread,
} from './fixtures.js';

async function call(
  name: string,
  args: Record<string, unknown> = {},
  bindings = env,
  fetcher = fixtureFetch,
  principal: string | null = 'site-owner',
) {
  return (await (await gateway(rpc(name, args, principal), bindings, fetcher)).json()).result;
}
const args: Record<string, Record<string, unknown>> = {
  channels_get: { channel_id: parent },
  owner_list_channels: {},
  messages_read: { channel_id: parent, limit: 1 },
  messages_get: { channel_id: parent, message_id: message },
  messages_send: {
    channel_id: parent,
    content: 'synthetic',
    reply_to_message_id: message,
    __approve: true,
  },
  messages_create_thread: {
    channel_id: parent,
    message_id: message,
    name: 'synthetic',
    __approve: true,
  },
  users_create_dm: { recipient_id: owner, __approve: true },
  reactions_list: { channel_id: parent, message_id: message, emoji: '✅' },
  reactions_verify_owner: { channel_id: parent, message_id: message, emoji: '✅', owner_id: owner },
  reactions_create: { channel_id: parent, message_id: message, emoji: '✅', __approve: true },
  reactions_delete_own: { channel_id: parent, message_id: message, emoji: '✅', __approve: true },
  channels_list_public_archived_threads: { channel_id: parent },
  channels_list_private_archived_threads: { channel_id: parent },
  channels_list_joined_private_archived_threads: { channel_id: parent },
  threads_set_archived: { channel_id: thread, archived: true, __approve: true },
};
describe('native Site MCP contract', () => {
  it('rejects every invocation without an exact native owner even with read/write scope granted', async () => {
    const fetcher = vi.fn();
    const bindings = { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' };
    for (const name of OWNER_TOOL_NAMES) {
      for (const principal of [null, 'synthetic-forged-owner']) {
        const result = await call(`discord_${name}`, args[name], bindings, fetcher, principal);
        expect(result).toMatchObject({
          isError: true,
          structuredContent: { code: 'OWNER_IDENTITY_REJECTED' },
        });
        expect(JSON.stringify(result)).not.toContain(bindings.DISCORD_TOKEN);
      }
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('has no secret-returning HTTP routes with a configured synthetic server credential', async () => {
    const fetcher = vi.fn();
    for (const path of ['/', '/control', '/healthz', '/env', '/secrets']) {
      const response = await gateway(new Request(`https://gateway.example${path}`), env, fetcher);
      expect(await response.text()).not.toContain(env.DISCORD_TOKEN);
      if (['/env', '/secrets'].includes(path)) expect(response.status).toBe(404);
    }
    const response = await gateway(
      new Request('https://gateway.example/control', {
        headers: { 'oai-authenticated-user-id': 'synthetic-forged-owner' },
      }),
      env,
      fetcher,
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('discovers exactly the namespaced bounded manifest without an upstream credential or call', async () => {
    const fetcher = vi.fn();
    for (const method of ['server/discover', 'initialize', 'tools/list']) {
      const request = new Request('https://gateway.example/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
      });
      const result = await (await gateway(request, {}, fetcher)).json();
      expect(result.error).toBeUndefined();
      if (method === 'tools/list')
        expect(new Set(result.result.tools.map((t: { name: string }) => t.name))).toEqual(
          new Set([...OWNER_TOOL_NAMES].map((n) => `discord_${n}`)),
        );
    }
    expect(tools).toHaveLength(15);
    expect(
      tools.every((t) => t.inputSchema.type === 'object' && t.outputSchema.type === 'object'),
    ).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ...OWNER_TOOL_NAMES,
  ])('executes and validates %s only against scoped synthetic Discord', async (name) => {
    const fetcher = vi.fn(fixtureFetch);
    const result = await call(
      `discord_${name}`,
      args[name],
      { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' },
      fetcher,
    );
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toBeTypeOf('object');
    for (const [input, options] of fetcher.mock.calls) {
      expect(new URL(String(input)).origin).toBe('https://discord.com');
      expect(options?.headers).toMatchObject({ Authorization: `Bot ${env.DISCORD_TOKEN}` });
    }
  });
  it('fails closed while disabled, unconfigured, or missing/exactly wrong Site owner before any fetch', async () => {
    const fetcher = vi.fn();
    for (const bindings of [
      {},
      { ...env, JARVIS_DISCORD_ENABLED: 'false' },
      { ...env, JARVIS_OWNER_PRINCIPAL: undefined },
      { ...env, JARVIS_DISCORD_SCOPES: 'discord.write' },
      { ...env, ALLOWED_GUILDS: `${guild},${bot}` },
    ])
      expect(
        (await call('discord_channels_get', { channel_id: parent }, bindings, fetcher)).isError,
      ).toBe(true);
    for (const principal of [null, 'other-owner'])
      expect(
        (await call('discord_channels_get', { channel_id: parent }, env, fetcher, principal))
          .structuredContent.code,
      ).toBe('OWNER_IDENTITY_REJECTED');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects every write under read scope and rejects unapproved or malformed mutations', async () => {
    const fetcher = vi.fn();
    for (const name of OWNER_WRITE_TOOL_NAMES)
      expect((await call(`discord_${name}`, args[name], env, fetcher)).structuredContent.code).toBe(
        'WRITE_SCOPE_REQUIRED',
      );
    for (const approve of [undefined, false, 'true'])
      expect(
        (
          await call(
            'discord_messages_send',
            { channel_id: parent, content: 'synthetic', __approve: approve },
            { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' },
            fetcher,
          )
        ).structuredContent.code,
      ).toBe('INVALID_ARGUMENTS');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('has no dispatcher/resource/proxy endpoint, credential header or caller-selected scope override', async () => {
    const fetcher = vi.fn();
    for (const name of [
      'mcp_pipeline',
      'discord_mcp_pipeline',
      'workflow_start',
      'mcp_tools_execute',
      'messages_send',
      'commons_get_account_status',
      'discord_channels_list',
    ])
      expect((await call(name, {}, env, fetcher)).structuredContent.code).toBe(
        'TOOL_NOT_AVAILABLE',
      );
    for (const field of ['url', 'headers', 'owner', 'scopes', 'credential'])
      expect(
        (
          await call(
            'discord_channels_get',
            { channel_id: parent, [field]: 'https://evil.example' },
            env,
            fetcher,
          )
        ).structuredContent.code,
      ).toBe('INVALID_ARGUMENTS');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects group/nonowner DMs, wrong guild/parent children and wrong bot without reading history', async () => {
    for (const replacement of [
      { ...channel(dm), type: 3 },
      { ...channel(dm), recipients: [{ id: bot }] },
      { ...channel(thread), parent_id: dm },
      { ...channel(thread), guild_id: bot },
    ]) {
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith(`/channels/${replacement.id}`)
          ? Response.json(replacement)
          : fixtureFetch(input, init),
      );
      expect(
        (await call('discord_messages_read', { channel_id: replacement.id }, env, fetcher))
          .structuredContent.code,
      ).toBe('OWNER_SCOPE_REJECTED');
      expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/messages'))).toBe(false);
    }
    const badBot = vi.fn(async () => Response.json({ id: owner, bot: true }));
    expect(
      (await call('discord_channels_get', { channel_id: parent }, env, badBot)).structuredContent
        .code,
    ).toBe('BOT_IDENTITY_MISMATCH');
    expect(badBot).toHaveBeenCalledOnce();
  });
  it('permits exact owner DM and verified children and preserves reply/author identity', async () => {
    for (const channel_id of [dm, thread]) {
      const r = await call('discord_messages_read', { channel_id, limit: 1 });
      expect(r.isError).toBe(false);
      expect(r.structuredContent).toMatchObject({
        next_before: message,
        next_after: message,
        order: 'newest_first',
        may_have_more: true,
        messages: [{ author_id: owner, referenced_author_id: bot, author_bot: false }],
      });
    }
  });
  it('rejects duplicate, nonadvancing, oversized or wrong-channel message pages before emitting a checkpoint', async () => {
    for (const messages of [[history(), history()], [history(message, dm)]]) {
      const fetcher = async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith('/messages') ? Response.json(messages) : fixtureFetch(input, init);
      const r = await call(
        'discord_messages_read',
        { channel_id: parent, after: message, limit: 1 },
        env,
        fetcher,
      );
      expect(r.isError).toBe(true);
      expect(r.structuredContent.next_after).toBeUndefined();
    }
  });
  it('requires owner recipient before DM POST and exact owner verification ID', async () => {
    const fetcher = vi.fn(fixtureFetch);
    expect(
      (
        await call(
          'discord_users_create_dm',
          { recipient_id: bot, __approve: true },
          { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' },
          fetcher,
        )
      ).structuredContent.code,
    ).toBe('OWNER_SCOPE_REJECTED');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(
      (
        await call(
          'discord_reactions_verify_owner',
          { channel_id: parent, message_id: message, owner_id: bot, emoji: '✅' },
          env,
          fetcher,
        )
      ).structuredContent.code,
    ).toBe('OWNER_SCOPE_REJECTED');
  });
  it('verifies the owner beyond 100 users by exact ID and reports unknown at the bounded ceiling', async () => {
    for (const found of [true, false]) {
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (!url.pathname.includes('/reactions/')) return fixtureFetch(input, init);
        if (found && url.searchParams.has('after'))
          return Response.json([{ id: owner, username: 'different' }]);
        const start = BigInt(url.searchParams.get('after') ?? '111122223333444499');
        return Response.json(
          Array.from({ length: 100 }, (_, i) => ({
            id: String(start + BigInt(i) + 1n),
            username: 'owner',
          })),
        );
      });
      const r = await call(
        'discord_reactions_verify_owner',
        { channel_id: parent, message_id: message, emoji: '✅', owner_id: owner, type: 1 },
        env,
        fetcher,
      );
      expect(r.structuredContent).toMatchObject({
        present: found,
        complete: found,
        pages_checked: found ? 2 : 10,
        type: 1,
      });
    }
  });
  it('preserves fractional archive cursor precision and parent membership, rejects ambiguous ties', async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/threads/archived/')) return fixtureFetch(input, init);
      return Response.json({
        threads: [
          {
            ...channel(thread),
            type: 11,
            name: 'archived',
            thread_metadata: { archive_timestamp: '2026-01-01T00:00:00.855700Z' },
          },
        ],
        has_more: false,
      });
    };
    expect(
      (
        await call(
          'discord_channels_list_public_archived_threads',
          { channel_id: parent, before: '2026-01-01T00:00:00.855793Z' },
          env,
          fetcher,
        )
      ).isError,
    ).toBe(false);
    const ties = async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/threads/archived/')
        ? Response.json({
            threads: [
              {
                ...channel(thread),
                name: 'one',
                thread_metadata: { archive_timestamp: '2026-01-01T00:00:00Z' },
              },
              {
                ...channel(thread),
                id: message,
                name: 'two',
                thread_metadata: { archive_timestamp: '2026-01-01T00:00:00Z' },
              },
            ],
            has_more: true,
          })
        : fixtureFetch(input, init);
    expect(
      (
        await call(
          'discord_channels_list_public_archived_threads',
          { channel_id: parent, limit: 1 },
          env,
          ties,
        )
      ).isError,
    ).toBe(true);
  });
  it('sends safe same-channel replies with no mentions and classifies accepted malformed responses as unknown', async () => {
    const bindings = { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({
          allowed_mentions: { parse: [], replied_user: false },
          message_reference: { channel_id: parent, message_id: message, fail_if_not_exists: true },
        });
        return Response.json(null);
      }
      return fixtureFetch(input, init);
    });
    expect(
      (await call('discord_messages_send', args.messages_send, bindings, fetcher))
        .structuredContent,
    ).toMatchObject({ code: 'WRITE_OUTCOME_UNKNOWN', retriable: false });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('never follows upstream redirects or retries uncertain writes, and emits bounded rate-limit diagnostics', async () => {
    for (const status of [302, 500, 429]) {
      const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Response(null, {
              status,
              headers: { Location: 'https://evil.example', 'retry-after': '3' },
            })
          : fixtureFetch(input, init),
      );
      const r = await call(
        'discord_messages_send',
        args.messages_send,
        { ...env, JARVIS_DISCORD_SCOPES: 'discord.read,discord.write' },
        fetcher,
      );
      expect(r.structuredContent.code).toBe(
        status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'WRITE_OUTCOME_UNKNOWN',
      );
      expect(r.structuredContent.retriable).toBe(status === 429);
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    }
  });
  it('does not leak upstream payloads, caller Authorization, token or messages into diagnostics', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = async () => {
      throw new Error('secret-or-message-from-upstream');
    };
    const r = await gateway(
      rpc('discord_channels_get', { channel_id: parent }, 'site-owner', {
        Authorization: 'Bearer must-not-forward',
      }),
      { ...env, JARVIS_LOG_ERRORS: 'true' },
      fetcher,
    );
    expect(await r.text()).not.toContain('secret-or-message-from-upstream');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(env.DISCORD_TOKEN);
    warn.mockRestore();
  });
  it('rejects foreign origins, direct-worker origins, batches and unregistered resources', async () => {
    expect(
      (
        await gateway(
          rpc('discord_channels_get', { channel_id: parent }, 'site-owner', {
            Origin: 'https://evil.example',
          }),
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await gateway(
          new Request('https://worker.example/mcp', { method: 'POST', body: '{}' }),
          env,
        )
      ).status,
    ).toBe(403);
    for (const body of [
      '[]',
      'null',
      '{',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' }),
    ]) {
      const r = await (
        await gateway(new Request('https://gateway.example/mcp', { method: 'POST', body }), {})
      ).json();
      expect(r.error).toBeDefined();
    }
  });
});
