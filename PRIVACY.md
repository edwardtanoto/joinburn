# Collector privacy boundary

The collector has two responsibilities: derive aggregate usage locally and
send those aggregates to the Burn account explicitly paired by the user.

## Data sent to Burn

Each upload row may contain:

- calendar date;
- supported agent/source identifier;
- model identifier;
- input, output, cache-read, and cache-write token totals;
- estimated USD cost;
- aggregate message and session counts;
- collector version and provider-level aggregate metadata.

## Data that must never be sent

- prompts or responses;
- transcript or conversation contents;
- source code or generated code;
- file paths, repository names, or project names;
- tool calls, arguments, or command output;
- raw session identifiers;
- environment variables, unrelated credentials, or cookies.

The ccusage adapter constructs a new allowlisted object for every row. It never
forwards the parser's original JSON object to the API. Tests assert that
unexpected fields are discarded.

## Local files

Supported agents store usage records in their own local application folders.
The collector reads those files without modifying them. Burn's device config,
pinned parser runtime, logs, and lock file live under `~/.burnstats`.

## Network destinations

The collector sends paired usage to `https://api.joinburn.app`. Installing the
pinned parser contacts the npm registry. No local agent data is sent to npm or
ccusage.
