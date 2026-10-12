# Third-party notices

The root MIT license applies to project-authored code, not to dependencies or bundled upstream files. Preserve upstream attribution, license texts and any required notices when redistributing source or binaries.

- The pinned scrcpy server is Apache-2.0. Its binary, original source URL, version and checksum are documented in [Vendor/README.md](Vendor/README.md); [Vendor/scrcpy-LICENSE](Vendor/scrcpy-LICENSE) is included in desktop packages.
- Existing packaged license texts for MP4, numeric libraries, audio, Wi-Fi encryption, USB communication, QR codes and clipboard support are in [`desktop/src-tauri/licenses`](desktop/src-tauri/licenses).
- Desktop JavaScript dependencies are pinned in `desktop/package-lock.json`; Rust dependencies are pinned in `desktop/src-tauri/Cargo.lock`. Their upstream licenses are retained. Development tools and their transitive dependencies also have their own licenses.
- The update stack includes Tauri's updater plugin, reqwest/rustls, ring and minisign verification. Before distributing binaries, collect their required upstream license texts and include them in the packaged notice resources; a separate updater notice directory is not yet included.

Do not describe this list as a blanket relicensing of dependencies. Before a public binary release, verify the complete production dependency inventory against the bundled notice texts and add any missing required attribution. The current notice collection is a release-maintenance responsibility, not a claim of a completed legal compatibility audit.
