import { z } from 'zod';
import { ChannelId, GuildId, UserId } from '../../mcp-core/src/tools/_lib/snowflake.js';

export interface Bindings {
  JARVIS_SITE_ORIGIN?: string;
  JARVIS_OWNER_PRINCIPAL?: string;
  JARVIS_DISCORD_ENABLED?: string;
  JARVIS_DISCORD_SCOPES?: string;
  DISCORD_TOKEN?: string;
  DISCORD_EXPECTED_BOT_ID?: string;
  ALLOWED_GUILDS?: string;
  MCP_OWNER_USER_ID?: string;
  MCP_ALLOWED_CHANNEL_IDS?: string;
  JARVIS_LOG_ERRORS?: string;
}
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    readonly retriable = false,
    readonly recovery_hint = 'Reconcile the scoped state before another consequential operation.',
    readonly upstream_status?: number,
    readonly retry_after_seconds?: number,
  ) {
    super(code);
  }
}
const configSchema = z.strictObject({
  origin: z.url().refine((value) => {
    const u = new URL(value);
    return u.protocol === 'https:' && u.origin === value;
  }),
  principal: z.string().min(1).max(256),
  token: z.string().min(20).max(16384),
  bot: UserId,
  guild: GuildId,
  owner: UserId,
  parents: z.array(ChannelId).min(1).max(32),
  scopes: z.array(z.enum(['discord.read', 'discord.write'])).min(1),
});
export function configured(env: Bindings) {
  if (env.JARVIS_DISCORD_ENABLED !== 'true')
    throw new GatewayError(
      'CONNECTOR_DISABLED',
      false,
      'The operator must approve the exact Site secret/access configuration before activation.',
    );
  const value = configSchema.safeParse({
    origin: env.JARVIS_SITE_ORIGIN,
    principal: env.JARVIS_OWNER_PRINCIPAL,
    token: env.DISCORD_TOKEN,
    bot: env.DISCORD_EXPECTED_BOT_ID,
    guild: env.ALLOWED_GUILDS,
    owner: env.MCP_OWNER_USER_ID,
    parents: env.MCP_ALLOWED_CHANNEL_IDS?.split(',').map((x) => x.trim()),
    scopes: env.JARVIS_DISCORD_SCOPES?.split(',').map((x) => x.trim()),
  });
  if (!value.success || !value.data.scopes.includes('discord.read'))
    throw new GatewayError(
      'GATEWAY_NOT_CONFIGURED',
      false,
      'Configure an approved owner principal, target restriction and read scope; do not widen access to bypass this failure.',
    );
  return value.data;
}
export type Configuration = ReturnType<typeof configured>;
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export async function limitedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal?: AbortSignal,
): Promise<string> {
  if (body === null) return '';
  const reader = body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  let rejectAbort: (error: GatewayError) => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort(
      new GatewayError(
        'REQUEST_TIMEOUT',
        false,
        'The request deadline/cancellation stopped the read; no incomplete page should advance a checkpoint.',
      ),
    );
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal?.aborted) {
      void reader.cancel().catch(() => {});
      throw new GatewayError('REQUEST_TIMEOUT');
    }
    for (;;) {
      const item = await Promise.race([reader.read(), aborted]);
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => {});
        throw new GatewayError(
          'PAYLOAD_TOO_LARGE',
          false,
          'Reduce the requested page/payload size.',
        );
      }
      chunks.push(item.value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(result);
}
export class DiscordClient {
  constructor(
    private readonly config: Configuration,
    private readonly fetcher: Fetcher,
    readonly signal: AbortSignal,
  ) {}
  async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: URLSearchParams,
  ): Promise<unknown> {
    // Paths are constructed by fixed handlers; no absolute URL, headers or endpoint input.
    if (
      !path.startsWith('/') ||
      path.includes('..') ||
      /[?#\\]/.test(path) ||
      !(
        /^\/channels\/\d{17,20}(?:\/.*)?$/.test(path) ||
        path === '/users/%40me' ||
        path === '/users/@me/channels'
      )
    )
      throw new GatewayError('ROUTE_REJECTED');
    const url = new URL(`https://discord.com/api/v10${path}`);
    if (query) url.search = query.toString();
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        redirect: 'manual',
        signal: this.signal,
        headers: {
          Authorization: `Bot ${this.config.token.replace(/^Bot /, '')}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new GatewayError(
        method === 'GET' ? 'UPSTREAM_UNAVAILABLE' : 'WRITE_OUTCOME_UNKNOWN',
        method === 'GET',
      );
    }
    if (response.status >= 300 && response.status < 400)
      throw new GatewayError(
        method === 'GET' ? 'UPSTREAM_REDIRECT_REJECTED' : 'WRITE_OUTCOME_UNKNOWN',
      );
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retry) && retry >= 0 ? Math.min(retry, 3600) : undefined;
      throw new GatewayError(
        response.status === 429
          ? 'UPSTREAM_RATE_LIMITED'
          : response.status >= 500 && method !== 'GET'
            ? 'WRITE_OUTCOME_UNKNOWN'
            : 'UPSTREAM_REJECTED',
        response.status === 429 || (response.status >= 500 && method === 'GET'),
        undefined,
        response.status,
        delay,
      );
    }
    if (response.status === 204) return null;
    try {
      return JSON.parse(await limitedText(response.body, 2_000_000, this.signal));
    } catch (error) {
      if (method !== 'GET') throw new GatewayError('WRITE_OUTCOME_UNKNOWN');
      if (error instanceof GatewayError) throw error;
      throw new GatewayError('INVALID_UPSTREAM_RESPONSE');
    }
  }
  async identity() {
    const bot = (await this.request('GET', '/users/%40me')) as { id?: string; bot?: boolean };
    if (bot?.id !== this.config.bot || bot.bot !== true)
      throw new GatewayError(
        'BOT_IDENTITY_MISMATCH',
        false,
        'Verify the approved token belongs to the configured bot before enabling this connector.',
      );
  }
}
