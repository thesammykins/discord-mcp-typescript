# Owner remote fork

This fork adds an opt-in, single-owner profile to cappyeo/discord-mcp v0.31.1 (upstream commit `7ed828f9979f261fbb3ce94c440a8f46c28b5716`, Apache-2.0). Legacy stdio and bearer HTTP remain available with their original defaults. The owner profile exposes exactly 15 tools and rejects every other invocation, including hidden meta dispatchers, workflows and resources.

## Authentication and scope

The server is an OAuth **resource server**, not an authorization server. It publishes RFC 9728 metadata and validates RS256 access JWTs against an operator-selected HTTPS JWKS. Tokens must have the exact configured issuer, canonical HTTPS `/mcp` audience, owner subject, expiry and `discord.read` scope. Six mutations additionally require `discord.write`. Wrong/expired tokens receive a bounded 401; missing scopes receive 403 before Discord. Tokens, claims, content and provider exceptions are not logged by the owner HTTP error handler. The Discord bot credential is separate and its bot ID is checked before listening.

An existing OAuth provider is a setup requirement. Confirm that it supports authorization-code with S256 PKCE, discovery, the connector's registration mechanism (pre-registration, client metadata or DCR), audience/resource binding and the two scopes. This implementation does not create accounts, applications, grants, signing keys or refresh tokens. Opaque-only access tokens are unsupported. Do not substitute a Discord token, a Commons token or an ID token for an access token. Short token lifetime and owner-only provider policy are required; provider revocation behavior and connector compatibility must be verified before production.

`ALLOWED_GUILDS` remains enforced. Every channel operation freshly verifies channel identity and guild. A child must be a type 10/11/12 thread of an approved parent. The only exception is a type-1 DM whose sole recipient is the configured owner; group DMs and unrelated DMs are rejected. Creating that DM is a write, so a read-only client needs an already-existing verified DM channel ID. `MCP_ALLOW_USER_SCOPED=true` cannot expand this profile. Categories/progressive mode cannot change its manifest.

| Tools | Access |
|---|---|
| `channels_get`, `owner_list_channels` | Read approved metadata |
| `messages_read`, `messages_get` | Read scoped history and reply/author identity |
| `reactions_list`, `reactions_verify_owner` | Page reactors; verify exact owner ID |
| `channels_list_public_archived_threads`, `channels_list_private_archived_threads`, `channels_list_joined_private_archived_threads` | Separate accessible archive modes |
| `messages_send`, `messages_create_thread`, `users_create_dm` | Owner write scope |
| `reactions_create`, `reactions_delete_own`, `threads_set_archived` | Owner write scope |

The owner grant authorizes the technical capability; Jarvis must still obtain the human authorization required for each consequential operation. No test sends or permission changes are part of setup.

## Hosting

Prepared option: a Node container on a private operator-managed host, loopback port 3000, existing HTTPS reverse proxy, and an approved OAuth provider. The upstream Docker image defaults to `catalog`; the supplied Compose override explicitly runs `serve --http`. A ChatGPT Site needs a separate platform adapter and must not receive trusted dispatcher headers from the open internet; this Node app cannot be dropped into the Commons Worker unchanged.

1. After host/provider decisions and exact provisioning approval, copy `.env.owner.example` to ignored `.env.owner`. Set only the approved bot, guild, owner, six parent IDs and provider metadata. Parent IDs must be channels, not thread IDs. Keep `MCP_TOOL_SURFACE=full`, no `MCP_CATEGORIES`, and the guild allowlist present. Synthetic template IDs are not real configuration.
2. Mount an **existing, approved** bot secret at `/run/secrets/discord_bot_token` using the host secret manager or an approved local secret file. Set the Compose interpolation variable `DISCORD_BOT_TOKEN_FILE` to that file's path without printing its contents. The Node user (UID 1000) must be able to read the mount. Never put credentials in shell arguments, `.env.owner`, Git, chat, build context or logs. Do not create a replacement bot or widen Discord permissions as a troubleshooting shortcut.
3. On the chosen host, after approval: `docker compose -f deploy/compose.owner.yaml build`, then `docker compose -f deploy/compose.owner.yaml up -d`. The image uses a pinned base, locked dependencies and a non-root runtime; Compose bounds CPU, memory, PIDs and log retention, drops capabilities and uses a read-only filesystem. **Container build/run was not validated on the current Mac because Docker is unavailable.**
4. Adapt the sample Caddy route to the approved domain/existing proxy. Preserve `Authorization`, MCP headers and response streaming; don't rewrite `/mcp`, cache MCP responses, expose port 3000 publicly, log bodies/headers or publish `/livez`. Enforce Host/Origin and connection/rate/time limits at the proxy. Keep 64KB request limits and bounded concurrency. TLS/domain/account provisioning is a separate approval.
5. `/livez` is a token-free, loopback-peer-only liveness probe. It proves startup/bot identity validation completed, not current guild access. `/healthz` requires owner read authentication. Verify parent and DM reads separately; health does not prove MESSAGE_CONTENT approval or archive permissions. REST-only startup cannot infer privileged message-content availability, so that state remains unknown.
6. Only after approved authentication/registration, configure the connector with the canonical HTTPS `/mcp` URL. Start with a read-only grant. Reconcile/reconnect stale registration only with approval, then compare installed discovery to the manifest above. Do not claim Jarvis fixed until installed discovery and authorized reads succeed.

Current setup blockers: Laconia's existing SSH configuration refers to a missing public-key file and its read-only probe returned `Permission denied (publickey)`. No remote runtime was verified or changed. Host selection, existing OAuth provider suitability and the connector registration flow remain unresolved. No ongoing credentials or grants have been provisioned.

## Monitoring checkpoints

Messages are returned newest-first with explicit newest/oldest IDs and `next_before`/`next_after`. For backfill, keep a fixed upper watermark and follow exclusive `before` cursors until exhausted; commit the high-water mark only after the whole interval is processed. For forward reads, continue exclusive `after` pages and deduplicate by channel/message ID. A full page only means `may_have_more`; fetch again. Rejecting duplicate/nonadvancing/oversized provider rows protects the checkpoint. Persist checkpoints in the caller, not in this stateless server; history changes/deletions are not a snapshot.

Author IDs, bot/webhook identity, edit time, reply references and referenced-author IDs are preserved. Missing reply expansion is `unknown`; explicit null is `deleted`. Empty content does not prove no message or no privileged-intent access. Learn active child thread IDs from scoped parent history/references or already-known IDs, then verify each child before reading it. Active-thread coverage is explicitly partial: Discord's active enumeration is guild-wide, so this profile does not silently scan unrelated parents.

Archive modes retain authoritative `has_more`, `complete` and safe `next_before`. Public/private timestamp cursors preserve fractional precision and only emit complete timestamp groups; lookahead rows are fetched but withheld for the next page. A group too large to page safely fails visibly rather than skipping it. Joined-private pages use descending snowflake IDs. Private access remains subject to membership/permissions. Never merge the three mode cursors.

Reactor pagination uses exclusive ascending user IDs and distinguishes normal (0) from burst (1). `reactions_verify_owner` compares exact user IDs, follows up to ten 100-user pages and has a 30-second budget. `present=false, complete=false` means **unknown**, not absent. `reaction.me` refers to the bot and is never proof of the owner's reaction. Reaction sets can change during pagination; reconcile before consequential decisions.

Messages send with `allowed_mentions.parse=[]`, `replied_user=false`, and optional same-channel `reply_to_message_id` with `fail_if_not_exists=true`. Incomplete/mismatched or ambiguous send/DM/thread-creation outcomes are nonretryable and require reconciliation to avoid duplicates. `threads_set_archived` accepts a required JSON Boolean and patches only `archived`; it returns authoritative state and does not change locking/tags.

## Diagnose partial exposure

The previous connector advertised `get_channel_info` and `list_channels`. Those names belong to the Java fork; this fork deliberately publishes the names above. They are not aliases. A missing tool from `tools/list` is a discovery/registration/transport/configuration problem before it is a Discord API problem.

Compare four layers: the local catalog/default profile, authenticated raw remote `tools/list`, the installed connector's discovered list, then individual authorized read results. If raw remote discovery has all 15 but Jarvis sees two, investigate stale connector registration/cache or upstream client exposure. If raw discovery is narrow, inspect owner variables/category/surface configuration and the deployed commit. If calls fail, distinguish OAuth 401/403 from structured `OWNER_SCOPE_REJECTED`, Discord 401/403/404/429, bot identity mismatch and malformed response diagnostics. Archive channel metadata is a separate `channels_get` read; list-archive permissions do not explain missing registration. Capture status/code/request ID and tool name only; never capture tokens or message bodies.

Production verification must cover all six approved parent metadata reads, paginated history, a known accessible child thread, an existing owner DM, an accessible archive page, and a known owner reaction by exact ID. Record inaccessible/empty/partial paths honestly. No sends, new DMs, reactions, archive mutations, grants or permission changes are implicit in those read checks.

## Reference and validation

Commons was inspected at commit `141b5c84bc5b0b5fca6c9d09035f7c0b31ad13aa`: its Python HTTPS MCP path separates the stored service credential from owner OAuth consent/grants; its private Site path uses trusted dispatcher identity and encrypted per-principal sessions. This fork adopts the credential separation and owner/resource binding without copying its credentials, grants, Site configuration or database. Its built-in OAuth authorization server and per-write browser approval UI are not implemented here; this smaller resource-server route depends on an approved compatible provider and Jarvis's human-approval workflow.

Verified primary references: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [Discord channel/messages/reactions/thread APIs](https://docs.discord.com/developers/resources/channel). Authorization discovery/provider behavior is tested locally with ephemeral synthetic JWTs; a real authorization-code/PKCE flow is not yet verified.

Run `pnpm --filter @discord-mcp/core build`, `pnpm --filter @discord-mcp/cli build`, both package typechecks, and both package Vitest suites. `server.owner-scope.test.ts` covers exact discovery/invocation scope and verified DM/thread reads; `owner-http.test.ts` uses actual loopback Streamable HTTP and SDK discovery/read/send with Discord mocked. Monitoring regressions cover exclusive cursors, timestamp ties/precision, reply identities and uncertain writes. No live Discord messages are sent by these suites.

### Recorded local evidence

On Node 24, the final core Vitest run passed 349 files / 1,792 tests; the SQLite catalog build suite passed 3 tests. The CLI Vitest run passed 123 files / 1,300 tests, with one pre-existing TODO. Both package typechecks and builds passed; changed TypeScript/JSON/script files pass Biome, and `git diff --check` passes. Compose YAML and entrypoint syntax were checked; no Docker image was executed.

The Mac CLI suite requires fixture isolation: upstream tests otherwise follow `/tmp` symlinks, exceed Unix socket path limits, and ignore XDG home fixtures on macOS. From the repository root, run it with a short real temporary path and the **test-only** preload:

```sh
TMPDIR=/private/tmp NODE_OPTIONS="--require=$(pwd)/scripts/test/macos-isolation.cjs" pnpm --filter @discord-mcp/cli exec vitest run --maxWorkers=3
```

The preload canonicalizes temp paths and maps fixture home directories for tests/child CLI processes. Do not use it for production. The first unisolated suite failed for these fixture reasons and two internal-versus-advertised tool-count diagnostics; the diagnostics were corrected and the complete isolated suite passes. Six exact synthetic local journal entries created by the initial tests were removed, preserving other evidence.

Independent review accepted the final scope/auth/pagination/uncertain-write and deployment changes with no remaining concrete implementation blocker. This is local validation only: TLS, container startup on the chosen host, a real authorization-code/PKCE grant, installed connector discovery, and authorized Discord reads remain unverified.
