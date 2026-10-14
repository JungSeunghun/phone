<div align="center">

<img src="desktop/src-tauri/icons/128x128.png" width="72" height="72" alt="Phone Mirror icon" />

# Phone Mirror

**Your phone. A wider view.**

Bring your Android or iPhone screen to your desktop.<br>
Connect, capture, record, and type with room to work.

[![Desktop CI](https://github.com/JungSeunghun/phone-mirror/actions/workflows/desktop.yml/badge.svg?branch=main)](https://github.com/JungSeunghun/phone-mirror/actions/workflows/desktop.yml)
[![License: MIT](docs/assets/license-mit.svg)](LICENSE)
[![UI: English / Korean](docs/assets/ui-languages.svg)](#features)

[Quick start](#quick-start) · [Support status](#support-status) · [Documentation](#documentation) · [한국어](README.ko.md)

</div>

![Illustrative Phone Mirror desktop UI with a USB connection, recording controls, and a fictional planner on the phone screen. All content is synthetic.](docs/assets/phone-mirror-demo.svg)

<p align="center"><sub>Illustrative desktop preview with synthetic content. This is not a real-device screenshot or hardware verification evidence.</sub></p>

## Features

- **Connect your way.** Android USB and Wi-Fi, QR or code pairing, and automatic reconnection. iPhone receiver paths use native macOS USB capture or the optional sender app.
- **Work from your desktop.** Control Android with your mouse and keyboard, paste text, and send committed multilingual IME input. iPhone text input uses a separate encrypted keyboard connection.
- **Keep the useful moments.** Save PNG screenshots and MP4 recordings, including screenshots during active or paused recording. Play and record phone audio where the device and app allow it.
- **Make it your workspace.** Full screen, picture-in-picture, and Korean or English UI. Language changes apply immediately and persist across restarts.

## Support status

The primary desktop app targets **macOS 14+ and Windows**. Implemented support and hardware verification are tracked separately.

| Phone and host             | Connection  | Verification status                                                                   |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| Android on macOS           | USB · Wi-Fi | Real-device mirroring and media checks; multilingual input verified over Wi-Fi        |
| Android on Windows         | USB · Wi-Fi | Implemented and covered by automated checks; native Windows/device validation pending |
| iPhone on macOS or Windows | USB · Wi-Fi | Receiver and sender paths implemented; iPhone hardware validation pending             |

See the [full support matrix](docs/SUPPORT.md) for differences between hosts and connection methods. iPhone mouse/touch control is not implemented; text input requires the Phone Mirror keyboard, Full Access, a local network connection, and a compatible field. Audio availability depends on OS, application, and protected-content policies.

**Release status:** installers and signed updates are distributed through [GitHub Releases](https://github.com/JungSeunghun/phone-mirror/releases). Version 0.2.2 connects the official feed by default; on 0.2.0, register the address in the [distribution guide](desktop/RELEASING.md). Current development installers use macOS ad-hoc signing without notarization and have no Windows publisher signature; update artifact signature verification remains enabled.

## Quick start

### Run from source

Install **Node.js 22**, **Rust 1.90+**, and [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/). Android connections also need the complete Android SDK Platform Tools folder, with `adb` on `PATH`.

```sh
cd desktop
npm ci
npm run tauri dev
```

macOS builds require Xcode Command Line Tools. Windows builds require MSVC C++ Build Tools and the Windows SDK; running the app requires WebView2.

### Connect your first phone

1. **Android USB:** connect a data cable, enable USB debugging, and approve the computer on your phone. Select the USB device and click **View phone screen**.
2. **Android Wi-Fi:** on the same network, enable wireless debugging on Android 11+ and open **Android Wi-Fi connection**. Pair by QR or code, then use the phone's connection port. Pairing and connection ports are different.
3. **iPhone:** follow the [sender and keyboard setup](ios/README.md). macOS native USB capture needs an unlocked phone, computer trust, and camera permission. Windows USB and Wi-Fi receiving use the sender app and an active screen broadcast.

The in-app **First connection** guide walks through each method. Saved devices are not automatically mirrored at launch. Choose **한국어** or **English** under **언어 / Language** in settings.

## Documentation

| Guide                                                             | What you will find                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| [Desktop setup](desktop/README.md)                                | Connection, input, media, build, and troubleshooting details |
| [iPhone setup](ios/README.md)                                     | Sender app, screen broadcasting, and keyboard extension      |
| [Support matrix](docs/SUPPORT.md)                                 | Platform capabilities and evidence limits                    |
| [Packaging and updates](desktop/RELEASING.md)                     | Local installers and signed update distribution              |
| [Contributing](CONTRIBUTING.md)                                   | Development checks, TDD, and commit conventions              |
| [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) | Project structure and planned work                           |
| [Verification records](desktop/TESTING.md)                        | Automated, native, and real-device evidence                  |
| [Original Swift app](docs/SWIFT_APP.ko.md)                        | Separate native macOS application                            |

The primary app uses **Rust + Tauri + React** in `desktop/`. The original Swift macOS app remains in `Sources/`; the optional iPhone sender and keyboard extension live in `ios/`.

## Privacy and reporting

Report problems with the OS, app version, phone OS, connection method, reproduction steps, and verification environment. The app's **Connection diagnostics → Save diagnostic summary** exports allowlisted results; review the JSON before attaching it to an issue.

Keep real phone screenshots, recordings, clipboard contents, connection codes, and unreviewed logs out of public reports. Use synthetic content for public demonstrations, as in the [preview illustration](docs/assets/README.md). Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

Project-authored code is licensed under [MIT](LICENSE). Upstream code and dependencies retain their own licenses, including scrcpy's Apache-2.0 license. See [third-party notices](THIRD_PARTY_NOTICES.md).
