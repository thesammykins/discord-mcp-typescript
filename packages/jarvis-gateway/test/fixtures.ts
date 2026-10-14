import type { Bindings } from '../worker/runtime.js';
export const guild = '111122223333444455',
  parent = '222233334444555566',
  thread = '333344445555666677',
  owner = '444455556666777788',
  bot = '555566667777888899',
  dm = '666677778888999000',
  message = '777788889999000111';
export const env: Bindings = {
  JARVIS_SITE_ORIGIN: 'https://gateway.example',
  JARVIS_OWNER_PRINCIPAL: 'site-owner',
  JARVIS_DISCORD_ENABLED: 'true',
  JARVIS_DISCORD_SCOPES: 'discord.read',
  DISCORD_TOKEN: 'synthetic-test-token-that-is-never-live',
  DISCORD_EXPECTED_BOT_ID: bot,
  ALLOWED_GUILDS: guild,
  MCP_OWNER_USER_ID: owner,
  MCP_ALLOWED_CHANNEL_IDS: parent,
};
export function rpc(
  name: string,
  args: Record<string, unknown> = {},
  principal: string | null = 'site-owner',
  extra: Record<string, string> = {},
) {
  return new Request('https://gateway.example/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(principal === null ? {} : { 'oai-authenticated-user-id': principal }),
      ...extra,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
}
export function channel(id: string) {
  if (id === dm) return { id, type: 1, recipients: [{ id: owner }] };
  if (id === thread)
    return {
      id,
      type: 11,
      guild_id: guild,
      parent_id: parent,
      name: 'child',
      thread_metadata: { archived: true, locked: false },
    };
  return { id, type: 0, guild_id: guild, name: 'parent' };
}
export function history(id = message, channel_id = parent) {
  return {
    id,
    channel_id,
    author: { id: owner, username: 'fixture', bot: false },
    content: 'untrusted synthetic content',
    timestamp: '2026-01-01T00:00:00Z',
    edited_timestamp: null,
    message_reference: { message_id: id, channel_id },
    referenced_message: { author: { id: bot } },
  };
}
export async function fixtureFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://discord.com') throw new Error('Unexpected outbound destination');
  const path = url.pathname.replace('/api/v10', '');
  if (path === '/users/%40me') return Response.json({ id: bot, bot: true });
  if (init?.method === 'GET' && /^\/channels\/\d+$/.test(path))
    return Response.json(channel(path.split('/')[2]!));
  if (path.endsWith('/messages') && init?.method === 'GET')
    return Response.json([history(message, path.split('/')[2]!)]);
  if (path.endsWith('/messages') && init?.method === 'POST')
    return Response.json({
      id: message,
      channel_id: path.split('/')[2],
      timestamp: '2026-01-01T00:00:00Z',
    });
  if (path.includes('/messages/') && !path.includes('/reactions/') && !path.endsWith('/threads'))
    return Response.json(history());
  if (path.includes('/reactions/') && init?.method === 'GET')
    return Response.json([{ id: owner, username: 'fixture' }]);
  if (path.includes('/reactions/') && ['PUT', 'DELETE'].includes(init?.method ?? ''))
    return new Response(null, { status: 204 });
  if (path.endsWith('/threads') && init?.method === 'POST')
    return Response.json({ ...channel(thread), name: 'created', type: 11 });
  if (path.includes('/threads/archived/'))
    return Response.json({
      threads: [
        {
          ...channel(thread),
          type: path.includes('/private') ? 12 : 11,
          name: 'archived',
          thread_metadata: { archived: true, archive_timestamp: '2026-01-01T00:00:00.855700Z' },
        },
      ],
      has_more: false,
    });
  if (path === '/users/@me/channels') return Response.json(channel(dm));
  if (init?.method === 'PATCH')
    return Response.json({
      ...channel(thread),
      thread_metadata: { archived: JSON.parse(String(init.body)).archived, locked: true },
    });
  throw new Error('Unhandled synthetic route');
}
