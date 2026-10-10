# Development requirements

- Keep terminology and naming consistent across domain, infrastructure, UI, tests, and documentation. Use descriptive names rather than abbreviations.
- Keep connection policy and settings validation independent of SwiftUI, USB hardware, and persistence. Inject device discovery, session creation, settings storage, and time into application logic.
- Follow TDD: write failing tests for new behavior, run them and record the failure, implement the behavior, then refactor with tests passing.
- Test frontend actions/presentation and backend device/persistence behavior. This is a native macOS application; backend refers to its device and service layer, not an external web server.
- Include valid inputs, invalid inputs, minimum/maximum boundaries, time boundaries, missing/corrupt persisted data, repeated actions, asynchronous cancellation, and late callbacks where applicable.
- Run automated unit/behavior tests and relevant real-device integration tests. Keep simulated failures distinct from physically unplugging a cable. Never claim iPhone hardware validation without an actual iPhone.
- Do not share real-device screenshots or recordings externally. Keep verification media under ignored build output.
