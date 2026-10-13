import type { Config } from '@discord-mcp/core';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

/** Caller OAuth is separate from the Discord bot credential; no grants are minted here. */
export function ownerAuth(config: Config, key?: JWTVerifyGetKey) {
  const resource = new URL(config.MCP_PUBLIC_URL ?? '');
  const issuer = new URL(config.MCP_OAUTH_ISSUER ?? '');
  const jwks = new URL(config.MCP_OAUTH_JWKS_URI ?? '');
  for (const url of [resource, issuer, jwks]) {
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error(
        'Owner OAuth URLs require HTTPS and no embedded credentials, query or fragment',
      );
  }
  if (resource.pathname !== '/mcp' || !config.MCP_OAUTH_OWNER_SUBJECT)
    throw new Error('Owner OAuth requires canonical /mcp resource and exact owner subject');
  const verifyKey =
    key ?? createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000 });
  const metadata = {
    resource: resource.href,
    authorization_servers: [config.MCP_OAUTH_ISSUER!],
    scopes_supported: ['discord.read', 'discord.write'],
    bearer_methods_supported: ['header'],
  };
  return {
    origin: resource.origin,
    metadata,
    challenge: `Bearer resource_metadata="${resource.origin}/.well-known/oauth-protected-resource", scope="discord.read"`,
    async verify(authorization: string | undefined): Promise<ReadonlySet<string> | undefined> {
      const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
      if (token === undefined || token.length > 16384) return;
      try {
        const { payload } = await jwtVerify(token, verifyKey, {
          issuer: config.MCP_OAUTH_ISSUER!,
          audience: resource.href,
          subject: config.MCP_OAUTH_OWNER_SUBJECT!,
          algorithms: ['RS256'],
          requiredClaims: ['exp', 'sub', 'aud', 'iss'],
          clockTolerance: 5,
        });
        if (typeof payload.scope !== 'string') return;
        return new Set(payload.scope.split(/\s+/));
      } catch {
        // Never forward JWT, JWKS, provider, URL or claim exceptions to logs/responses.
        return;
      }
    },
  };
}
