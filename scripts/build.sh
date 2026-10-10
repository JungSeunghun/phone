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
<key>CFBundleShortVersionString</key><string>0.3.0</string>
<key>CFBundleVersion</key><string>3</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSCameraUsageDescription</key><string>USB로 연결된 아이폰과 아이패드 화면을 표시하기 위해 캡처 권한이 필요합니다.</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
printf 'Built: %s\n' "$APP"
