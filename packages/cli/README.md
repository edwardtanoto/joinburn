# joinburn

Open-source collector and pairing CLI for [Burn](https://joinburn.app).

```bash
npx --yes joinburn@latest connect --code <PAIRING_CODE>
```

The CLI uses a pinned, integrity-verified ccusage runtime to read local coding
agent usage, sends only allowlisted aggregate counters, and manages Burn's
pairing credential and background sync. It never uploads prompts, responses,
code, paths, project names, or session content.

Full source, privacy documentation, and release provenance:
https://github.com/edwardtanoto/joinburn

Useful diagnostics:

```bash
npx --yes joinburn@latest doctor
npx --yes joinburn@latest repair
```
