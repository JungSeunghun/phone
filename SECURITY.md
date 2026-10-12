# Security reports

**Do not post vulnerabilities, private keys, connection codes or real phone contents in public issues.**

After the repository becomes public, use GitHub's **Security → Report a vulnerability** if private vulnerability reporting has been enabled. If that option is unavailable, open a minimal issue asking the maintainer to arrange a private reporting channel. Include no exploit details or sensitive files in that initial issue. A dedicated private contact and response SLA have not been established yet.

A private report should describe affected versions, reproduction with synthetic data, impact and a proposed fix where possible. Review and redact any attachments. Maintainers should acknowledge reports and coordinate disclosure and a fix; no guaranteed response time is advertised.

Before public release, maintainers must enable private reporting, review Git history for credentials and device media, and configure trusted releases. The current 0.2.x development line is the maintenance focus; older builds have no guaranteed security support.

The app processes phone video, audio and text locally. Diagnostic summaries exclude arbitrary text, device identifiers, addresses and raw logs. Update checks contact the configured HTTPS endpoint; installations verify the pinned public key and signed version. iPhone input/broadcast connections have their own authenticated encrypted protocol; third-party keyboard Full Access is a user-granted capability.

A public update verification key is not secret. Private update-signing keys, Apple/Windows signing credentials, ADB keys and iPhone connection secrets must remain outside Git and outside public logs.
