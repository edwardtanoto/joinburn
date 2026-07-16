# Security policy

## Supported version

Only the latest published collector version receives security updates.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving credential storage,
update integrity, parser execution, privacy leakage, or remote code execution.
Email `security@joinburn.app` with:

- the affected collector version;
- operating system and architecture;
- reproduction steps using sanitized data;
- expected and observed behavior;
- any proposed mitigation.

Never include a live pairing code, device token, raw transcript, private path,
or other secret. We will acknowledge a report within three business days.

## Release integrity

The npm release workflow publishes from GitHub Actions through npm Trusted
Publishing. Once the package's trusted publisher is enabled, releases are built
from public source, carry npm provenance, and do not use a long-lived npm
publish token.
