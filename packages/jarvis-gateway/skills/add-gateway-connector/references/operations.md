# Secrets, installation and operations

## Packaging and installation

Sites provisions its MCP plugin from the published tool manifest. Its supported hosting schema currently has no skill attachment field. Do not invent one or replace the platform's plugin/OAuth identity. This standalone Codex skill is shipped beside the adapter as `skills/add-gateway-connector`, with `SKILL.md`, `agents/openai.yaml` and these references.

After user-approved installation, copy that whole folder to the user's configured Codex skills directory (normally `~/.codex/skills/add-gateway-connector`) or use the supported skill installer against this repository path. Do not install it globally as a side effect of implementing a connector. A packaged archive must contain this folder with its frontmatter intact and no Site identity, .env, key, build/runtime data or Git metadata. Installing the skill does not install/connect the native Site plugin or grant upstream access.

## Secret storage and rotation

For every secret action, return an approval record with the exact Site ID/host, field name, source item, destination/storage, receiving platforms/services, intrinsic credential permissions, narrowed application targets and activation/grant requested. Resolve the actual platform ID/origin; do not reuse a template or another Site's identity.

Use server-only native Sites configuration, `is_secret: true`, for a Worker credential. Keep public origin/target IDs separate and use native sign-in/consent. Do not put credentials in `.openai/hosting.json`, tracked examples, frontend HTML/JS, skill references, command arguments, test snapshots, logs or an ordinary chat message. A secret-input UI or supported process-scoped 1Password injection is preferable. If a selected credential reader explicitly exposes values to tool context, disclose that route and obtain approval for the exact destination before using it; never echo the result.

An API token may retain authority across all upstream resources the bot/account can access. `discord.read`, owner checks and six allowed parents reduce this application's calls, not that token's intrinsic authority. Operators and deployed server code can still use it; hosting/editor access is part of the risk. Do not grant extra upstream permissions to fix discovery or empty history.

For rotation, first distinguish compromise from planned replacement. A private repository or redeployment does not revoke a leaked token. Obtain exact revocation/rotation approval, stage an approved replacement in the same secret store, verify service identity and scoped reads, then revoke the old credential through its issuer with approval. Never retain old secrets in rollback archives; rolling back code does not resurrect a revoked key. Coordinate shared bot credentials so independent services are not broken accidentally. OAuth refresh/client credentials also have their own issuer, audience, storage, expiration and revocation rules.

Commons Reservations stays independent. Its origin and master key bind encrypted D1 sessions/browser approvals; changing/copying them can break working reservations. Its user identity is Site-scoped, and a gateway token is not a delegation grant to it.

## Validation and rollout

Run the gateway build/typecheck/tests and artifact validation. Build from a pinned lockfile and inspect inputs/external imports/size. Use Miniflare/workerd with mocked outbound traffic for real runtime evidence, including missing secrets and disabled startup. Run affected shared-core regressions when changing reused helpers. Validate this skill's frontmatter/links and forward-test a realistic future-connector request without live side effects.

Keep publication stages separate:

1. Create/reuse the approved owner-private Site and persist its exact ID in deployment-local hosting metadata. The public package is an identity-free template.
2. Prepare a disabled artifact from the reviewed source commit. Use native Sites short-lived source credentials through the protected-stdin source workflow; never bypass the approval flow, use a Commons key or opt into automatic publication casually.
3. Obtain approval for publication/access when required. Save/deploy only the exact pushed source and matching artifact through the owner-private native operation. Keep the Site's audience, URL/resource and connector identity stable. A source push or Site creation alone is not a live deployment.
4. Verify disabled discovery, private access and owner bootstrap. Obtain this Site's exact principal through authenticated native access; `/control` reports metadata only and stores/grants nothing. It must not silently trust the first visitor as owner.
5. Obtain the exact secret, target restriction and read-only activation approval. Configure fixed scope/owner through trusted runtime metadata, then verify service identity, installed native-plugin discovery and only approved live reads. Start with small pages; capture safe codes/request IDs and explicit coverage limits.
6. Keep writes disabled until separate operator scope and exact human-action approval are established. The present `__approve` Boolean is not a tamper-proof browser receipt. Add/test stronger gates before operations that require them. Never send live test messages, reactions or other mutations merely to demonstrate deployment.

Use supported native Site publication and its generated plugin; do not create a second OAuth client or local MCP registration as a shortcut. If installation/authentication needs user interaction, keep that specific flow pending and continue local mocks/docs. Do not repeatedly retry an uncertain publication; inspect the existing version/deployment first.

## Rollback and observability

Record the known-good source SHA, artifact digest, Site version/plugin manifest and nonsecret runtime configuration revision before updating. Deploy a disabled connector first, test each boundary and retain existing connectors' behavior. Stop activation on a principal/scope/identity/schema mismatch, incomplete required discovery or unverified target access; do not widen scopes to proceed.

For a failing connector, disable its approved activation setting first when authorized; leave other adapters working. Roll back to the exact reviewed prior artifact with compatible metadata. Check current secret/configuration separately because code rollback does not undo runtime values or OAuth grants. Use exact native rollback/publication approvals and verify installed discovery again. Reconcile uncertain writes against the upstream before attempting them again.

Logs default off. Optional error-only events contain registered connector/tool, fixed code and request ID; retain them within the hosting platform's bounded policy. Never add raw request/response debug logging, credential-bearing URLs, headers, caller IDs, message content or full exception stacks. Health proves startup/configuration only; it does not prove upstream content permissions, completeness or installed tool exposure.
