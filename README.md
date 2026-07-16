# joinburn

The open-source collector and pairing CLI for [Burn](https://joinburn.app), an
activity network for people who work with AI agents.

```bash
npx --yes joinburn@latest connect --code <PAIRING_CODE>
```

`joinburn` pairs a machine to a Burn account, reads local aggregate usage from
supported coding agents, sends only the normalized aggregate rows described
below, and installs a 30-minute background sync.

## Why this repository is public

The collector runs on your machine and reads local agent data, so its behavior
should be inspectable. This repository is the source for the npm package and
release artifacts. Its release workflow is designed to publish from public
tagged commits through npm Trusted Publishing so provenance can be verified.

## What is collected

Burn uploads only:

- date and agent source;
- model identifier;
- input, output, cache-read, and cache-write token totals;
- estimated cost;
- aggregate message and session counts.

Burn does **not** upload prompts, responses, transcripts, code, file paths,
project names, tool arguments, or session content. See [PRIVACY.md](PRIVACY.md)
for the precise boundary.

## ccusage powers local parsing

Burn uses a pinned release of [ccusage](https://github.com/ccusage/ccusage) as
its local multi-agent parsing engine. ccusage is a mature MIT-licensed project
that reads coding-agent usage files locally and does not upload them.

The Burn CLI adds the product-specific boundary around that engine:

- pins ccusage and every platform binary to reviewed integrity hashes;
- invokes it locally with structured JSON output;
- allowlists supported sources and aggregate fields;
- discards arbitrary fields before anything reaches Burn's API;
- handles pairing, device credentials, retries, updates, and background sync;
- falls back to built-in Claude Code and Codex parsers when ccusage is
  unavailable.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution.

## Supported agents

The pinned parser currently recognizes Claude Code, Codex, OpenCode, Amp,
Droid, Codebuff, Hermes Agent, pi-agent, Goose, OpenClaw, Kilo, Kimi, Qwen,
GitHub Copilot CLI, and Gemini CLI.

Support means the agent writes local records containing trustworthy timestamps,
model identifiers, and token or cost accounting. Burn does not estimate usage
from prompt text.

## Commands

```bash
# Pair, perform the first aggregate-only sync, and install the daemon
npx --yes joinburn@latest connect --code ABC-123

# Inspect connection, parser, and scheduler health
npx --yes joinburn@latest doctor

# Repair the parser and scheduler, then run a full aggregate sync
npx --yes joinburn@latest repair

# Run an immediate sync
npx --yes joinburn@latest sync

# Remove the background daemon
npx --yes joinburn@latest daemon uninstall
```

Pairing codes are single-use and expire after 15 minutes. `connect` stores the
device credential with owner-only filesystem permissions under
`~/.burnstats/config.json`.

Health reports sent to Burn contain only categorical state: scheduler status,
parser status, detected agent names, collector version, and a normalized error
code. Raw error strings and local paths stay on the machine.

## Development

Requirements: Node.js 20.9+, Bun 1.3+, macOS/Linux/Windows.

```bash
bun install
bun run check
bun run --filter joinburn dev -- --help
```

The npm package contains a bundled ESM entrypoint and no runtime npm
dependencies. During `connect`, the collector installs the exact ccusage
version recorded in `packages/cli/src/parsers/ccusage-package-lock.json` under
`~/.burnstats/vendor` and verifies the wrapper and native binary before use.

## Security

Please report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md). Do not open public issues containing local paths,
device tokens, pairing codes, or session data.

## License

Burn's collector is MIT licensed. ccusage remains copyright its contributors
and is used under its own MIT license.
