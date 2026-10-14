# Contributing

Thank you for helping improve Phone Mirror. Contributions to project-authored code are under the [MIT license](LICENSE); upstream files retain their original licenses.

## Start here

1. Read the [README](README.md), [support matrix](docs/SUPPORT.md) and [architecture](docs/ARCHITECTURE.md).
2. Use a feature request to discuss substantial changes. Keep fixes focused and describe a reproducible problem.
3. Fork the repository, make a branch, and submit a pull request with behavior and validation evidence.

The desktop application is in `desktop/`; the original Swift app is in `Sources/`; the iPhone sender and keyboard extension are in `ios/`. Preserve these boundaries and follow [AGENTS.md](AGENTS.md).

## Branch management

Use `main` as the integration branch and short-lived work branches. This convention applies to contributors and AI agents alike; `codex/` is not the default prefix.

| Prefix | Purpose | Example |
| --- | --- | --- |
| `feature/` | New functionality | `feature/wireless-pairing` |
| `fix/` | Ordinary bug fixes | `fix/android-recording` |
| `hotfix/` | Urgent fixes to a released version | `hotfix/recording-crash` |
| `release/` | Version updates and release preparation | `release/0.2.3` |
| `chore/` | Tooling, configuration, and repository maintenance | `chore/rename-repository` |
| `docs/` | Documentation changes | `docs/update-guide` |

Use lowercase, descriptive, hyphen-separated work descriptions. Release branch suffixes use the intended version. Branch prefixes and commit types are separate: `feature/` branches normally contain `feat:` commits; a `chore/` branch may contain focused `build:`, `ci:`, `test:`, or `refactor:` commits as appropriate.

1. Branch from current `main` for ordinary work.
2. Keep one logical task per PR, use TDD for behavior changes, and include the applicable validation evidence.
3. Merge through a PR after applicable CI passes and review is complete. Do not commit or push directly to `main`, or force-push it. Keep merged commit messages consistent with the conventions below.
4. Delete merged work branches when no longer needed. A merge does not automatically publish a release.

Do not introduce a permanent `develop` branch or separate platform development branches by default. Use directories and focused PRs to maintain platform boundaries. Release branches are temporary preparation branches; introduce a maintenance branch only when an older release line actually needs concurrent support.

If an urgent fix must ship while `main` contains unrelated unreleased changes, create a temporary `release/<version>` branch from the affected release tag and branch `hotfix/<description>` from that base. Add regression tests and merge the hotfix and version preparation through a PR into that release branch before tagging a new PATCH version. Apply the fix and tests to `main` through a separate PR, without copying older release version changes. The hotfix release must not ship unrelated changes from `main`.

## Versioning policy

Use [Semantic Versioning](https://semver.org/) with the following explicit policy for the initial `0.x` development phase:

| Change | Version increment | Example |
| --- | --- | --- |
| Compatible bug, security, or packaging fix | PATCH | `0.2.2` to `0.2.3` |
| New functionality | MINOR; reset PATCH | `0.2.3` to `0.3.0` |
| Incompatible public contract change during `0.x` | MINOR; reset PATCH and document migration | `0.3.2` to `0.4.0` |
| First release with a defined stable public contract | `1.0.0` | `0.x` to `1.0.0` |

From `1.0.0`, use PATCH for compatible fixes, MINOR for compatible new functionality, and MAJOR for incompatible public contract changes. Public contracts include connection protocols, persisted settings formats, and supported integration behavior. Incompatible changes require a `BREAKING CHANGE:` explanation and migration guidance, including during `0.x`. Compatible releases must preserve app identifiers, persisted settings compatibility, and the updater trust relationship; a necessary change to these requires a designed migration.

Increase versions when preparing a release, not for every commit. Documentation-only changes or a repository rename do not require a release by themselves. If those changes are included in a newly distributed application artifact, give that artifact a new version. Choose the release increment from its actual behavior and compatibility changes, not automatically from a single commit type.

Keep independently distributed applications independently versioned. Desktop uses `desktop-v<version>`, for example `desktop-v0.2.3`. Introduce `ios-v<version>` or `swift-v<version>` only when a separate distribution process is established; the existing Desktop workflow does not release those applications. Record compatible Desktop/iOS versions when a connection protocol changes.

### Desktop release preparation

1. Create `release/<version>` from `main` and update these six values together:
   - `desktop/package.json`: `version`.
   - `desktop/package-lock.json`: top-level `version` and `packages[""].version`.
   - `desktop/src-tauri/tauri.conf.json`: `version`.
   - `desktop/src-tauri/Cargo.toml`: `package.version`.
   - `desktop/src-tauri/Cargo.lock`: the `phone-mirror-desktop` package version.
2. Run the applicable development and release checks, including `npm run release:validate` from `desktop`, and document compatibility, migrations, and verification limitations in the release preparation PR.
3. Merge the PR into `main` and create an annotated `desktop-v<version>` tag at the exact verified commit. For a hotfix, merge and tag on the temporary release branch based on the affected release tag, as described above.
4. Push the tag to trigger the existing packaging and draft-release workflow. Verify the draft's source commit, platform artifacts, checksums, and update signatures before publishing.

For preview releases, use `alpha.N`, `beta.N`, or `rc.N`, such as `desktop-v0.3.0-rc.1`. Mark previews as GitHub prereleases and do not promote them to the stable update feed. The current Desktop validator accepts version components from 0 to 65535 and preview numbers from 1 to 9999; it rejects leading zeros and build metadata. See [RELEASING.md](desktop/RELEASING.md) for packaging and publication details.

Do not move or reuse release tags or replace published binaries or update manifests. Publish changed artifacts under a new version and tag. Existing published artifacts remain the evidence for their tagged source; explanatory release notes may be corrected without replacing artifacts.

## Commit messages

Use Conventional Commits with an English imperative summary:

```text
<type>[optional scope][optional !]: <summary>
```

Use a lowercase type and start the summary with a lowercase action verb such as `add`, `fix`, or `document`. Preserve proper names such as Swift, Windows, and Korean. Keep the complete subject within 72 characters and omit a trailing period.

| Type | Use for |
| --- | --- |
| `feat` | New user-facing behavior |
| `fix` | A defect correction |
| `docs` | Documentation changes |
| `refactor` | Code restructuring without behavior changes |
| `perf` | A measured performance improvement |
| `test` | Test changes without production behavior changes |
| `build` | Dependencies, compilation, or packaging |
| `ci` | CI workflow changes |
| `chore` | Repository maintenance outside the types above |
| `revert` | Reverting an earlier commit |

Scopes are optional. Use `desktop`, `swift`, `ios`, or `localization` when one area clearly owns the change. Omit the scope for changes across several areas. Choose the type for the main outcome; tests and documentation supporting a feature belong in that feature commit.

```text
feat: add Korean and English UI language settings
fix(desktop): preserve recordings after a failed save
docs: document commit message conventions
ci(ios): check shared localization changes
```

Keep each commit focused. Stage only changes belonging to that commit, including when unrelated work shares a file. When needed, add a body after a blank line explaining the problem, resulting behavior, and actual verification or limitations. Do not claim checks that were not run. Reference issues in a footer, for example `Closes #123`.

For an incompatible public contract change, add `!` before the colon and a `BREAKING CHANGE:` footer describing the impact and migration. Ordinary UI language additions are not breaking changes.

An optional editor template is included in [.gitmessage](.gitmessage). Enable it separately in each checkout with:

```sh
git config --local commit.template "$(git rev-parse --show-toplevel)/.gitmessage"
```

The template helps editor-based commits; it does not validate messages or affect `git commit -m`. Contributors and AI agents must still follow these rules.

## Development checks

```sh
cd desktop
npm ci
npx playwright install chromium
npm test
npm run test:browser
npm run test:backend
npm run test:release
npm run format:check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

For Swift changes, run `swift test --build-system native`. For iPhone shared logic, run `swift test --package-path ios`; SDK builds are described in `ios/README.md`. Hardware is not required to propose a contribution, but state exactly what you could and could not validate.

Write a failing behavior test before implementing new behavior. Cover relevant invalid values, boundaries, cancellation, repeated operations and late callbacks. Keep connection and validation policies independent of UI, hardware and persistence; inject the relevant ports and clock.

Report Windows/macOS target checks separately from native execution and phone hardware evidence. Use synthetic fixtures in public tests. Do not attach real-device screenshots, recordings, connection secrets or identifying logs. Use the diagnostic summary export when reporting connection problems.

## Releases and signing

PR verification must work without maintainer signing secrets. Public updates use maintainer-signed artifacts and a pinned public key. Fork maintainers need their own private signing key and corresponding public key; a fork cannot produce an update trusted by the official key. Never commit a private key, certificate or provisioning profile. Packaging and draft release preparation are in [RELEASING.md](desktop/RELEASING.md).

## Reviews

Explain the previous behavior, the resulting behavior, how you tested it and remaining limitations. Include frontend and local service tests where applicable. Follow [the code of conduct](CODE_OF_CONDUCT.md). Respectful, concrete feedback is welcome; harassment and disclosure of another person's private data are not.
