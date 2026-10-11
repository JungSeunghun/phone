# scrcpy server 5.0

`scrcpy-server-v5.0` is the Android server from the local Homebrew scrcpy 5.0 installation, bundled with its Apache 2.0 license. Upstream: https://github.com/Genymobile/scrcpy/releases/tag/v5.0

SHA-256: `26cbc9ad0aced6c2282455bef4fb43462605c1f8758c74b4ab1dbf818c229daa`

The Swift client and independent Rust/Tauri client in `desktop` implement the 5.0 wire protocol. Update both clients' protocol code and integration tests before changing this binary; server and client versions must match. The server runs as Android's ADB shell user, is copied to a unique `/data/local/tmp/phone-mirror-<id>.jar` at connection time, and uses the upstream cleanup behavior. The Rust/Tauri app embeds the same server and packages this source record and the Apache 2.0 license in its `licenses` resources.
