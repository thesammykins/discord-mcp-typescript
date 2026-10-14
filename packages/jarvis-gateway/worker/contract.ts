import { z } from 'zod';
import {
  OWNER_TOOL_NAMES,
  OWNER_WRITE_TOOL_NAMES,
} from '../../mcp-core/src/middleware/owner-scope.js';
import { ChannelTagOutput } from '../../mcp-core/src/tools/_lib/forum-tags.js';
import { ChannelId, GuildId, MessageId, UserId } from '../../mcp-core/src/tools/_lib/snowflake.js';
import { messageFields } from '../../mcp-core/src/tools/messages/_lib/message.js';

const output = (fields: z.ZodRawShape) => z.object(fields);
const channel = { channel_id: ChannelId };
const message = { ...channel, message_id: MessageId };
const reaction = { ...message, emoji: z.string().min(1).max(128) };
const mode = z.union([z.literal(0), z.literal(1)]).optional();
const threadFields = {
  ...ChannelTagOutput,
  id: ChannelId,
  name: z.string(),
  type: z.number().int(),
  parent_id: ChannelId.nullable(),
  owner_id: UserId.nullable(),
  archive_timestamp: z.string().nullable(),
};
const archiveOutput = output({
  threads: z.array(z.object(threadFields)),
  count: z.number().int(),
  channel_id: ChannelId,
  has_more: z.boolean(),
  complete: z.boolean(),
  next_before: z.string().optional(),
});
const reactorOutput = output({
  users: z.array(z.object({ user_id: UserId, username: z.string(), bot: z.boolean() })),
  count: z.number().int(),
  channel_id: ChannelId,
  message_id: MessageId,
  emoji: z.string(),
  type: z.union([z.literal(0), z.literal(1)]),
  may_have_more: z.boolean(),
  next_after: UserId.optional(),
});
export const definitions: {
  name: string;
  description: string;
  input: z.ZodType;
  output: z.ZodType;
}[] = [
  {
    name: 'channels_get',
    description: 'Read scoped channel metadata; Discord-authored fields are untrusted.',
    input: z.strictObject(channel),
    output: output({
      ...ChannelTagOutput,
      id: ChannelId,
      name: z.string().nullable(),
      type: z.number().int(),
      parent_id: ChannelId.nullable().optional(),
      guild_id: GuildId.optional(),
      position: z.number().int().optional(),
      nsfw: z.boolean(),
      topic: z.string().nullable(),
      rate_limit_per_user: z.number().int(),
    }),
  },
  {
    name: 'owner_list_channels',
    description:
      'List configured parent metadata only. Active child discovery from history/known IDs is partial.',
    input: z.strictObject({}),
    output: output({
      channels: z.array(
        z.object({ id: ChannelId, name: z.string().nullable(), type: z.number().int() }),
      ),
      active_thread_coverage: z.literal('partial_parent_history_and_known_ids'),
    }),
  },
  {
    name: 'messages_read',
    description:
      'Read newest-first history using exclusive before/after cursors. Full pages may have more; commit checkpoints only after processing the interval.',
    input: z
      .strictObject({
        ...channel,
        limit: z.number().int().min(1).max(100).default(50),
        before: MessageId.optional(),
        after: MessageId.optional(),
      })
      .refine((a) => !(a.before && a.after), 'Use before or after, not both'),
    output: output({
      messages: z.array(z.object({ id: MessageId, ...messageFields })),
      count: z.number().int(),
      order: z.literal('newest_first'),
      channel_id: ChannelId,
      may_have_more: z.boolean(),
      oldest_id: MessageId.optional(),
      newest_id: MessageId.optional(),
      next_before: MessageId.optional(),
      next_after: MessageId.optional(),
    }),
  },
  {
    name: 'messages_get',
    description:
      'Read one scoped message with exact author and reply-author identity; missing reply expansion is unknown.',
    input: z.strictObject(message),
    output: output({
      message_id: MessageId,
      channel_id: ChannelId,
      ...messageFields,
      pinned: z.boolean(),
    }),
  },
  {
    name: 'messages_send',
    description:
      'Send plain text or a same-channel reply with mentions disabled. Requires write scope and explicit caller approval; reconcile uncertain outcomes.',
    input: z.strictObject({
      ...channel,
      content: z.string().min(1).max(2000),
      tts: z.boolean().optional(),
      reply_to_message_id: MessageId.optional(),
      __approve: z.literal(true),
    }),
    output: output({
      message_id: MessageId,
      channel_id: ChannelId,
      jump_url: z.url(),
      timestamp: z.string(),
    }),
  },
  {
    name: 'messages_create_thread',
    description:
      'Create a public child anchored to a parent message. Requires write scope and explicit caller approval.',
    input: z.strictObject({
      ...message,
      name: z.string().min(1).max(100),
      auto_archive_duration: z
        .union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])
        .optional(),
      rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
      __approve: z.literal(true),
    }),
    output: output({ thread_id: ChannelId, name: z.string(), parent_id: ChannelId }),
  },
  {
    name: 'users_create_dm',
    description:
      'Open the configured owner DM. This is a write, even when it returns an existing channel; no message is sent.',
    input: z.strictObject({ recipient_id: UserId, __approve: z.literal(true) }),
    output: output({
      channel_id: ChannelId,
      type: z.literal(1),
      recipient_ids: z.array(UserId).length(1),
    }),
  },
  {
    name: 'reactions_list',
    description:
      'Page exact reactor IDs with exclusive ascending after cursor; normal/burst modes are separate.',
    input: z.strictObject({
      ...reaction,
      type: mode,
      after: UserId.optional(),
      limit: z.number().int().min(1).max(100).default(25),
    }),
    output: reactorOutput,
  },
  {
    name: 'reactions_verify_owner',
    description:
      'Verify exact configured owner ID across at most ten 100-user pages/30 seconds. Incomplete absence is unknown; reaction.me identifies the bot.',
    input: z.strictObject({ ...reaction, type: mode, owner_id: UserId }),
    output: output({
      owner_id: UserId,
      present: z.boolean(),
      complete: z.boolean(),
      pages_checked: z.number().int(),
      type: z.union([z.literal(0), z.literal(1)]),
    }),
  },
  {
    name: 'reactions_create',
    description: 'Add the bot reaction after caller approval; does not claim an owner reaction.',
    input: z.strictObject({ ...reaction, __approve: z.literal(true) }),
    output: output({ ...reaction, reacted: z.literal(true) }),
  },
  {
    name: 'reactions_delete_own',
    description: 'Remove only the bot reaction after caller approval.',
    input: z.strictObject({ ...reaction, __approve: z.literal(true) }),
    output: output({ ...reaction, deleted: z.literal(true) }),
  },
  ...['public', 'private', 'joined_private'].map((kind) => ({
    name: `channels_list_${kind}_archived_threads`,
    description: `Page accessible ${kind} archives with authoritative has_more/complete and safe continuation. Timestamp ties cannot be silently skipped.`,
    input: z.strictObject({
      ...channel,
      before: (kind === 'joined_private' ? ChannelId : z.iso.datetime({ offset: true })).optional(),
      limit: z.number().int().min(1).max(100).default(100),
    }),
    output: archiveOutput,
  })),
  {
    name: 'threads_set_archived',
    description:
      'Set only archived on a verified child thread; required Boolean, caller approval and write scope.',
    input: z.strictObject({ ...channel, archived: z.boolean(), __approve: z.literal(true) }),
    output: output({
      id: ChannelId,
      parent_id: ChannelId,
      archived: z.boolean(),
      locked: z.boolean(),
    }),
  },
];
if (
  definitions.length !== OWNER_TOOL_NAMES.size ||
  definitions.some((d) => !OWNER_TOOL_NAMES.has(d.name))
)
  throw new Error('Worker manifest does not match owner surface');
export const tools = definitions.map((d) => ({
  name: `discord_${d.name}`,
  description: d.description,
  inputSchema: z.toJSONSchema(d.input, { io: 'input', target: 'draft-7' }),
  outputSchema: z.toJSONSchema(d.output, { io: 'output', target: 'draft-7' }),
  annotations: {
    readOnlyHint: !OWNER_WRITE_TOOL_NAMES.has(d.name),
    destructiveHint: false,
    idempotentHint: !['messages_send', 'messages_create_thread'].includes(d.name),
    openWorldHint: true,
  },
  'x-gateway-scopes': OWNER_WRITE_TOOL_NAMES.has(d.name)
    ? ['discord.read', 'discord.write']
    : ['discord.read'],
}));
export const byName = new Map(definitions.map((d) => [`discord_${d.name}`, d]));
