import type { REST } from '@discordjs/rest';
import { container } from '@sapphire/pieces';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config.js';
import '../../container.js';
import CreateThread from '../messages/create_thread.js';
import Send from '../messages/send.js';
import CreateDm from '../users/create_dm.js';
import SetArchived from './set_thread_archived.js';
import VerifyReaction from './verify_reaction.js';

const guild = '111122223333444455',
  parent = '222233334444555566',
  owner = '444455556666777788',
  bot = '555566667777888899',
  message = '777788889999000111';
const context = { signal: new AbortController().signal };
function instance(
  T:
    | typeof Send
    | typeof CreateThread
    | typeof CreateDm
    | typeof VerifyReaction
    | typeof SetArchived,
) {
  return new T(
    { name: T.name, path: 'inline', root: 'inline', store: null as never },
    { name: T.name, enabled: true },
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  container.config = loadConfig({
    DISCORD_TOKEN: 'x'.repeat(60),
    DISCORD_EXPECTED_BOT_ID: bot,
    ALLOWED_GUILDS: guild,
    MCP_OWNER_USER_ID: owner,
    MCP_ALLOWED_CHANNEL_IDS: parent,
  });
});
describe('owner monitoring integrity', () => {
  it('finds the exact owner beyond the first 100 reactors, despite matching display names', async () => {
    const get = vi.fn(async (_route: string, options: { query: URLSearchParams }) =>
      options.query.has('after')
        ? [{ id: owner, username: 'another' }]
        : Array.from({ length: 100 }, (_, i) => ({
            id: String(111122223333444500n + BigInt(i)),
            username: 'owner',
          })),
    );
    container.rest = { get } as unknown as REST;
    const result = await instance(VerifyReaction).run(
      { channel_id: parent, message_id: message, emoji: '✅', owner_id: owner, type: 1 },
      context,
    );
    expect(result).toMatchObject({
      structuredContent: { present: true, complete: true, pages_checked: 2, type: 1 },
    });
    expect(get.mock.calls[1]![1].query.get('after')).toBe('111122223333444599');
    expect(get.mock.calls.every(([, options]) => options.query.get('type') === '1')).toBe(true);
  });
  it('returns unknown at the ten-page ceiling instead of claiming absence', async () => {
    const get = vi.fn(async (_route: string, options: { query: URLSearchParams }) => {
      const start = BigInt(options.query.get('after') ?? '111122223333444499');
      return Array.from({ length: 100 }, (_, i) => ({
        id: String(start + BigInt(i) + 1n),
        username: 'owner',
      }));
    });
    container.rest = { get } as unknown as REST;
    const result = await instance(VerifyReaction).run(
      { channel_id: parent, message_id: message, emoji: '✅', owner_id: owner },
      context,
    );
    expect(result).toMatchObject({
      structuredContent: { present: false, complete: false, pages_checked: 10 },
    });
    expect(get).toHaveBeenCalledTimes(10);
  });
  it('returns unknown when the time budget aborts an in-flight reactor read', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(
      AbortSignal.abort(new Error('synthetic deadline')),
    );
    container.rest = {
      get: vi.fn(async (_route: string, options: { signal: AbortSignal }) => {
        options.signal.throwIfAborted();
        return [];
      }),
    } as unknown as REST;
    expect(
      await instance(VerifyReaction).run(
        { channel_id: parent, message_id: message, emoji: '✅', owner_id: owner },
        context,
      ),
    ).toMatchObject({ structuredContent: { present: false, complete: false, pages_checked: 0 } });
  });
  it.each([
    null,
    {},
    { id: message, channel_id: parent, timestamp: 'invalid' },
    { id: 'bad', channel_id: parent, timestamp: '2026-01-01T00:00:00Z' },
  ])('does not invite duplicate sends after malformed accepted response %j', async (response) => {
    container.rest = { post: vi.fn().mockResolvedValue(response) } as unknown as REST;
    await expect(
      instance(Send).run({ channel_id: parent, content: 'synthetic' }, context),
    ).rejects.toMatchObject({ code: 'MESSAGE_OUTCOME_UNKNOWN', retriable: false });
  });
  it('makes unclassified post-send decode errors nonretryable', async () => {
    container.rest = {
      post: vi.fn().mockRejectedValue(new SyntaxError('synthetic response decode')),
    } as unknown as REST;
    await expect(
      instance(Send).run({ channel_id: parent, content: 'synthetic' }, context),
    ).rejects.toMatchObject({ code: 'MESSAGE_OUTCOME_UNKNOWN', retriable: false });
  });
  it('does not report mismatched DM or thread creation as retryable', async () => {
    container.rest = {
      post: vi.fn().mockResolvedValue({
        id: message,
        type: 3,
        parent_id: parent,
        recipients: [{ id: bot }],
        name: 'wrong',
      }),
    } as unknown as REST;
    await expect(instance(CreateDm).run({ recipient_id: owner }, context)).rejects.toMatchObject({
      code: 'DM_OUTCOME_UNKNOWN',
      retriable: false,
    });
    await expect(
      instance(CreateThread).run(
        { channel_id: parent, message_id: message, name: 'synthetic' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'THREAD_OUTCOME_UNKNOWN', retriable: false });
  });
  it('patches only the required Boolean archive state and rejects a mismatched child response', async () => {
    const patch = vi.fn().mockResolvedValue({
      id: message,
      parent_id: parent,
      guild_id: guild,
      type: 11,
      thread_metadata: { archived: true, locked: true },
    });
    container.rest = { patch } as unknown as REST;
    expect(
      await instance(SetArchived).run({ channel_id: message, archived: true }, context),
    ).toMatchObject({ structuredContent: { archived: true, locked: true } });
    expect(patch).toHaveBeenCalledWith(`/channels/${message}`, { body: { archived: true } });
    patch.mockResolvedValueOnce({
      id: message,
      parent_id: owner,
      guild_id: guild,
      type: 11,
      thread_metadata: { archived: true },
    });
    await expect(
      instance(SetArchived).run({ channel_id: message, archived: true }, context),
    ).rejects.toMatchObject({ code: 'OWNER_SCOPE_REJECTED', retriable: false });
  });
});
