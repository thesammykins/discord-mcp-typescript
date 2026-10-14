---
name: add-gateway-connector
description: Assess, implement, test or roll out an explicitly supported connector for the private Jarvis Gateway Worker. Use for gateway connector changes, not arbitrary proxying or changes to independent Commons reservations.
---

# Add a Jarvis Gateway connector

Jarvis Gateway is an owner-private Sites MCP server. Its first adapter is the fixed, scoped Discord surface in `packages/jarvis-gateway`. Locate that package in the selected checkout; do not assume a machine path, Site identity or stored credential from another installation.

Choose the runtime before editing. Read [connector compatibility](references/connector-contract.md#runtime-fit) for the proposed connector. A stateless HTTPS API or a bounded remote HTTP MCP adapter can fit; stdio, subprocesses, persistent Gateway/WebSocket clients and filesystem/native dependencies need an external process host unless a separately tested Worker design exists. The Node Discord CLI is not the Worker entrypoint.

For implementation, read [the connector contract](references/connector-contract.md#implementation). Add one explicit adapter with fixed service origins, finite tool names, strict input/output schemas, target restrictions and connector-specific scopes. Prefix gateway names with the connector namespace and reject collisions. Use supported discovery to inspect an approved upstream, then curate its tool subset; never expose every remote tool or accept arbitrary endpoint/header/credential arguments. Do not forward ChatGPT/Sites bearer credentials or Commons identities to an upstream.

Sites authenticates access and injects a Site-scoped identity. Bind calls to the exact configured owner of this Site, behind the trusted dispatcher; client `_meta`, arguments or headers at an independently exposed Worker cannot establish that identity. Keep the Site owner-only and use native Sites publication/connection flows. Do not copy another Site's owner ID, URL, OAuth resource, database or secrets.

Before secret transfer or persistent access configuration, present the exact project/host, field, upstream recipients, storage, target scope and credential risk for action-time approval. Prefer native secret input or supported process injection; never request a pasted secret in ordinary chat. Keep runtime values out of code, browser bundles, manifests, test fixtures, skill archives and logs. A per-tool read/write grant is an application restriction; it does **not** reduce the intrinsic authority of the upstream credential. Read [secrets and rollout](references/operations.md) for rotation, installation and rollback.

Separate reads from writes. Begin with the adapter disabled, then approved read scope and explicit targets. Writes require a separately approved operator scope and the caller's exact human authorization. The current `__approve:true` field is a technical guard, not proof of human consent or a browser receipt. Do not add writes that need stronger approval without implementing and testing that gate; keep them disabled meanwhile. Mock consequential operations unless the exact live operation is separately authorized.

Preserve pagination and error contracts: exclusive monotonic cursors, authoritative exhaustion, IDs/author/reply identity, exact reaction-owner checks and explicit incomplete coverage. Fail visible rather than skipping ambiguous rows. Unknown mutation outcomes are nonretryable and require reconciliation, including after malformed successful responses. No hidden retries or guild-wide discovery to fill a scope gap.

Validate the change with the package's schema/negative-scope tests, real workerd tests without unnecessary Node compatibility, bundle import/size checks and affected shared-core regressions. Test discovery separately from invocation and installed-plugin exposure. Include wrong-owner/scope/target, malformed pages, rate limits, deadlines, unsafe redirects, credential-forwarding rejection and uncertain writes. Read [operations](references/operations.md#validation-and-rollout) for the release evidence and stopping conditions.

Report the source commit, artifact, local evidence, exact pending approvals and production verification gaps. Preserve Commons Reservations as a separate working connector. An installed skill advises implementation; it grants no secret, deployment, permission, messaging or mutation authority.
