import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { OWNER_TOOL_NAMES } from '../../mcp-core/src/middleware/owner-scope.js';
import { gateway } from '../worker/index.js';
import { parent } from './fixtures.js';

describe('actual MCP SDK discovery contract', () => {
  it.each([
    'legacy',
    '2026-07-28',
  ])('connects, lists all15 and receives a disabled result: %s', async (protocol) => {
    const client = new Client(
      { name: 'synthetic-gateway-test', version: '1' },
      {
        capabilities: {},
        ...(protocol === 'legacy'
          ? {}
          : { versionNegotiation: { mode: { pin: '2026-07-28' as const } } }),
      },
    );
    const transport = new StreamableHTTPClientTransport(new URL('https://gateway.example/mcp'), {
      fetch: async (input, init) =>
        gateway(new Request(input, init), {}, async () => {
          throw new Error('Upstream forbidden');
        }),
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(new Set(listed.tools.map((t) => t.name))).toEqual(
        new Set([...OWNER_TOOL_NAMES].map((t) => `discord_${t}`)),
      );
      const called = await client.callTool({
        name: 'discord_channels_get',
        arguments: { channel_id: parent },
      });
      expect(called).toMatchObject({
        isError: true,
        structuredContent: { code: 'CONNECTOR_DISABLED' },
      });
    } finally {
      await client.close();
    }
  });
});
