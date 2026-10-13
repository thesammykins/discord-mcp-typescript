import { z } from 'zod';
import { CHANNEL_READ_ACCESS } from '../../access/requirements.js';
import { defineTool } from '../_lib/defineTool.js';
import { dualResult } from '../_lib/response.js';
import { ChannelId, MessageId, UserId } from '../_lib/snowflake.js';
import { readReactionPage } from '../reactions/list.js';
export default defineTool({
  access: { ...CHANNEL_READ_ACCESS, permissions: ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY'] },
  name: 'reactions_verify_owner',
  category: 'reactions',
  description:
    'Verify exact configured owner ID, never username or reaction.me. Searches up to ten pages; present=false and complete=false means unknown.',
  inputSchema: {
    channel_id: ChannelId,
    message_id: MessageId,
    owner_id: UserId,
    emoji: z.string().min(1).max(128),
    type: z.union([z.literal(0), z.literal(1)]).optional(),
  },
  outputSchema: {
    owner_id: UserId,
    present: z.boolean(),
    complete: z.boolean(),
    pages_checked: z.number().int(),
    type: z.union([z.literal(0), z.literal(1)]),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  idempotent: true,
  handler: async (args, ctx) => {
    let after: string | undefined;
    const budget = AbortSignal.timeout(30_000);
    for (let page = 1; page <= 10; page++) {
      ctx.signal.throwIfAborted();
      let result: Awaited<ReturnType<typeof readReactionPage>>;
      try {
        result = await readReactionPage(
          { ...args, limit: 100, ...(after === undefined ? {} : { after }) },
          AbortSignal.any([ctx.signal, budget]),
        );
      } catch (error) {
        ctx.signal.throwIfAborted();
        if (!budget.aborted) throw error;
        return dualResult({
          text: 'Owner reaction not yet determined: time budget reached.',
          data: {
            owner_id: args.owner_id,
            present: false,
            complete: false,
            pages_checked: page - 1,
            type: args.type ?? 0,
          },
        });
      }
      const data = result.structuredContent as {
        users: { user_id: string }[];
        next_after?: string;
        may_have_more: boolean;
      };
      const present = data.users.some((user) => user.user_id === args.owner_id);
      if (present || !data.may_have_more || page === 10 || budget.aborted)
        return dualResult({
          text: present
            ? 'Owner reaction verified.'
            : data.may_have_more
              ? 'Owner reaction not yet determined.'
              : 'Owner reaction absent in exhausted pages.',
          data: {
            owner_id: args.owner_id,
            present,
            complete: present || !data.may_have_more,
            pages_checked: page,
            type: args.type ?? 0,
          },
        });
      if (data.next_after === undefined || data.next_after === after)
        throw new Error('Reactor cursor did not advance');
      after = data.next_after;
    }
    throw new Error('Unreachable bounded reactor state');
  },
});
