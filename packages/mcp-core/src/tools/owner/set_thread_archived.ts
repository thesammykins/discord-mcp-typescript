import { container } from '@sapphire/pieces';
import { Routes } from 'discord-api-types/v10';
import { z } from 'zod';
import { CHANNEL_READ_ACCESS } from '../../access/requirements.js';
import { OwnerScopeError } from '../../middleware/owner-scope.js';
import { defineTool } from '../_lib/defineTool.js';
import { dualResult } from '../_lib/response.js';
import { ChannelId } from '../_lib/snowflake.js';
export default defineTool({
  access: { ...CHANNEL_READ_ACCESS, permissions: ['VIEW_CHANNEL', 'MANAGE_THREADS'] },
  name: 'threads_set_archived',
  category: 'threads',
  description:
    'Set only archived on a verified accessible child thread; returns authoritative state.',
  inputSchema: {
    channel_id: ChannelId.describe('Verified child thread ID'),
    archived: z.boolean().describe('Required JSON Boolean archive state'),
  },
  outputSchema: { id: ChannelId, parent_id: ChannelId, archived: z.boolean(), locked: z.boolean() },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  idempotent: true,
  handler: async (args) => {
    const t = (await container.rest.patch(Routes.channel(args.channel_id), {
      body: { archived: args.archived },
    })) as {
      id: string;
      parent_id: string;
      guild_id: string;
      type: number;
      thread_metadata: { archived: boolean; locked?: boolean };
    };
    const parents =
      container.config.MCP_ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()) ?? [];
    const guilds = container.config.ALLOWED_GUILDS?.split(',').map((id) => id.trim()) ?? [];
    if (
      t.id !== args.channel_id ||
      ![10, 11, 12].includes(t.type) ||
      !parents.includes(t.parent_id) ||
      !guilds.includes(t.guild_id) ||
      typeof t.thread_metadata?.archived !== 'boolean'
    )
      throw new OwnerScopeError('Archive response identity/state mismatch; reconcile before retry');
    return dualResult({
      text: 'Thread archive state updated.',
      data: {
        id: t.id,
        parent_id: t.parent_id,
        archived: t.thread_metadata.archived,
        locked: t.thread_metadata.locked ?? false,
      },
    });
  },
});
