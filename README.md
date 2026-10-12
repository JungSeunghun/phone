# Phone Mirror

[한국어](README.ko.md) · [Contributing](CONTRIBUTING.md) · [Support matrix](docs/SUPPORT.md) · [Security](SECURITY.md)

Mirror your Android or iPhone screen inside a desktop app, with screenshots, video recording and multilingual text input.

The main cross-platform app is **Rust + Tauri + React** in `desktop/`, for macOS and Windows. The original native Swift macOS app remains in `Sources/` and has separate instructions in [the Swift app guide](docs/SWIFT_APP.ko.md). The optional iPhone sender and keyboard extension live in `ios/`.

## What works

- Android USB and Wi-Fi mirroring, device discovery, wireless pairing and automatic reconnection.
- Android mouse control, audio playback and recording, multilingual paste, and committed IME text input.
- PNG screenshots during active or paused MP4 recording, fullscreen and picture-in-picture.
- iPhone USB/Wi-Fi receiving paths and optional encrypted multilingual keyboard input. **iPhone hardware validation is pending.**
- In-app update checks, signed downloads and user-requested installation. An official published update feed has not been connected yet.
- Connection diagnostics. Diagnostic summaries contain allowlisted check codes and outcomes rather than raw logs, device identifiers or screen contents.

See [the support matrix](docs/SUPPORT.md) for platform differences and evidence. Implemented support is not a claim of hardware validation. The desktop UI currently uses Korean; complete English UI localization is on the [roadmap](docs/ROADMAP.md).

## Build and run

There is no public installer release documented yet. To build the desktop app:

1. Install Node.js 22, Rust 1.90 or later, and [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/).
2. For Android, install Android SDK Platform Tools and put the full `platform-tools` directory on `PATH`.
3. From the repository root:

```sh
cd desktop
npm ci
npm run tauri dev
```

On macOS, building needs Xcode Command Line Tools and running requires macOS 14 or later. On Windows, building needs MSVC C++ Build Tools and Windows SDK; running needs WebView2.

```sh
# macOS application bundle
npm run tauri build -- --bundles app
# Windows NSIS installer (run on Windows)
npm run tauri build -- --bundles nsis
```

Detailed setup: [desktop](desktop/README.md), [iPhone sender and keyboard](ios/README.md), [packaging and updates](desktop/RELEASING.md).

## First connection

**Android USB:** connect a data cable, enable USB debugging, approve this computer on the phone, select the USB device, then click **폰 화면 보기** (View phone screen).

**Android Wi-Fi:** use the same network, enable wireless debugging on Android 11 or later, and open **Android Wi-Fi 연결**. Pair by QR or code, then connect to the phone's connection port. Pairing and connection ports are different.

**iPhone:** macOS USB capture requires an unlocked phone, computer trust and macOS camera permission. Windows USB and Wi-Fi receiving require the iPhone sender app and an active ReplayKit broadcast. Multilingual input also requires the PhoneMirror keyboard extension with Full Access and the encrypted input connection. See [iPhone setup](ios/README.md).

The app does not start mirroring a saved device on launch. The app's **처음 연결하기** (First connection) panel describes each setup path.

## Report a problem

Include OS, app version, phone OS, connection method, reproduction steps, and whether you used real hardware. Use **연결 문제 진단 → 진단 요약 저장** (Connection diagnostics → Save diagnostic summary) to save a JSON summary for review before attaching it to an issue.

Do not attach real phone screenshots, recordings, clipboard contents, connection codes or unreviewed logs. Synthetic test media is suitable for public demonstrations. Vulnerabilities should follow [SECURITY.md](SECURITY.md), not a public bug report.

## Development

```sh
cd desktop
npm test
npm run test:browser
npm run test:backend
npm run test:release
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [test evidence](desktop/TESTING.md), and [architecture](docs/ARCHITECTURE.md). Tests and cross-compilation do not replace Windows or iPhone real-device verification.

## License

Project-authored code is licensed under [MIT](LICENSE). Bundled upstream code and dependencies retain their own licenses, including scrcpy's Apache-2.0 license. See [third-party notices](THIRD_PARTY_NOTICES.md).
