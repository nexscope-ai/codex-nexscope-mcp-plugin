# Nexscope Research listing handoff

This is a separate MCP + Skill listing candidate. The local portable package is version 0.1.0. The test environment still has the earlier 0.4.0 server candidate; production behavior is unverified. Local package and simulated Research Canvas checks do not prove live OAuth, host UI behavior, or directory eligibility. No upload, installation, deployment, or publication has been performed for 0.1.0.

## MCP Registry

`server.json` is the remote-only MCP Registry metadata for the same production endpoint used by `mcp.json`. It is intentionally separate from `plugin.json`: the Codex listing and the official MCP Registry listing have independent validation, authentication, and publication steps. Publish it with the official `mcp-publisher` CLI after production OAuth and tool checks pass.

## Prepared locally

- One remote MCP server in `mcp.json`, direct skill guidance, editable Research Canvas drafts, owner-scoped result reads, icon, and the scoped, hash-verified CLI wheel. Ordinary skill results remain complete text and structured data.
- A portable ZIP with no `apps` or `.app.json` reference. Public submission uses **With MCP** and declares the production HTTPS endpoint in the dashboard; ZIPs containing app references cannot currently be submitted.
- Exact workflow UI source-to-Java resource byte check and simulated bridge tests. These are local checks only.

## Before directory submission

- [ ] Verify the production HTTPS MCP endpoint, domain challenge, OAuth sign-in and consent, published tool catalog, explicit tool annotations, costs, and current tool scan. Test denied, cancelled, and expired connections with no token exposed to the iframe.
- [ ] Verify the website, support, privacy policy, and terms URLs; complete publisher identity and policy attestations.
- [ ] In a live Codex host, verify Research Canvas open and draft, save conflicts, editing, run confirmation, pending resume, result export, context references, and failed or uncertain paid steps. Opening, editing, and saving must make no skill calls.
- [ ] Prepare and run exactly five positive and three negative reviewer cases against a dedicated sample-data account. Supply reviewer access through the secure dashboard form, without MFA, email or SMS codes, magic links, or private-network access. Keep credentials out of the ZIP.
- [ ] Provide an accessible demo recording URL showing the main use cases and tools, optional supporting Research Canvas screenshots, and release notes for 0.1.0.
- [ ] If using the existing `MCP_PRODUCT_RESULTS_UI_DOMAIN` setting for Research Canvas, verify an actual HTTPS origin unique to this plugin.

Deployment, live review evidence, upload, formal submission, and publication remain pending separate authorization.
