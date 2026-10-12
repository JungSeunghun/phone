# Architecture

| Directory | Responsibility |
| --- | --- |
| `desktop/src/domain` | TypeScript policies, validation and port types |
| `desktop/src/application` | UI-independent interaction/session controllers with injected backends, storage and time |
| `desktop/src/infrastructure` | Tauri IPC, codecs, clipboard, storage and file adapters |
| `desktop/src/presentation` | React views and user actions |
| `desktop/src-tauri/src` | Rust connection policy and local device, input, media and update services |
| `Sources` | Original native Swift macOS app, preserved independently |
| `ios/App`, `ios/Broadcast`, `ios/Keyboard`, `ios/Shared` | iPhone setup, broadcast, keyboard extension and shared protocols |
| `Vendor` | Pinned scrcpy server, provenance and license |

“Backend” means local device and service code, not a hosted application server. The update feed is a separately hosted manifest and signed files.

Android sessions use ADB/scrcpy with session identifiers and cancellation. iPhone video transport and encrypted text input are separate connections. Media finalization and file dialogs are coordinated so disconnecting or quitting does not abandon a normal recording save. Update installation checks idle state in both frontend and native code.

Diagnostic summary export is an allowlisted format. Free-form titles, messages, actions, IP addresses, device identifiers and original logs never enter the exported payload. Both TypeScript and Rust validate the format; native exports add the app version.

Tests use injected ports and synthetic fixtures. Real-device evidence is kept separate and private. See [CONTRIBUTING.md](../CONTRIBUTING.md) and [TESTING.md](../desktop/TESTING.md).
