import type { REST } from '@discordjs/rest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { OWNER_TOOL_NAMES } from './middleware/owner-scope.js';
import { buildServer } from './server.js';

const guild = '111122223333444455',
  parent = '222233334444555566',
  thread = '333344445555666677',
  owner = '444455556666777788',
  bot = '555566667777888899',
  dm = '666677778888999000',
  message = '777788889999000111';
const clients: Client[] = [];
async function connect(recipient = owner, threadParent = parent, dmType = 1) {
  const get = vi.fn(async (route: string) => {
    if (route.startsWith('/users/')) return { id: bot, bot: true };
    if (route === `/channels/${parent}`)
      return { id: parent, guild_id: guild, type: 0, name: 'parent' };
    if (route === `/channels/${thread}`)
      return { id: thread, guild_id: guild, type: 11, parent_id: threadParent, name: 'thread' };
    if (route === `/channels/${dm}`)
      return { id: dm, type: dmType, recipients: [{ id: recipient }] };
    if (route.endsWith('/messages'))
      return [
        {
          id: message,
          channel_id: route.split('/')[2],
          content: 'fixture',
          timestamp: '2026-01-01T00:00:00Z',
          edited_timestamp: null,
          author: { id: owner, username: 'owner' },
          message_reference: { message_id: message },
          referenced_message: { author: { id: bot } },
        },
      ];
    return {};
  });
  const post = vi.fn(async () => ({ id: dm, type: 1, recipients: [{ id: owner }] }));
  const config = loadConfig({
    DISCORD_TOKEN: 'x'.repeat(60),
    DISCORD_EXPECTED_BOT_ID: bot,
    ALLOWED_GUILDS: guild,
    MCP_OWNER_USER_ID: owner,
    MCP_ALLOW_USER_SCOPED: 'true',
    MCP_ALLOWED_CHANNEL_IDS: parent,
    LOG_LEVEL: 'fatal',
    MCP_AUDIT_SINK: 'none',
  });
  const built = await buildServer({
    rest: { get, post } as unknown as REST,
    config,
    logger: createLogger(config),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'owner-test', version: '1' }, { capabilities: {} });
  clients.push(client);
  await Promise.all([client.connect(a), built.server.connect(b)]);
  return { client, get, post };
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
describe('single owner boundaries', () => {
  it('advertises exactly the bounded manifest and blocks hidden dispatch/resource paths', async () => {
    const { client, get } = await connect();
    const tools = (await client.listTools()).tools;
    expect(new Set(tools.map((t) => t.name))).toEqual(OWNER_TOOL_NAMES);
    expect(tools).toHaveLength(15);
    get.mockClear();
    for (const name of [
      'guild_get',
      'mcp_pipeline',
      'workflow_start',
      'mcp_tools_execute',
      'channels_list',
      'users_modify_current',
    ])
      expect((await client.callTool({ name, arguments: {} })).isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect((await client.listResources()).resources).toEqual([]);
    await expect(client.readResource({ uri: `discord://guild/${guild}` })).rejects.toThrow();
  });
  it('permits exact owner DM and verified child history with author and reply-author identity', async () => {
    const { client } = await connect();
    for (const channel_id of [dm, thread]) {
      const result = await client.callTool({
        name: 'messages_read',
        arguments: { channel_id, limit: 1 },
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        next_after: message,
        may_have_more: true,
        messages: [{ author_id: owner, referenced_author_id: bot, author_bot: false }],
      });
    }
  });
  it('rejects nonowner DM and wrong-parent threads before fetching message content', async () => {
    const { client, get } = await connect(bot, dm);
    get.mockClear();
    for (const channel_id of [dm, thread])
      expect(
        (await client.callTool({ name: 'messages_read', arguments: { channel_id } })).isError,
      ).toBe(true);
    expect(get.mock.calls.every(([route]) => !route.endsWith('/messages'))).toBe(true);
  });
  it('rejects a group DM even when the returned recipient is the owner', async () => {
    const { client } = await connect(owner, parent, 3);
    expect(
      (await client.callTool({ name: 'messages_read', arguments: { channel_id: dm } })).isError,
    ).toBe(true);
  });
  it('rejects arbitrary DM creation despite user-scoped opt-in and validates owner opening', async () => {
    const { client, post } = await connect();
    expect(
      (await client.callTool({ name: 'users_create_dm', arguments: { recipient_id: bot } }))
        .isError,
    ).toBe(true);
    expect(post).not.toHaveBeenCalled();
    const result = await client.callTool({
      name: 'users_create_dm',
      arguments: { recipient_id: owner },
    });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ recipient_ids: [owner] });
  });
});
