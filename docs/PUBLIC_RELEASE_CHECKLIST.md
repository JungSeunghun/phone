# Public release checklist

## Source publication

- Confirm the root MIT license applies to project-authored code and retain upstream licenses.
- Check English/Korean READMEs, support/evidence matrix, contribution instructions and issue forms.
- Run `npm --prefix desktop run audit:public`; review ignored `desktop/src-tauri/target/public-release-audit/report.json` locally. The scanner checks current files and historical blobs for selected credential patterns and media paths. It does not prove the absence of all personal data, secrets, license issues or mislabelled images.
- Review release keys, certificates and provisioning assets separately. A public verification key and public signature fixture can be included; a private key cannot.
- Use synthetic demonstrations. Keep real-device screens/recordings outside published files and history.
- Review the pending source diff and tests before pushing and changing the repository's visibility.

## Community setup at publication

- Enable private vulnerability reporting and establish a private conduct-reporting contact.
- Check Actions permissions, contributor PR checks and branch review rules.
- Do not expose signing credentials in contributor jobs.
- State that iPhone and native Windows hardware verification is pending.

## Binary release and updates

- Build and review Mac ARM64, Mac Intel and native Windows installers.
- Verify complete production dependency notice coverage for the target builds.
- Configure signing/notarization, private CI release credentials and the stable update feed.
- Test signed update download, cancellation, install/restart and busy-state rejection against the real HTTPS feed.
- Review release drafts before publication. Ensure the stable `latest.json` URL follows reviewed stable releases.

A public source repository can precede public binary release. Repository publication does not complete the binary, update-hosting, English UI or hardware-verification steps.
