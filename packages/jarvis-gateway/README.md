# Jarvis Gateway Worker

Owner-private, stateless Sites MCP adapter with Discord as its first supported connector. This package deliberately does not run the Node server, a Gateway client or a dynamic proxy. It exposes exactly 15 namespaced `discord_*` tools from the owner surface; all actual calls fail closed until approved server configuration is present. Commons Reservations remains independent.

The adapter shares the existing owner-DM/thread policy, message projection, snowflake/page validation and archive contract with `@discord-mcp/core`. A thin native `fetch` client replaces Node REST/pieces/server lifecycle. Build output is self-contained ESM with no external runtime imports; tests execute it in workerd without `nodejs_compat` and mock all outbound Discord requests.

## Build and verification

From the repository root, with the pinned pnpm lockfile:

```sh
pnpm install --frozen-lockfile --filter @discord-mcp/jarvis-gateway
pnpm --filter @discord-mcp/jarvis-gateway typecheck
pnpm --filter @discord-mcp/jarvis-gateway build
pnpm --filter @discord-mcp/jarvis-gateway test
pnpm --filter @discord-mcp/jarvis-gateway validate
```

`dist/server/index.js` and `dist/.openai/hosting.json` use the verified Sites Worker ESM artifact layout. The public hosting manifest is an identity-free template. `dist/build-evidence.json` records bundle bytes/input modules and verifies no external/Node server imports. The Miniflare test uses an outbound mock service; tests never inherit real tokens from the developer environment. Run affected core regressions after shared helper changes.

The standalone extension skill is [skills/add-gateway-connector/SKILL.md](skills/add-gateway-connector/SKILL.md). Sites currently provisions a plugin from tool discovery and offers no supported skill-bundle field, so this folder is delivered as a separate installable Codex package. Copy the whole folder into the user's configured skills directory only when installation is authorized. It is not an OAuth grant or automatic connector installer.

## Native identity and configuration

Deploy only through the owner-private Sites workflow. Sites owns sign-in, checks the Site audience and injects `oai-authenticated-user-id`. Never expose this Worker on a separate workers.dev/public route accepting forged headers. This Site's opaque user ID differs from account-global IDs and other Sites' identities; never copy Commons' principal.

| Binding | Purpose and approval boundary |
|---|---|
| `JARVIS_SITE_ORIGIN` | Exact returned HTTPS Site origin, no path/trailing slash; metadata, not an upstream URL selector |
| `JARVIS_OWNER_PRINCIPAL` | Exact owner identity from authenticated access to this Site; no first-visitor persistence |
| `JARVIS_DISCORD_ENABLED` | Default disabled; only literal `true` activates an approved connector |
| `JARVIS_DISCORD_SCOPES` | Explicit `discord.read` initially; optional `discord.write` requires separate operator approval |
| `DISCORD_TOKEN` | Existing approved bot token, server-only native secret with `is_secret:true`; never source or browser input |
| `DISCORD_EXPECTED_BOT_ID` | Pinned expected bot account ID, verified before each tool operation |
| `ALLOWED_GUILDS` | One explicitly approved guild for this adapter |
| `MCP_OWNER_USER_ID` | Exact Discord owner for the type-1 DM exception and reaction verification |
| `MCP_ALLOWED_CHANNEL_IDS` | Approved parent channels only; their verified accessible child threads are allowed |
| `JARVIS_LOG_ERRORS` | Default off; optional literal `true` emits fixed error code/tool/request ID only |

Static `server/discover`, legacy initialize and `tools/list` need no credential or upstream request. Sites needs this to provision its plugin; metadata is not permission to invoke tools. Calls require the configured owner, connector activation, scope and strict schemas. `/control` is a private metadata-only bootstrap for viewing the dispatcher-supplied Site identity; it does not store an identity, log in to Discord or grant access. `/healthz` proves Worker/configuration state only, not guild/content permissions.

Every write also requires `__approve:true` after exact human authorization in the caller workflow. This Boolean and an application scope are technical restrictions, not a tamper-proof browser approval receipt. Leave writes disabled when a stronger approval mechanism is required. There are no approval/login/purchase or arbitrary API tools. No test message or other live mutation is part of rollout.

## Discord surface and semantics

The original owner tool names are prefixed with `discord_`:

- Metadata: `channels_get`, `owner_list_channels`.
- Messages: `messages_read`, `messages_get`, `messages_send`, `messages_create_thread`.
- Owner DM: `users_create_dm`.
- Reactions: `reactions_list`, `reactions_verify_owner`, `reactions_create`, `reactions_delete_own`.
- Archives: `channels_list_public_archived_threads`, `channels_list_private_archived_threads`, `channels_list_joined_private_archived_threads`, `threads_set_archived`.

Unknown aliases, Node dispatchers/workflows, resource methods and caller-selected URLs/headers/credentials are unavailable. Each operation checks bot identity and freshly verifies guild/channel metadata. Only a type-1 DM whose sole recipient is the configured owner bypasses the guild allowlist. Group DMs/unrelated guilds/wrong-parent threads fail. Opening an existing DM still requires write scope.

Message and reactor pages reject duplicate/oversized/nonadvancing IDs before returning checkpoints; messages retain author, bot/webhook and reply-author identity. A full page means more may exist. Follow exclusive cursors and deduplicate; commit a monitoring high-water mark only after processing the full interval. Empty content is not evidence of privileged-content access or no messages. Active thread discovery from parent history/known IDs stays explicitly partial.

Archive timestamps preserve fractional precision, with lookahead and whole boundary groups to avoid skipping tied rows. Joined-private pages sort descending IDs. Modes retain separate cursors and authoritative exhaustion. Exact owner reaction verification searches up to ten 100-user pages within the overall deadline; incomplete absence is unknown, and `reaction.me` refers to the bot.

Replies use same-channel targets with `fail_if_not_exists:true`, `allowed_mentions.parse=[]` and `replied_user:false`. Archive mutations set only the required Boolean `archived`, preserving lock/tags. Success responses are schema/identity validated in production. Malformed or ambiguous mutation outcomes are nonretryable; reconcile before another attempt. No automatic upstream retries occur.

Requests cap input at 64KiB and each upstream/result payload at roughly 2MB, with a 30-second operation deadline and finite page/subrequest counts. Fixed HTTPS Discord origins and manual redirect rejection prevent credential forwarding. Errors contain stable code/retryability/recovery guidance and bounded HTTP status/retry-after metadata; never raw exceptions, bodies, tokens, headers or content. Reduce page limits instead of truncating rich fields or silently advancing a cursor after an error.

## Publication, approval and rollback

Creation alone does not publish or install a connected plugin. Persist the new actual Site ID in deployment-local `.openai/hosting.json`, outside this public template; preserve it on later updates. Prepare the reviewed self-contained bundle for the private managed source repository using the supported short-lived native source credential/protected-stdin workflow. Do not use automatic publish-on-push or copy a Commons credential. Save/deploy only the exact pushed source and matching artifact through the owner-private native operation when publication/access is approved.

First publish a disabled bootstrap if approved, verify owner-only access/static discovery and obtain this Site's principal. Then obtain separate approval for the bot secret, exact owner/targets/read-only activation and native plugin connection. The secret goes to the selected Sites configuration platform/Worker, then Discord's HTTPS API. That token can act with the bot's intrinsic permissions beyond this application's allowed targets if compromised; application scopes do not narrow it at Discord. No credential field has been read/provisioned by this implementation.

Native Sites authentication requires no external OAuth provider for this adapter. Publishing with the `mcp` capability provisions or refreshes the Site's own plugin. Reuse that generated plugin and supported native authentication; do not create an unrelated OAuth client or register a local stdio server as a shortcut. Report publication, installed discovery and authorized real reads separately. Mock success is not a fixed Jarvis connector.

Retain a known-good source/artifact digest and runtime revision. A failed new connector can be disabled independently when authorized; code rollback does not restore runtime secrets/grants. Reconcile uncertain writes before retrying. Never rotate Commons' origin-bound storage key or reuse its database/session/identity to help this gateway. There is no Commons proxy or migration in this change.

## Attribution and references

Derived from cappyeo/discord-mcp v0.31.1 plus the reviewed owner profile; shared core source remains Apache-2.0. This new adapter's JSON-RPC/private-identity pattern was verified against the supported Sites capability documentation and the independently maintained Commons adapter, without copying any deployment identity, credential or runtime data. See repository `LICENSE`; bundled Zod and discord-api-types are MIT licensed (notices in `THIRD_PARTY_NOTICES.txt`).

Primary runtime reference: [Cloudflare Worker web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/). Follow the installed Sites skill's Worker ESM, identity and MCP capability references for the current native publication contract.
