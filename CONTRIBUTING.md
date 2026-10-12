# Contributing

Thank you for helping improve Phone Mirror. Contributions to project-authored code are under the [MIT license](LICENSE); upstream files retain their original licenses.

## Start here

1. Read the [README](README.md), [support matrix](docs/SUPPORT.md) and [architecture](docs/ARCHITECTURE.md).
2. Use a feature request to discuss substantial changes. Keep fixes focused and describe a reproducible problem.
3. Fork the repository, make a branch, and submit a pull request with behavior and validation evidence.

The desktop application is in `desktop/`; the original Swift app is in `Sources/`; the iPhone sender and keyboard extension are in `ios/`. Preserve these boundaries and follow [AGENTS.md](AGENTS.md).

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
