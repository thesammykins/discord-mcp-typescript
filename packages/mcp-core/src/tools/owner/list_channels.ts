import { container } from '@sapphire/pieces';
import { Routes } from 'discord-api-types/v10';
import { z } from 'zod';
import { CHANNEL_READ_ACCESS } from '../../access/requirements.js';
import { OwnerScopeError } from '../../middleware/owner-scope.js';
import { defineTool } from '../_lib/defineTool.js';
import { dualResult } from '../_lib/response.js';
import { ChannelId } from '../_lib/snowflake.js';
export default defineTool({
  name: 'owner_list_channels',
  category: 'owner',
  access: { ...CHANNEL_READ_ACCESS, verification: 'delegated' },
  description:
    'Read metadata only for configured parent channels. No guild-wide enumeration. Active threads must be learned from scoped history/references; that coverage is partial.',
  inputSchema: {},
  outputSchema: {
    channels: z.array(
      z.object({ id: ChannelId, name: z.string().nullable(), type: z.number().int() }),
    ),
    active_thread_coverage: z.literal('partial_parent_history_and_known_ids'),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  idempotent: true,
  handler: async () => {
    const ids = container.config.MCP_ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()) ?? [];
    const guilds = container.config.ALLOWED_GUILDS?.split(',').map((id) => id.trim()) ?? [];
    const channels = [];
    for (const id of ids) {
      const c = (await container.rest.get(Routes.channel(id))) as {
        id: string;
        guild_id: string;
        name?: string;
        type: number;
      };
      if (c.id !== id || !guilds.includes(c.guild_id) || [1, 3, 10, 11, 12].includes(c.type))
        throw new OwnerScopeError('Approved parent metadata mismatch');
      channels.push({ id: c.id, name: c.name ?? null, type: c.type });
    }
    return dualResult({
      text: `${channels.length} approved parent channels; active thread coverage is partial.`,
      data: { channels, active_thread_coverage: 'partial_parent_history_and_known_ids' },
    });
  },
});
