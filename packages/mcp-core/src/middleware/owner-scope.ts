import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { Config } from '../config.js';
import { DiscordClientError } from '../errors/base.js';

export const OWNER_TOOL_NAMES: ReadonlySet<string> = new Set([
  'channels_get',
  'owner_list_channels',
  'messages_read',
  'messages_get',
  'messages_send',
  'messages_create_thread',
  'users_create_dm',
  'reactions_list',
  'reactions_verify_owner',
  'reactions_create',
  'reactions_delete_own',
  'channels_list_public_archived_threads',
  'channels_list_private_archived_threads',
  'channels_list_joined_private_archived_threads',
  'threads_set_archived',
]);
export const OWNER_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'messages_send',
  'messages_create_thread',
  'users_create_dm',
  'reactions_create',
  'reactions_delete_own',
  'threads_set_archived',
]);
const DM_TOOLS = new Set([
  'channels_get',
  'messages_read',
  'messages_get',
  'messages_send',
  'reactions_list',
  'reactions_verify_owner',
  'reactions_create',
  'reactions_delete_own',
]);
export class OwnerScopeError extends DiscordClientError {
  public readonly code = 'OWNER_SCOPE_REJECTED';
  public readonly retriable = false;
  public override recoveryHint =
    'Use the configured owner, approved parent or its accessible child thread; do not widen the deployment scope.';
}
interface Channel {
  id: string;
  type: number;
  guild_id?: string;
  parent_id?: string;
  recipients?: { id: string }[];
}
export class OwnerScopePolicy {
  readonly parents: ReadonlySet<string>;
  constructor(
    private readonly config: Pick<
      Config,
      'MCP_ALLOWED_CHANNEL_IDS' | 'MCP_OWNER_USER_ID' | 'ALLOWED_GUILDS'
    >,
    private readonly rest: Pick<REST, 'get'>,
  ) {
    this.parents = new Set(config.MCP_ALLOWED_CHANNEL_IDS?.split(',').map((id) => id.trim()));
  }
  async authorize(tool: string, value: unknown): Promise<string | undefined> {
    if (!OWNER_TOOL_NAMES.has(tool))
      throw new OwnerScopeError('Tool is outside the owner monitoring surface');
    const args = value as Record<string, unknown>;
    if (tool === 'users_create_dm') {
      if (args.recipient_id !== this.config.MCP_OWNER_USER_ID)
        throw new OwnerScopeError('DM recipient is not the configured owner');
      return;
    }
    if (tool === 'owner_list_channels') return;
    if (tool === 'reactions_verify_owner' && args.owner_id !== this.config.MCP_OWNER_USER_ID)
      throw new OwnerScopeError('Reactor identity is not the configured owner');
    const id = args.channel_id;
    if (typeof id !== 'string') throw new OwnerScopeError('A scoped channel ID is required');
    const channel = (await this.rest.get(Routes.channel(id))) as Channel;
    if (channel.id !== id) throw new OwnerScopeError('Discord channel identity mismatch');
    if (channel.type === 1) {
      if (
        !DM_TOOLS.has(tool) ||
        channel.guild_id !== undefined ||
        channel.recipients?.length !== 1 ||
        channel.recipients[0]?.id !== this.config.MCP_OWNER_USER_ID
      )
        throw new OwnerScopeError('Channel is not the configured owner DM');
      return;
    }
    const guilds = this.config.ALLOWED_GUILDS?.split(',').map((id) => id.trim()) ?? [];
    if (channel.guild_id === undefined || !guilds.includes(channel.guild_id))
      throw new OwnerScopeError('Channel belongs to an unapproved guild');
    if (this.parents.has(id)) {
      if ([10, 11, 12].includes(channel.type))
        throw new OwnerScopeError('Configure parent channels, not thread IDs');
      if (tool === 'threads_set_archived')
        throw new OwnerScopeError('Archive operation requires a child thread');
      return channel.guild_id;
    }
    if (
      ![10, 11, 12].includes(channel.type) ||
      channel.parent_id === undefined ||
      !this.parents.has(channel.parent_id)
    )
      throw new OwnerScopeError('Channel is not an accessible child of an approved parent');
    if (tool.startsWith('channels_list_') || tool === 'messages_create_thread')
      throw new OwnerScopeError('Operation requires an approved parent channel');
    return channel.guild_id;
  }
}
