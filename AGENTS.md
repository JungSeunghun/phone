# Development requirements

- Keep terminology and naming consistent across domain, infrastructure, UI, tests, and documentation. Use descriptive names rather than abbreviations.
- Keep connection policy and settings validation independent of SwiftUI, USB hardware, and persistence. Inject device discovery, session creation, settings storage, and time into application logic.
- Follow TDD: write failing tests for new behavior, run them and record the failure, implement the behavior, then refactor with tests passing.
- Test frontend actions/presentation and backend device/persistence behavior. The Swift app is native macOS; the independent Rust/Tauri app lives in `desktop`. Backend refers to their local device and service layers, not an external web server.
- Preserve the Swift app when extending the Rust/Tauri app. Keep domain/service code independent of Tauri and OS-specific media APIs. Check Windows and macOS targets, and clearly distinguish cross-compilation, CI configuration, native execution, and real-device evidence.
- Include valid inputs, invalid inputs, minimum/maximum boundaries, time boundaries, missing/corrupt persisted data, repeated actions, asynchronous cancellation, and late callbacks where applicable.
- Run automated unit/behavior tests and relevant real-device integration tests. Keep simulated failures distinct from physically unplugging a cable. Never claim iPhone hardware validation without an actual iPhone.
- Do not share real-device screenshots or recordings externally. Keep verification media under ignored build output.
