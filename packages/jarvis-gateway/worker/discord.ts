import { Routes } from 'discord-api-types/v10';
import { OwnerScopePolicy } from '../../mcp-core/src/middleware/owner-scope.js';
import { archivePageContract } from '../../mcp-core/src/tools/_lib/archive-contract.js';
import { type ChannelTags, channelTags } from '../../mcp-core/src/tools/_lib/forum-tags.js';
import { compareIds, validatePage } from '../../mcp-core/src/tools/_lib/page.js';
import { projectMessage, type RawMessage } from '../../mcp-core/src/tools/messages/_lib/message.js';
import { type Configuration, type DiscordClient, GatewayError } from './runtime.js';

export interface Args {
  channel_id?: string;
  message_id?: string;
  owner_id?: string;
  recipient_id?: string;
  emoji?: string;
  type?: 0 | 1;
  limit?: number;
  before?: string;
  after?: string;
  content?: string;
  tts?: boolean;
  reply_to_message_id?: string;
  name?: string;
  auto_archive_duration?: number;
  rate_limit_per_user?: number;
  archived?: boolean;
}
interface Channel extends ChannelTags {
  id: string;
  type: number;
  name?: string | null;
  guild_id?: string;
  parent_id?: string | null;
  position?: number;
  nsfw?: boolean;
  topic?: string | null;
  rate_limit_per_user?: number;
  recipients?: { id: string }[];
  owner_id?: string;
  thread_metadata?: { archived?: boolean; locked?: boolean; archive_timestamp?: string };
}
function validMessage(m: RawMessage, channel: string) {
  if (m?.channel_id !== channel || !m.author) throw new GatewayError('INVALID_UPSTREAM_IDENTITY');
  validatePage([m.id], 1);
  validatePage([m.author.id], 1);
  return projectMessage(m);
}
export class DiscordAdapter {
  private readonly scope: OwnerScopePolicy;
  constructor(
    private readonly client: DiscordClient,
    private readonly config: Configuration,
  ) {
    this.scope = new OwnerScopePolicy(
      {
        MCP_OWNER_USER_ID: config.owner,
        MCP_ALLOWED_CHANNEL_IDS: config.parents.join(','),
        ALLOWED_GUILDS: config.guild,
      },
      { get: (path) => this.client.request('GET', path) },
    );
  }
  private async reactors(args: Args, after?: string, limit = args.limit ?? 25) {
    const query = new URLSearchParams({ limit: String(limit), type: String(args.type ?? 0) });
    if (after) query.set('after', after);
    const users = (await this.client.request(
      'GET',
      Routes.channelMessageReaction(args.channel_id!, args.message_id!, args.emoji!),
      undefined,
      query,
    )) as { id: string; username: string; global_name?: string | null; bot?: boolean }[];
    if (!Array.isArray(users)) throw new GatewayError('INVALID_UPSTREAM_RESPONSE');
    validatePage(
      users.map((u) => u.id),
      limit,
      undefined,
      after,
    );
    users.sort((a, b) => compareIds(a.id, b.id));
    return {
      users: users.map((u) => ({
        user_id: u.id,
        username: u.global_name ?? u.username,
        bot: u.bot ?? false,
      })),
      count: users.length,
      channel_id: args.channel_id!,
      message_id: args.message_id!,
      emoji: args.emoji!,
      type: args.type ?? 0,
      may_have_more: users.length === limit,
      ...(users.length === limit ? { next_after: users.at(-1)!.id } : {}),
    };
  }
  async call(name: string, args: Args): Promise<Record<string, unknown>> {
    await this.client.identity();
    const proofGuild = await this.scope.authorize(name, args);
    const channel = args.channel_id!;
    const message = args.message_id!;
    if (name === 'owner_list_channels') {
      const channels = [];
      for (const id of this.config.parents) {
        await this.scope.authorize('channels_get', { channel_id: id });
        const c = (await this.client.request('GET', Routes.channel(id))) as Channel;
        if (c?.id !== id || c.guild_id !== this.config.guild || [1, 3, 10, 11, 12].includes(c.type))
          throw new GatewayError('INVALID_UPSTREAM_IDENTITY');
        channels.push({ id: c.id, name: c.name ?? null, type: c.type });
      }
      return { channels, active_thread_coverage: 'partial_parent_history_and_known_ids' };
    }
    if (name === 'channels_get') {
      const c = (await this.client.request('GET', Routes.channel(channel))) as Channel;
      if (c?.id !== channel) throw new GatewayError('INVALID_UPSTREAM_IDENTITY');
      return {
        ...channelTags(c),
        id: c.id,
        name: c.name ?? null,
        type: c.type,
        nsfw: c.nsfw ?? false,
        topic: c.topic ?? null,
        rate_limit_per_user: c.rate_limit_per_user ?? 0,
        ...(c.position === undefined ? {} : { position: c.position }),
        ...(c.parent_id === undefined ? {} : { parent_id: c.parent_id }),
        ...(c.guild_id === undefined ? {} : { guild_id: c.guild_id }),
      };
    }
    if (name === 'messages_read') {
      const limit = args.limit ?? 50;
      const query = new URLSearchParams({ limit: String(limit) });
      if (args.before) query.set('before', args.before);
      if (args.after) query.set('after', args.after);
      const raw = (await this.client.request(
        'GET',
        Routes.channelMessages(channel),
        undefined,
        query,
      )) as RawMessage[];
      if (!Array.isArray(raw)) throw new GatewayError('INVALID_UPSTREAM_RESPONSE');
      validatePage(
        raw.map((m) => m.id),
        limit,
        args.before,
        args.after,
      );
      raw.sort((a, b) => compareIds(b.id, a.id));
      const messages = raw.map((m) => ({ id: m.id, ...validMessage(m, channel) }));
      return {
        messages,
        count: messages.length,
        channel_id: channel,
        order: 'newest_first',
        may_have_more: messages.length === limit,
        ...(messages.length === 0
          ? {}
          : {
              newest_id: messages[0]!.id,
              oldest_id: messages.at(-1)!.id,
              next_after: messages[0]!.id,
              next_before: messages.at(-1)!.id,
            }),
      };
    }
    if (name === 'messages_get') {
      const m = (await this.client.request(
        'GET',
        Routes.channelMessage(channel, message),
      )) as RawMessage;
      if (m?.id !== message) throw new GatewayError('INVALID_UPSTREAM_IDENTITY');
      return {
        message_id: m.id,
        channel_id: channel,
        ...validMessage(m, channel),
        pinned: m.pinned ?? false,
      };
    }
    if (name === 'messages_send') {
      const body = {
        content: args.content,
        tts: args.tts ?? false,
        allowed_mentions: { parse: [], replied_user: false },
        ...(args.reply_to_message_id === undefined
          ? {}
          : {
              message_reference: {
                message_id: args.reply_to_message_id,
                channel_id: channel,
                fail_if_not_exists: true,
              },
            }),
      };
      const m = (await this.client.request('POST', Routes.channelMessages(channel), body)) as {
        id: string;
        channel_id: string;
        timestamp: string;
      };
      try {
        validatePage([m.id], 1);
        if (m.channel_id !== channel || !Number.isFinite(Date.parse(m.timestamp)))
          throw new Error('Invalid send');
      } catch {
        throw new GatewayError('WRITE_OUTCOME_UNKNOWN');
      }
      return {
        message_id: m.id,
        channel_id: channel,
        timestamp: m.timestamp,
        jump_url: `https://discord.com/channels/${proofGuild ?? '@me'}/${channel}/${m.id}`,
      };
    }
    if (name === 'messages_create_thread') {
      const t = (await this.client.request('POST', Routes.threads(channel, message), {
        name: args.name,
        ...(args.auto_archive_duration === undefined
          ? {}
          : { auto_archive_duration: args.auto_archive_duration }),
        ...(args.rate_limit_per_user === undefined
          ? {}
          : { rate_limit_per_user: args.rate_limit_per_user }),
      })) as Channel;
      try {
        validatePage([t.id], 1);
        if (t.parent_id !== channel || ![10, 11].includes(t.type) || typeof t.name !== 'string')
          throw new Error('Invalid thread');
      } catch {
        throw new GatewayError('WRITE_OUTCOME_UNKNOWN');
      }
      return { thread_id: t.id, name: t.name, parent_id: t.parent_id };
    }
    if (name === 'users_create_dm') {
      const c = (await this.client.request('POST', Routes.userChannels(), {
        recipient_id: args.recipient_id,
      })) as Channel;
      try {
        validatePage([c.id], 1);
        if (
          c.type !== 1 ||
          c.guild_id !== undefined ||
          c.recipients?.length !== 1 ||
          c.recipients[0]?.id !== this.config.owner
        )
          throw new Error('Invalid DM');
      } catch {
        throw new GatewayError('WRITE_OUTCOME_UNKNOWN');
      }
      return { channel_id: c.id, type: 1, recipient_ids: [this.config.owner] };
    }
    if (name === 'reactions_list') return this.reactors(args, args.after);
    if (name === 'reactions_verify_owner') {
      let after: string | undefined;
      for (let page = 1; page <= 10; page++) {
        let data: Awaited<ReturnType<DiscordAdapter['reactors']>>;
        try {
          data = await this.reactors(args, after, 100);
        } catch (error) {
          if (!this.client.signal.aborted) throw error;
          return {
            owner_id: this.config.owner,
            present: false,
            complete: false,
            pages_checked: page - 1,
            type: args.type ?? 0,
          };
        }
        const present = data.users.some((u) => u.user_id === this.config.owner);
        if (present || !data.may_have_more || page === 10)
          return {
            owner_id: this.config.owner,
            present,
            complete: present || !data.may_have_more,
            pages_checked: page,
            type: args.type ?? 0,
          };
        after = data.next_after;
      }
    }
    if (name === 'reactions_create' || name === 'reactions_delete_own') {
      await this.client.request(
        name === 'reactions_create' ? 'PUT' : 'DELETE',
        Routes.channelMessageOwnReaction(channel, message, args.emoji!),
      );
      return {
        channel_id: channel,
        message_id: message,
        emoji: args.emoji!,
        ...(name === 'reactions_create' ? { reacted: true } : { deleted: true }),
      };
    }
    if (name.startsWith('channels_list_')) {
      const joined = name === 'channels_list_joined_private_archived_threads';
      const privateMode = name === 'channels_list_private_archived_threads';
      const limit = args.limit ?? 100;
      const query = new URLSearchParams({
        limit: String(joined ? limit : Math.min(limit + 1, 100)),
      });
      if (args.before) query.set('before', args.before);
      const path = joined
        ? Routes.channelJoinedArchivedThreads(channel)
        : Routes.channelThreads(channel, privateMode ? 'private' : 'public');
      const raw = (await this.client.request('GET', path, undefined, query)) as {
        threads: Channel[];
        has_more?: boolean;
      };
      if (
        !Array.isArray(raw?.threads) ||
        raw.threads.some((t) => !(joined || privateMode ? [12] : [10, 11]).includes(t.type))
      )
        throw new GatewayError('INVALID_UPSTREAM_RESPONSE');
      const page = archivePageContract(raw, channel, limit, args.before, joined, [
        this.config.guild,
      ]);
      const threads = page.threads.map((t) => ({
        ...channelTags(t),
        id: t.id,
        name: t.name,
        type: t.type,
        parent_id: t.parent_id ?? null,
        owner_id: t.owner_id ?? null,
        archive_timestamp: t.thread_metadata?.archive_timestamp ?? null,
      }));
      return {
        threads,
        count: threads.length,
        channel_id: channel,
        has_more: page.has_more,
        complete: page.complete,
        ...(page.next_before === undefined ? {} : { next_before: page.next_before }),
      };
    }
    if (name === 'threads_set_archived') {
      const t = (await this.client.request('PATCH', Routes.channel(channel), {
        archived: args.archived,
      })) as Channel;
      if (
        t?.id !== channel ||
        ![10, 11, 12].includes(t.type) ||
        !this.config.parents.some((id) => id === t.parent_id) ||
        t.guild_id !== this.config.guild ||
        typeof t.thread_metadata?.archived !== 'boolean'
      )
        throw new GatewayError('WRITE_OUTCOME_UNKNOWN');
      return {
        id: t.id,
        parent_id: t.parent_id,
        archived: t.thread_metadata.archived,
        locked: t.thread_metadata.locked ?? false,
      };
    }
    throw new GatewayError('TOOL_NOT_AVAILABLE');
  }
}
