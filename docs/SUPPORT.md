# Support and verification / 지원과 검증

This matrix describes the Rust/Tauri desktop app. The original Swift app has separate capabilities. “Implemented” does not mean “hardware verified”.

| Phone / host / connection | Screen and media | Input | Evidence |
| --- | --- | --- | --- |
| Android / macOS / USB | Screen, audio where allowed, PNG, MP4 | Mouse, paste, committed IME text | Android hardware mirroring/capture/audio evidence; multilingual input specifically verified over Samsung Wi-Fi |
| Android / macOS / Wi-Fi | Screen, audio where allowed, PNG, MP4 | Mouse, paste, committed IME text | Samsung SM-S901N real-device mirroring, multilingual input, and capture during recording |
| Android / Windows / USB or Wi-Fi | Implemented screen/media path | Implemented Android input path | Automated tests and cross-compilation; native Windows/device validation pending |
| iPhone / macOS / USB | Native screen/device-audio receiver implemented | Optional encrypted keyboard connection | Synthetic tests and macOS build; iPhone hardware validation pending |
| iPhone / macOS or Windows / Wi-Fi | Sender app / ReplayKit screen and app audio | Optional encrypted keyboard connection | Protocol, synthetic media and SDK builds; iPhone hardware validation pending |
| iPhone / Windows / USB | Sender app / ReplayKit with Apple USB communication driver | Optional keyboard over same LAN | Protocol and cross-compilation; native Windows/iPhone hardware validation pending |

PNG capture during active/paused recording, fullscreen and PiP use common media paths. Availability still depends on receiving frames. Audio can be unavailable because of phone OS, application policies or protected content.

iPhone mouse/touch control is not implemented. iPhone multilingual input requires the custom keyboard, Full Access, an encrypted connection and a compatible input field; it is separate from USB video. Secure fields and applications that reject third-party keyboards are not supported.

The macOS desktop app has been installed and run locally. Windows GNU cross-compilation is not Windows execution or an MSVC installer build. GitHub workflow definitions are not proof that those remote runs succeeded. An unsigned iOS device SDK build is not an installed or tested iPhone app.

Public demonstrations must use synthetic content. Hardware verification media stays in ignored build output. See [the detailed evidence](../desktop/TESTING.md).
