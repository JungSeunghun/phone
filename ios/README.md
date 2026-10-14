# Phone Mirror Sender

독립적인 iPhone/iPad 송출 앱과 ReplayKit Broadcast Upload Extension입니다. 기존 macOS Swift 앱은 수정하지 않습니다. 수신기는 Rust/Tauri Phone Mirror Desktop이며 Mac과 Windows에서 같은 수신 프로토콜을 사용합니다. iOS 16 이상, 컴퓨터와 같은 로컬 네트워크가 필요합니다.

## UI 언어

앱 상단 **언어 설정 → 언어 / Language**에서 **한국어** 또는 **English**를 선택하세요. 선택은 App Group에 저장되고 송출 앱과 Phone Mirror 키보드 확장이 공유합니다. 열려 있던 키보드는 다시 열면 변경된 언어를 표시합니다. 송출 설정·연결 코드는 유지합니다. 시스템 권한·화면 방송 창은 운영체제의 언어 설정을 따릅니다.

## 빌드와 사용

1. `PhoneMirrorSender.xcodeproj`를 Xcode에서 열고 `PhoneMirrorSender` scheme을 선택합니다.
2. 실기기 설치 시 앱·`PhoneMirrorBroadcast`·`PhoneMirrorKeyboard` 세 타깃의 Signing Team을 설정합니다. 본인의 등록 가능한 bundle ID 및 App Group으로 변경하면 세 entitlements와 `SenderSharedContainer.identifier`, 앱 bundle ID + `.Broadcast` / `.Keyboard` 확장 ID를 함께 맞추세요.
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
- `Shared/SenderPreferences.swift`: 검증 후 App Group Keychain 저장/복원.
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

## iPhone 다국어 붙여넣기와 직접 입력

`PhoneMirrorKeyboard`는 공개 `UITextDocumentProxy` API로 현재 선택한 입력칸에 텍스트를 삽입하는 키보드 확장입니다. 다른 앱의 입력칸에서 사용하려면 업데이트된 송출 앱과 키보드 확장을 iPhone에 설치해야 합니다. 기존 Mac Swift 앱은 변경하지 않으며 Rust/Tauri 데스크톱에서 사용합니다.

1. 컴퓨터에서 iPhone을 선택하고 설정의 **iPhone 다국어 입력 연결 → iPhone 키보드 연결 시작**을 누릅니다. 표시된 `PMK1` 코드를 복사합니다. 화면 송출용 `PMW1` / `PMU1` 코드와 별개입니다.
2. iPhone 송출 앱의 **컴퓨터 키보드 입력**에 코드를 붙여 넣고 **키보드 연결 코드 저장**을 누릅니다. 앱에서 로컬 네트워크 권한을 허용합니다.
3. iPhone 설정 → 일반 → 키보드 → 키보드 → 새로운 키보드 추가에서 **Phone Mirror**를 추가합니다. 해당 키보드의 **전체 접근 허용**을 켭니다.
4. 입력할 앱에서 텍스트 칸을 선택하고 지구본 버튼으로 **Phone Mirror** 키보드를 선택합니다. 컴퓨터에서 화면 수신이 시작되고 키보드 연결이 확인되면 **폰에 붙여넣기**, 영상에 포커스한 **⌘V / Ctrl+V**, **다국어 직접 입력**을 사용할 수 있습니다. 한글·일본어 등 IME 조합은 확정된 문자열만 전송합니다.

화면은 Mac USB·Windows USB·Wi-Fi 중 어느 경로로 보더라도 입력 채널은 같은 로컬 네트워크를 사용합니다. 키보드를 닫거나 다른 키보드로 전환하면 입력 연결을 종료합니다. 키보드를 다시 선택하거나 **연결** 버튼을 누르면 다시 인증하며, 이전 연결에서 대기하던 입력은 재전송하지 않습니다. 컴퓨터에서 연결 종료·기기 변경·앱 종료 시 입력을 중단합니다. 새 입력 수신을 시작하면 새 코드가 필요합니다. 앱에서 코드를 삭제하거나 바꾸면 열린 키보드도 이후 원격 입력을 거부합니다.

텍스트는 iPhone 클립보드를 변경하지 않고 현재 입력칸에 삽입합니다. Backspace·Delete·Enter·좌우 이동을 지원하며 위·아래 이동과 마우스 조작은 지원하지 않습니다. 비밀번호 입력칸, 전화번호 키패드, 외부 키보드를 금지한 앱에서는 iOS가 기본 키보드를 사용하므로 이 기능을 사용할 수 없습니다. 전체 접근을 허용하지 않아도 확장의 기본 영문·숫자 키, 삭제·공백·줄바꿈·키보드 전환은 동작하지만 컴퓨터 입력은 비활성화됩니다.

입력은 임의 키와 연결별 challenge에서 파생한 방향별 AES-256-GCM 키로 암호화하고 순서를 검증합니다. 입력 문자열은 기록하거나 영구 저장하지 않습니다. 코드는 기존 App Group 설정에 로컬 저장하고 수신 키는 컴퓨터 메모리에만 둡니다. 인증 제한은 8초, 입력 ACK 제한은 3초이며 ACK는 키보드의 삽입 API 호출 후 전송합니다. 대상 앱의 글자 수 제한이나 입력 거부까지 보증하는 ACK는 아닙니다. 재시도 시 이미 전송한 텍스트를 자동으로 다시 보내지 않습니다.

Swift 도메인 테스트·Rust 수신 테스트·Chromium UI 테스트와 실제 TCP의 Rust ↔ 생산용 Swift 키보드 네트워크 코드 통합 테스트로 검증합니다. TCP 검증의 문서는 합성이며 iPhone 입력칸을 조작하지 않습니다. 시뮬레이터/기기 SDK unsigned 빌드는 실기기 설치와 다릅니다. 실제 iPhone 설치·전체 접근 권한·다른 앱 입력칸 검증은 아직 수행하지 않았습니다.

Apple 자료: [키보드의 텍스트 삽입](https://developer.apple.com/documentation/uikit/handling-text-interactions-in-custom-keyboards), [전체 접근과 지원 제한](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html).

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

## 프로젝트 라이선스

프로젝트 자체 코드는 [MIT 라이선스](../LICENSE)를 따릅니다. 외부 코드와 라이브러리는 각각의 원래 라이선스를 따르며 [서드파티 고지](../THIRD_PARTY_NOTICES.md)를 유지합니다.

## 연결 코드 보관

송출 설정과 키보드 연결 코드는 비밀키를 포함하므로 UserDefaults 대신 App Group `group.local.phone.sender`의 Keychain에 저장합니다. 앱·방송 확장·키보드 확장은 기존 App Group entitlement를 통해 같은 항목에 접근합니다. 개발자 계정의 provisioning profile에도 이 App Group이 등록되어 있어야 합니다. 항목은 `AfterFirstUnlockThisDeviceOnly`로 보호하며 iCloud 동기화나 다른 기기로의 이관을 허용하지 않습니다. 이 접근성은 최초 잠금 해제 이후 방송과 키보드의 백그라운드 실행을 지원합니다.

기존 UserDefaults 값은 읽을 때 검증하고 Keychain 저장이 성공한 뒤 삭제합니다. 저장 실패 시 원본을 유지해 재시도하며, 새 코드 저장 실패 시 UserDefaults로 되돌아가지 않습니다. 저장소는 주입할 수 있어 테스트에서 실제 비밀키나 사용자의 Keychain을 건드리지 않습니다. 실기기에서 서명된 앱과 두 확장 간 Keychain 공유는 별도 확인이 필요합니다.
