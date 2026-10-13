import { DiscordAPIError, HTTPError, RateLimitError } from '@discordjs/rest';
import { container } from '@sapphire/pieces';
import { TaskCancelledError } from 'cockatiel';
import { Routes } from 'discord-api-types/v10';
import { z } from 'zod';
import { MessageOutcomeUnknown } from '../../errors/client.js';
import { classifyDiscordError } from '../../rest/errors.js';
import { defineTool } from '../_lib/defineTool.js';
import { messageJumpUrl } from '../_lib/message-jump-url.js';
import { validatePage } from '../_lib/page.js';
import { dualResult } from '../_lib/response.js';
import { ChannelId, MessageId } from '../_lib/snowflake.js';

interface DiscordMessageResponse {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  guild_id?: string;
}

export default defineTool({
  name: 'messages_send',
  category: 'messages',
  description: [
    '**Purpose**: Send a plain-text message to a Discord channel.',
    '',
    '**When to use**:',
    '- Reply to user request like "send X to #channel".',
    '- Programmatic announcements without rich layout.',
    '',
    '**When NOT to use**:',
    '- Rich layout (containers, sections, media galleries) → use `components_v2_send`.',
    '- High-volume delivery → use `webhooks_execute` (avoids bot rate limit).',
    '',
    '**Example**: `{channel_id:"112233445566778899", content:"hello"}`',
    '',
    '**Returns**: `{message_id, channel_id, jump_url, timestamp}`.',
  ].join('\n'),
  inputSchema: {
    channel_id: ChannelId.describe('Target channel ID'),
    content: z
      .string()
      .min(1, 'content required (max 2000 chars)')
      .max(2000, 'content max 2000 chars')
      .describe('Message text content (max 2000 chars).'),
    tts: z.boolean().optional().describe('Text-to-speech, default false'),
    reply_to_message_id: MessageId.optional().describe(
      'Same-channel reply target; fails if missing',
    ),
  },
  outputSchema: {
    message_id: MessageId,
    channel_id: ChannelId,
    jump_url: z.string().url(),
    timestamp: z.string(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (args) => {
    let msg: DiscordMessageResponse;
    try {
      msg = (await container.rest.post(Routes.channelMessages(args.channel_id), {
        body: {
          content: args.content,
          tts: args.tts ?? false,
          allowed_mentions: { parse: [], replied_user: false },
          ...(args.reply_to_message_id === undefined
            ? {}
            : {
                message_reference: {
                  message_id: args.reply_to_message_id,
                  channel_id: args.channel_id,
                  fail_if_not_exists: true,
                },
              }),
        },
      })) as DiscordMessageResponse;
    } catch (error) {
      if (
        error instanceof TaskCancelledError ||
        classifyDiscordError(error, { method: 'post' })?.replaySafe === false ||
        (!(error instanceof DiscordAPIError) &&
          !(error instanceof HTTPError) &&
          !(error instanceof RateLimitError) &&
          classifyDiscordError(error, { method: 'post' }) === null)
      )
        throw new MessageOutcomeUnknown(
          'Message outcome is unknown; inspect channel history before another send',
        );
      throw error;
    }
    try {
      if (
        msg === null ||
        typeof msg !== 'object' ||
        msg.channel_id !== args.channel_id ||
        typeof msg.timestamp !== 'string' ||
        !Number.isFinite(Date.parse(msg.timestamp))
      )
        throw new Error('Invalid send response');
      validatePage([msg.id], 1);
    } catch {
      throw new MessageOutcomeUnknown(
        'Discord send response is incomplete or mismatched; reconcile channel history before another send',
      );
    }

    return dualResult({
      text: `Sent message ${msg.id} to <#${msg.channel_id}>.`,
      data: {
        message_id: msg.id,
        channel_id: msg.channel_id,
        jump_url: await messageJumpUrl(msg),
        timestamp: msg.timestamp,
      },
    });
  },
});
