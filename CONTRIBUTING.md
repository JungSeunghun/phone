# Contributing

Thank you for helping improve Phone Mirror. Contributions to project-authored code are under the [MIT license](LICENSE); upstream files retain their original licenses.

## Start here

1. Read the [README](README.md), [support matrix](docs/SUPPORT.md) and [architecture](docs/ARCHITECTURE.md).
2. Use a feature request to discuss substantial changes. Keep fixes focused and describe a reproducible problem.
3. Fork the repository, make a branch, and submit a pull request with behavior and validation evidence.

The desktop application is in `desktop/`; the original Swift app is in `Sources/`; the iPhone sender and keyboard extension are in `ios/`. Preserve these boundaries and follow [AGENTS.md](AGENTS.md).

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
