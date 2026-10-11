# Phone Mirror Sender

독립적인 iPhone/iPad 송출 앱과 ReplayKit Broadcast Upload Extension입니다. 기존 macOS Swift 앱은 수정하지 않습니다. 수신기는 Rust/Tauri Phone Mirror Desktop이며 Mac과 Windows에서 같은 수신 프로토콜을 사용합니다. iOS 16 이상, 컴퓨터와 같은 로컬 네트워크가 필요합니다.

## 빌드와 사용

1. `PhoneMirrorSender.xcodeproj`를 Xcode에서 열고 `PhoneMirrorSender` scheme을 선택합니다.
2. 실기기 설치 시 앱과 `PhoneMirrorBroadcast` 두 타깃의 Signing Team을 설정합니다. 본인의 등록 가능한 bundle ID 및 App Group으로 변경하면 두 entitlements와 `SenderSharedContainer.identifier`, 앱 bundle ID + `.Broadcast` 확장 ID를 함께 맞추세요.
3. 컴퓨터 앱의 **iPhone Wi-Fi 송출 → iPhone 수신 시작**을 누릅니다. 여러 주소가 표시되면 폰과 같은 네트워크의 주소를 고릅니다.
4. 폰 앱에 연결 코드를 붙여 넣고 해상도·프레임·앱 소리를 설정한 뒤 **연결 코드 저장**을 누릅니다. 로컬 네트워크 접근을 허용하세요. 먼저 앱의 TCP 연결 확인을 수행하므로 방송 확장에서 권한 알림을 띄우려고 하지 않습니다.
5. 시스템 방송 버튼을 눌러 화면 방송을 시작합니다. 컴퓨터의 연결된 기기에서 iPhone Wi-Fi를 선택하고 **폰 화면 보기**를 누릅니다.
6. 폰의 시스템 방송 표시에서 방송을 종료합니다. 컴퓨터의 **iPhone 수신 종료**는 현재 보기와 수신 포트도 종료합니다.

설정과 연결 코드는 앱과 확장의 App Group UserDefaults에 로컬 저장합니다. 데스크톱 키는 수신 중 메모리에만 있으며 수신 종료·앱 재시작 시 새 코드가 필요합니다. 코드 전체는 로그에 기록하지 않습니다. 설치 UUID를 기기 식별자로 사용하므로 재접속 시 송출 TCP 포트가 바뀌어도 같은 기기로 인식합니다. 송출기는 1/2/4/8/16초 간격으로 재시도하고 10초 안정 연결 뒤 재시도 횟수를 초기화합니다. 컴퓨터 주소가 바뀌면 새 연결 코드를 저장해야 합니다. Bonjour 자동 검색이나 AirPlay 수신기를 구현한 것은 아닙니다.

앱 소리만 전달하며 마이크 샘플은 사용하지 않습니다. iPhone 원격 마우스 제어는 지원하지 않습니다. ReplayKit이 제공하지 않는 보호 콘텐츠·앱 오디오·통화 소리는 송출할 수 없습니다. 화면·오디오 실기기 수신, 배터리·열·장시간 동작은 아직 검증하지 않았습니다. 화면 보기·PNG 캡처·화면/앱 소리 MP4 녹화·전체 화면·PiP는 공통 데스크톱 경로를 공유합니다. 녹화는 컴퓨터에서 일시 정지·재개할 수 있고 정지 시간은 파일에서 제외합니다. Mac의 iPhone USB 수신도 기기 오디오 포트가 제공하는 소리와 화면을 함께 녹화합니다. USB 연결에는 이 Wi-Fi 송출 앱이 필요하지 않습니다.

## 구조

- `App`: SwiftUI 설정과 시스템 방송 선택 버튼. `SenderSetupState`가 네트워크 확인·입력 변경·늦은 응답에 대한 송출 활성화를 담당합니다.
- `Broadcast`: ReplayKit 샘플 처리와 방송 수명. 방송 재접속 시 인코더 설정을 다시 보냅니다.
- `Shared/SenderProtocol.swift`: 입력 검증, HKDF/AES-GCM, 패킷·해상도·대기열 규칙.
- `Shared/SenderMediaPipeline.swift`: VideoToolbox H.264와 AVAudioConverter PCM 어댑터. 원본 프레임 대기 한도 2개, 최대 해상도 1920, 기준 프레임 간격 1초입니다.
- `Shared/SenderNetwork.swift`: Network.framework 전송, heartbeat, 연결 세대·재시도·최대 4MiB 대기열. 압축 데이터 혼잡 시 방송을 종료해 참조 프레임을 임의로 버리지 않습니다.
- `Shared/SenderPreferences.swift`: 검증 후 App Group 저장/복원.
- `Tests`: 입력·저장·행동·암호화·네이티브 합성 미디어 테스트.
- `Verification/SenderMock.swift`: 실제 화면을 캡처하지 않는 짧은 Swift → Rust TCP 검증용 실행 파일.

## 짧은 모의 검증

```sh
swift test --package-path ios
xcodebuild -project ios/PhoneMirrorSender.xcodeproj -scheme PhoneMirrorSender -sdk iphonesimulator -derivedDataPath ios/.build/XcodeSimulator CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/PhoneMirrorSender.xcodeproj -scheme PhoneMirrorSender -sdk iphoneos -derivedDataPath ios/.build/XcodeDevice CODE_SIGNING_ALLOWED=NO build
swift build --package-path ios --product SenderMock
cargo build --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --example ios_wifi_mock_receiver
```

별도 터미널에서 `desktop/src-tauri/target/debug/examples/ios_wifi_mock_receiver /tmp/phone-ios-wifi-code.txt`를 실행한 다음 8초 안에 `ios/.build/debug/SenderMock /tmp/phone-ios-wifi-code.txt`를 실행합니다. 검증기는 loopback만 열고 모의 영상·PCM 최소 4패킷씩 수신한 뒤 종료하며 임시 코드를 삭제합니다. 두 실행 파일을 미리 빌드하세요. 이 검증은 ReplayKit 실기기 방송이나 전체 Windows 앱 실행 검증이 아닙니다.

Apple 자료: [ReplayKit 방송 버튼](https://developer.apple.com/documentation/replaykit/rpsystembroadcastpickerview), [로컬 네트워크와 앱 확장 권한](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

## Windows USB 송출

Windows 앱에서 `iPhone USB 수신 시작`을 눌러 표시된 `PMU1|27483|연결 키` 코드를 저장하세요. USB 코드에서는 네트워크 사전 접속 확인 대신 코드 저장 후 화면 방송을 활성화합니다. 시스템 방송을 시작하면 확장이 iPhone 루프백 포트에서 연결을 기다리고, Windows의 Apple USB 서비스가 이 포트에 접속합니다. 같은 Wi-Fi에 연결할 필요가 없습니다. 기존 `PMW1|주소:포트|연결 키` Wi-Fi 코드는 그대로 지원합니다.

화면과 앱 소리만 ReplayKit에서 가져오고 마이크 샘플은 제외합니다. 송출 앱을 실제 iPhone에 설치하려면 기존 Signing Team·App Group 설정과 기기용 서명이 필요합니다. 시뮬레이터/기기 SDK의 unsigned 빌드는 설치·USB 수신 증거가 아닙니다. 컴퓨터 수신을 새로 시작해 키가 바뀌면 방송을 종료하고 새 코드를 저장한 뒤 방송을 다시 시작하세요.

## QR 코드 스캔

컴퓨터 앱에서 USB 또는 Wi-Fi 수신을 시작하면 연결 QR 코드가 나옵니다. 이 앱의 `QR 코드 스캔`에서 카메라 접근을 허용하고 QR을 읽은 뒤 `연결 코드 저장`을 누르세요. 이어서 기존 시스템 화면 방송 버튼을 사용합니다. 스캔이 자동으로 화면 방송을 시작하지는 않습니다.

USB `PMU1`과 Wi-Fi `PMW1` 코드를 모두 지원하며 기존 입력 검증을 그대로 사용합니다. 취소·권한 거부 시 직접 입력할 수 있고 스캔 화면을 닫으면 카메라를 종료합니다. 사진·영상·소리는 저장하지 않습니다. 코드 적용 전 사용자 확인을 유지하고 스캔 중복·취소 이후 늦은 권한/인식 응답은 폐기합니다. `NSCameraUsageDescription`은 송출 앱에만 추가하며 방송 확장이나 기존 Mac Swift 앱의 권한은 변경하지 않습니다.

## Wi-Fi 자동 화질

`Wi-Fi 자동 화질`은 기본으로 켜져 있습니다. 설정을 변경하면 연결 코드를 다시 저장하고 다음 방송을 시작하세요. Wi-Fi 송출 소켓의 완료 지연이 지속되면 영상 비트레이트를 6→3→1.5Mbps로 낮추며 안정된 상태가 지속되면 복원합니다. 해상도·프레임·앱 소리는 유지하고 실행 중인 VideoToolbox 인코더의 목표 비트레이트만 변경합니다. USB 방송에는 적용하지 않습니다.

정책은 Network.framework와 인코더에서 분리한 `SenderAdaptiveQualityPolicy`이며 단조 시각을 입력으로 받습니다. 150ms 이상 송출 완료 지연이 연속 3개 측정 구간에 발생하면 하향, 40ms 이하가 10개 구간 지속되면 상향합니다. 최소 변경 간격은 각각 15초와 30초입니다. `contentProcessed`는 로컬 송출 완료이며 컴퓨터가 받은 시각이나 RTT가 아닙니다. 인코더가 비트레이트 변경을 거부하면 방송을 유지합니다. 기존 4MiB 송출 큐 제한도 유지합니다.

설정 누락은 기본값으로 복원하고 잘못된 저장 형식은 기존 오류 처리로 안내합니다. 정책·저장 경계 및 합성 프레임을 사용한 실제 Mac VideoToolbox 비트레이트 변경을 테스트했습니다. iPhone 실기기·ReplayKit 방송·실제 Wi-Fi 혼잡·장시간 검증은 하지 않았습니다. [Apple 목표 비트레이트 API](https://developer.apple.com/documentation/videotoolbox/kvtcompressionpropertykey_averagebitrate)를 사용합니다.
