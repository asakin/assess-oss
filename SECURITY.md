# Security

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/asakin/assess-oss/security/advisories/new).
Do not post credentials or exploitable details in public issues. For ordinary bugs, use the issue tracker.

Include the affected revision/version, public reproduction steps, and expected impact. Remove secrets and
private project requirements from examples. Do not test against systems you do not control.

The collector treats project documentation as untrusted data, does not execute inspected code, limits
outbound requests to supported APIs, and keeps model assessment explicitly opt-in. These boundaries do not
make fetched content trustworthy or model judgments a security audit.
