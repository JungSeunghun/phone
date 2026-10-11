#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="$PWD/dist/Phone Mirror.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swift build --build-system native -c release
BINARY_DIRECTORY="$(swift build --build-system native -c release --show-bin-path)"
cp "$BINARY_DIRECTORY/PhoneMirror" "$APP/Contents/MacOS/PhoneMirror"
cp Vendor/scrcpy-server-v5.0 "$APP/Contents/Resources/scrcpy-server-v5.0"
cp Vendor/scrcpy-LICENSE "$APP/Contents/Resources/scrcpy-LICENSE"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PhoneMirror</string>
<key>CFBundleIdentifier</key><string>local.phone.usbmirror</string>
<key>CFBundleName</key><string>Phone Mirror</string>
<key>CFBundleDisplayName</key><string>Phone Mirror</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.4.0</string>
<key>CFBundleVersion</key><string>4</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSLocalNetworkUsageDescription</key><string>같은 Wi-Fi에 있는 Android 폰을 검색하고 화면을 연결하기 위해 로컬 네트워크를 사용합니다.</string>
<key>NSBonjourServices</key><array><string>_adb-tls-pairing._tcp</string><string>_adb-tls-connect._tcp</string></array>
<key>NSCameraUsageDescription</key><string>USB로 연결된 아이폰과 아이패드 화면을 표시하기 위해 캡처 권한이 필요합니다.</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
printf 'Built: %s\n' "$APP"
