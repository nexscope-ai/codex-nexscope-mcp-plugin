# Nexscope Research Canvas MCP plugin

This independent MCP + Skill plugin connects your Nexscope account to the [Nexscope MCP server](https://api.nexscope.ai/api/skill-api/v2/mcp). The host handles OAuth sign-in and consent. Use published MCP skills directly for ordinary product, keyword, and market queries; their original text and structured data appear in conversation. For a repeatable workflow, ask Codex to save an editable draft or call `nexscope_workflow_open({})` to build one in Research Canvas. Review and explicitly confirm a run. Skill calls can consume Nexscope credits; opening, editing, and saving do not. The package bundles the scoped CLI wheel for optional local-file and legacy skill workflows; it does not install it automatically.

[Browse Nexscope MCP tools](https://www.nexscope.ai/mcp?co-from=github-mcp-plugin&utm_source=github&utm_medium=referral&utm_campaign=github_mcp_launch&utm_content=codex-nexscope-mcp-plugin_readme_tools) · [MCP connection guide](https://www.nexscope.ai/mcp-map?co-from=github-mcp-plugin&utm_source=github&utm_medium=referral&utm_campaign=github_mcp_launch&utm_content=codex-nexscope-mcp-plugin_readme_setup)

The canvas uses MCP Apps `tools/call` only when the host advertises `hostCapabilities.serverTools`. Without it, the canvas explains that actions are unavailable. `nexscope_workflow_draft` saves a conversation-generated draft without running it; `nexscope_workflow_read` exposes owner-scoped catalog, saved canvases, status, and complete result chunks to Codex. Run history can resume pending nodes, while uncertain paid steps require a status check. Provider results and user analysis replies are separate explicit actions.

Completed output steps open their first result page automatically. Select an output by alias, browse rows, and export the full saved JSON value or CSV for a tabular value. Exports read all stored JSON chunks without re-running research. The download button requests a file; the full text remains copyable if the host blocks downloads. Add to conversation shares a small preview and a reference so Codex can read complete selected rows. Ask Codex to save sends a separate request to read the existing run and write a local file; wait for its file link before treating the file as saved.

Ordinary Amazon, TikTok, and Temu skill calls return their complete original result in conversation. Research Canvas draft/open actions still open an interactive view.

## Local checks and portable package

Python 3 builds the package. Node.js and npm are needed only for the existing Vitest/jsdom bridge tests; they are not runtime dependencies.

```sh
npm ci
npm test
python3 scripts/build_plugin.py --check
python3 scripts/build_plugin.py
```

The default `dist/codex-nexscope-mcp-plugin-0.1.0.zip` contains nine files, including `skills/nexscope/references/legacy-cli.md` and the hash-verified `runtime/nexscope_cli-0.1.1-py3-none-any.whl`. The build check verifies its SHA-256, size, 657 package files, 138 catalog entries, and 136 routable entries. Tests, dependencies, build scripts, and credentials stay outside the runtime ZIP. No `.app.json` is generated.

The plugin owns the self-contained Research Canvas UI. The Java MCP server serves an exact generated copy from its classpath. During a coordinated backend build, point this option at the assigned Java worktree's `sa-deployment/sa-dp-claw/src/main/resources`:

```sh
python3 scripts/build_plugin.py --backend-resources "$NEXSCOPE_BACKEND_RESOURCES"
python3 scripts/build_plugin.py --check --backend-resources "$NEXSCOPE_BACKEND_RESOURCES"
```

The first command copies the exact HTML bytes and builds the ZIP. The second verifies the existing copy without writing files. `--check` alone checks the source package without generating an archive. Missing, differing, linked, empty, or oversized resources fail validation.

## Public submission

The public directory currently requires the remote HTTPS endpoint through **With MCP**. ZIPs with `apps` or `.app.json` references cannot be submitted. This builder produces one portable package with `mcp.json`; the dashboard handles public MCP setup. Actual Codex fullscreen and Research Canvas behavior remains unverified in a live host. See [SUBMISSION.md](SUBMISSION.md) for the remaining evidence.

Protocol references: [plugin packaging](https://developers.openai.com/plugins/build/plugins), [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui), [OpenAI display modes and model context](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md).

The original [Nexscope Codex skill plugin](https://github.com/nexscope-ai/codex-nexscope-plugin) is a separate project and remains unchanged.

The scoped CLI wheel preserves all 138 catalog entries and 136 available entries. Source changes are recorded in `runtime/compliance.patch` against upstream SHA-256 `027aee2cd223adaadfb88bb01ed56805281ca7071e873d7a043c2291950ee553`. Rebuild with `python3 scripts/rebuild_cli_runtime.py /path/to/original/nexscope_cli-0.1.1-py3-none-any.whl`. This removes forced activation and silent email instructions, requires explicit send confirmation, and omits automatic recharge links. Product-price data and all script entry points remain available. Install into the plugin-scoped environment described in `skills/nexscope/references/legacy-cli.md`; the separately submitted Skill-only plugin is unchanged.
