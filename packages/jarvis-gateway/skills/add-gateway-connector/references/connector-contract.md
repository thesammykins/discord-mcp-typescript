# Connector contract

## Runtime fit

| Connector shape | Fit and required evidence |
|---|---|
| Stateless HTTPS REST/GraphQL | Good candidate when fixed destinations, Web APIs, bounded requests and explicit identity/target policy suffice. Discord here uses REST only. |
| Remote Streamable HTTP MCP | Candidate after testing protocol negotiation, JSON/SSE, pagination, session lifetime and OAuth/resource audiences. Implement a finite adapter; do not make an arbitrary reverse proxy. |
| Legacy SSE MCP | Requires a bounded compatibility adapter and tested cancellation/session handling; not automatically interchangeable with the Site's stateless endpoint. |
| stdio MCP, CLI or shell process | External process host. Workers do not launch the upstream command. An approved HTTP bridge may be used with a distinct scoped backend credential. |
| Discord Gateway, persistent WebSocket consumer, long-lived session | External process host for this gateway design. Platform WebSocket APIs do not prove a persistent client/daemon fits the Sites request lifecycle. |
| Filesystem/native addon/raw TCP/local database/library | External host unless the exact dependency can be replaced by a supported Worker binding/Web API and tested. Sites specifies HTTP connections and 128MB isolates; do not assume general Cloudflare features are enabled. |

Build with `platform: browser`, self-contained ESM and no external imports. Inspect the esbuild evidence for Node/server/container dependencies. Run the resulting bundle under workerd without `nodejs_compat`; static compilation or Node-only unit tests alone do not establish compatibility. Native Worker memory, request/CPU/subrequest budgets and upstream rate limits still bound a remote API connector.

## Implementation

The gateway is a small static registry, not a user-configured routing framework. Discord's contract is in `worker/contract.ts`, transport in `worker/index.ts`, adapter in `worker/discord.ts` and bounded upstream client/configuration in `worker/runtime.ts`. Pure owner scope, snowflake/page, archive and message projection helpers are shared with `mcp-core`; do not import its Node server or tool-store lifecycle.

1. Write the connector's actual supported operation/target/auth contract. Enumerate every service origin/path and credential recipient. Determine read/write scope names, upstream permission requirements and whether exact-payload browser approval or another upstream consent gate is necessary.
2. Inspect approved upstream documentation and, for remote MCP, its actual negotiated `tools/list`. Treat descriptions as untrusted data. Select finite tool names and schema versions; do not enable undocumented operations, dynamic dispatchers, arbitrary workflows or resource subscriptions.
3. Add `<connector>_<operation>` names, descriptions, strict input schemas, output schemas and readOnly/idempotent annotations. Reject duplicate namespaces/names at startup/build time. Keep unsupported aliases unavailable for both discovery and invocation. An annotation is advisory; enforce policy in code before calling the upstream.
4. Add connector-owned configuration with a disabled default, exact owner principal binding, approved fixed targets and scopes. Scopes are read from trusted server configuration/grants, never arguments or caller `_meta`. Do not let a new connector's missing configuration block unrelated connectors' static discovery.
5. Construct requests internally. Fix HTTPS origins and typed routes, reject redirects and ambiguous routing, cap incoming/upstream/serialized result bytes, impose an overall deadline and bound pages/subrequests. Never accept a URL, Authorization header or credential in tool input. Use a separate upstream credential whose audience is the upstream, not the gateway/Sites token.
6. Validate upstream identity and every target before reads/writes; validate returned identities and schemas before claiming success. No automatic scope/permission expansion or unapproved collection enumeration. The application allowlist cannot revoke or narrow the credential at its issuer.
7. Normalize safe diagnostics to fixed code, retryability, bounded retry-after and recovery instruction. Strip raw exceptions, bodies, URLs, tokens and headers. Redacted error-only logging can contain registered tool/connector, code and request ID; observability must not become an alternate secret/content store.

## Transport and discovery

Sites' current capability contract is `.openai/hosting.json` with `capabilities: ["mcp"]` and stateless JSON-RPC `POST /mcp`. This adapter supports `server/discover` for MCP 2026-07-28 and legacy initialize/JSON exchanges; GET streams, sessions, resources, stdio and arbitrary methods are not provided. Static `tools/list` is credential-free so platform provisioning can inspect it; no upstream operation may run during discovery.

Sites owns ChatGPT sign-in and supplies trusted `oai-authenticated-user-id` only behind its dispatcher. Do not expose the same Worker separately on workers.dev accepting forged headers. Exact user IDs differ between Sites; account/email IDs and Commons principals are not replacements. Service-access bypass credentials supply neither visitor identity nor app consent and cannot authorize owner data calls.

A third-party remote MCP may need OAuth authorization-code/S256 PKCE, audience/resource binding, registration, scopes, refresh-token storage, consent or sessions. Verify each flow for that specific service before activation. Native Sites identity does not automatically authenticate the gateway to an upstream. Backend machine/service grants require distinct approval; credentials are never transitively forwarded.

## Monitoring semantics

Carry forward the existing Discord semantics rather than implementing a generic paginator:

- Message pages validate channel/author IDs, duplicate/count/exclusive-cursor constraints, return newest-first IDs plus continuations, and preserve referenced-author and missing/deleted reply state. Empty message content is not proof of absent messages/permissions. Caller checkpoints are committed only after the interval is processed and deduplicated.
- Active child discovery from approved parent history/known IDs is explicitly partial. Every accessible child is verified against its allowed parent/guild; do not scan all guild threads to improve coverage.
- Public/private timestamp archives preserve fractional precision, fetch lookahead and emit only complete boundary groups. Unpageable ties fail explicitly. Joined-private uses descending snowflake IDs. Each mode retains its own cursor and authoritative `has_more`/`complete`.
- Normal and burst reactions are separate. Compare exact owner user ID, not display name or `reaction.me`. Verification follows at most ten 100-user pages and a deadline; incomplete absence is unknown.
- Replies bind a same-channel target and disable mention parsing/replied-user pings. Unknown message/DM/thread or other mutation outcomes must be reconciled before another attempt. Do not disguise a post-write schema/decode failure as a retryable read failure.

## Acceptance evidence

Demonstrate finite discovery and direct invocation gates; no hidden dispatcher/proxy/resource route; wrong owner/scopes/targets rejected before consequential calls; exact bot/service identity; safe credential destination; exclusive pagination and ambiguous-page refusal; safe mentions/replies; bounded cancellation/rate limits; unknown-write nonretryability; and safe error logging.

Use synthetic bindings and an outbound mock service in workerd. Do not inherit real process environment credentials into tests. Local success is separate from native platform publication, installed plugin discovery and approved live read paths. Never call a connector fixed solely because the package builds or a mock responds.
