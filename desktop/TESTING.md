# Rust + Tauri 검증 — 2026-10-11

## 좌측 메뉴 개선 TDD (2026-10-11)

- 메뉴 영역·설정 분류·수동 입력 접기 부재를 프론트 failing test로 확인한 후 구현했다. 기기 선택은 고정하고 기기 연결 → 화면 설정 → 연결 진단은 별도로 스크롤한다. Android 연결 패널은 별도 컴포넌트로 분리하며 기존 서비스·검증·저장 정책을 유지한다.
- 자동 재연결은 연결 설정, Android Wi-Fi 자동 화질은 화면 설정으로 옮겼다. 수신 측 iPhone 메뉴 명칭과 Android 연결 명칭을 일관되게 정리하고 기기 목록의 전송 준비 상태를 ‘사용 가능’으로 표시한다.
- QR 우선 표시와 수동 입력 접기/펼치기 반복, 입력값 보존, 자동 페어링·세션 시작 없음, 포트 0 거부·65535 허용 및 5/6자리 코드 경계를 검사했다. 800×540과 800×600에서 긴 메뉴를 스크롤해도 기기 선택과 새로 고침이 고정되고 수동 연결 입력에 접근할 수 있는지 브라우저로 검사했다.
- 프론트 전체 108개 및 최종 입력 경계 행동 10개 재검사, Chromium 전체 34개, 기존 Rust 백엔드 99개 회귀가 통과했다. 초기 QR 브라우저 검사는 새 접힌 수동 메뉴의 버튼을 검사하려다 실패했으며, 메뉴를 펼치는 실제 사용자 행동을 반영한 후 다시 통과했다. TypeScript/Vite 빌드도 통과했다. 서비스 구현 변경이 없어 백엔드에 같은 동작을 복제하는 테스트는 추가하지 않았다.
- Apple Silicon Mac 앱을 다시 빌드하고 ad-hoc 서명 검증 후 설치본에 반영했다. 설치 앱에서 QR 우선 메뉴, 수동 입력 펼치기, 스크롤 중 기기 선택 고정과 기본 상태 복원을 확인했다. 기기 연결이나 실기기 캡처·녹화는 실행하지 않았다. 이전 설치본은 ignored `dist/Verification/UX/SidebarInstalledBackup.*`에 보관한다. Windows UI 행동은 브라우저 모의 환경으로만 검증했으며 Windows 네이티브 빌드·실행은 수행하지 않았다.
- 기존 Swift 앱과 iPhone 송출 앱은 변경하지 않았다. 브라우저의 Android/iPhone 연결·캡처·녹화 회귀는 합성 미디어와 모의 IPC이며 실기기 증거가 아니다. 장시간 검증과 공개 배포·태그 푸시는 수행하지 않았다.

TDD 실패/통과 및 빌드 로그는 ignored `dist/Verification/UX/TestLogs/phone-sidebar-*`에 보관한다.

## 설치 앱 UI·UX 개선 TDD (2026-10-11)

- 전체 화면 상태 동기화와 기본 창 스냅샷 검증을 Rust 실패 테스트로 먼저 확인했다. macOS 창 버튼과 앱 버튼을 같은 native fullscreen API로 통일하고, OS 이벤트를 별도 창 정책에 전달한다. 초기 이벤트는 앱 서비스 등록 전에 안전하게 무시한다.
- 전체 화면 전환 대기는 OS 조회·시간·취소·대기를 주입하는 포트로 분리했다. 모의 시간으로 0/20/40ms 완료, 정확한 제한 시점 완료, 제한 이후 완료 거부, 취소·조회 실패·0 제한 값·기본 보기 상태를 검사했다. 테스트 자체는 실제로 기다리지 않는다. 네이티브 어댑터는 최대 2초 동안 OS 응답을 확인하고 UI 스레드를 막지 않는다.
- 연결 헤더 통합, 설정 버튼 문구, 비활성 설정의 접근성 설명, 전체 화면·PiP 캡처 메뉴 행동을 프론트 실패 테스트 후 구현했다. 캡처 조작은 재사용 가능한 CaptureActions로 분리하고 기존 서비스에 연결했다. 같은 캔버스와 세션을 유지한다.
- 최소 240×180에서 메뉴가 창 밖으로 넘치고 PiP 녹화 종료 버튼이 가려지는 실패를 기록한 뒤 레이아웃을 수정했다. 브라우저에서 메뉴 안의 스크린샷 저장·녹화 시작·녹화 중 캡처 차단·종료, 포커스 복원, 메뉴 Esc와 보기 Esc의 구분을 확인한다. 녹화 상태·시간·일시 정지·재개·종료는 항상 메뉴 밖에 남는다.
- 자동 검증: Rust 백엔드 99개, 프론트 107개, Chromium 행동 32개, 릴리즈 정책 14개 통과. 기존 iPhone USB/Wi-Fi·Android 연결, 마우스 조작, 소리, 캡처, 녹화 일시 정지·재개, 자동 화질, 연결 진단 회귀를 포함한다. 영상 성능은 기존 짧은 합성 영상 검증만 실행했다.
- 최종 Apple Silicon Mac 앱을 빌드하고 로컬 ad-hoc 서명 검증 후 `/Applications/Phone Mirror Desktop.app`에 반영했다. 이전 설치본은 ignored `dist/Verification/UX/InstalledBackup.*`에 보관했다. 설치 앱에서 Android Wi-Fi 영상 수신, macOS 창 버튼과 앱 버튼의 전체 화면 상태 동기화, 기본 보기 복원, PiP 캡처 메뉴와 Esc 닫기, 설정 잠금 안내 및 연결 종료 후 설정 활성화를 짧게 확인했다. 실제 폰 캡처·녹화 파일은 생성하지 않았으며 녹화 행동은 합성 브라우저 테스트로 검증했다. 검증 연결은 종료했다.
- Windows GNU 백엔드 교차 컴파일과 Mac 전체 기능 Clippy 검사는 통과했다. Windows 전체 데스크톱 교차 컴파일은 이 Mac에 `x86_64-w64-mingw32-windres`가 없어 완료하지 못했다. 기존 Windows 네이티브 CI 구성은 유지했으며 이번 작업에서 원격 CI나 Windows 앱 실행을 수행하지 않았다.
- 기존 Swift 앱과 iPhone 송출 소스는 수정하지 않았다. 장시간 검증, iPhone 실기기 검증, 태그 푸시·공개 배포는 실행하지 않는다.

관련 red/green·플랫폼 검사·로컬 빌드 로그는 ignored `dist/Verification/UX/TestLogs/phone-ux-*`에 보관한다.

## DMG·Windows 설치 프로그램·릴리즈 초안 자동화 (2026-10-11)

- 배포 정책과 모의 GitHub API 테스트를 먼저 실행해 모듈 부재로 실패한 로그를 남기고 구현했다. unsigned 환경 변수 제거와 최종 DMG 검사·프론트 출력 분리도 각각 red 후 수정했다.
- Node 배포 테스트 14개 통과: 태그 형식/길이/버전 최소·최대/사전 배포 번호/버전 파일 불일치, 서명 모드·필수 값·자격 증명 분리, 설치 파일 이름/크기/해시/누락/중복/빈 파일/손상, 동일 파일 반복 준비, CLI 로컬 준비와 태그 업로드 차단, 초안 생성/반복 업로드/공개 릴리즈 수정 거부/커밋 불일치/업로드 오류/외부 공개 전환/취소/페이지 처리/주석 태그 해석/토큰 비노출을 확인했다. API는 주입한 모의 응답만 사용하며 실제 GitHub에 쓰지 않았다.
- 회귀: Rust 백엔드 96개, 프론트 104개, Chromium 행동 30개, Swift Core 35개·App 53개, iPhone 송출 Core 15개 통과. 최초 병렬 Mac 빌드 중 프론트 1개가 5초 제한을 넘겨 동시 작업자를 2개로 제한해 다시 통과했다. 이 시간 초과를 기능 통과로 계산하지 않았다.
- Prettier, Rust Clippy, Windows GNU 백엔드 교차 컴파일 검사, actionlint 통과. Windows MSVC 네이티브 테스트·NSIS 패키징은 GitHub Actions에 구성했으며 여기서 실제 Windows CI를 실행한 것은 아니다.
- Apple Silicon Mac에서 release DMG를 실제 생성했다. hdiutil checksum, DMG 읽기 전용 마운트 후 앱의 ad-hoc codesign 검증, ARM64 실행 파일, Applications 바로가기를 확인하고 마운트를 해제했다. 외장 볼륨 안의 마운트 경로에서는 권한 오류가 나 /tmp 마운트 경로로 다시 확인했다. Developer ID 서명·Apple 공증·Azure 서명은 인증서 없이 실행하지 않았다.
- 기존 Swift 소스·번들은 이번 배포 작업에서 수정하지 않았다. 실기기·장시간 검증·태그 생성/푸시·GitHub Releases 생성/공개는 수행하지 않았다.

red/green·빌드·회귀 로그는 ignored `dist/Verification/Release/TestLogs`에 보관한다. 실제 로컬 설치 파일은 `dist/Release/stages/macos-arm64`에 있다. 설치와 서명 설정은 [RELEASING.md](RELEASING.md)를 참고한다.

기존 Swift 앱은 유지하고 독립된 앱을 추가했다. 프론트와 Rust 도메인/서비스 테스트를 먼저 작성해 미구현 모듈의 실패를 확인한 뒤 구현했다.

## TDD 회귀 기록

- 주소·포트·페어링 코드·패킷 플래그·최대 길이 및 설정 허용 값 테스트를 먼저 작성했다.
- `[IPv4]:port`가 백엔드에서 통과하는 프론트/백엔드 불일치를 실패 테스트로 재현한 뒤 IPv6에만 대괄호를 허용했다.
- 교체한 세션이나 앱 종료로 취소한 세션 ID가 다시 시작되는 실패를 재현하고 중복·늦은 시작을 차단했다.
- ADB 포트 할당 중 취소하면 할당된 포워딩이 남는 실패를 재현했다. 유한한 할당 결과를 받아 포트를 기록한 뒤 정확히 해당 포워딩과 임시 서버 파일을 정리하도록 수정했다.
- 이전 디코더 오류 처리의 늦은 완료가 새 세션의 `live` 상태를 덮는 실패를 재현하고 세대 검증을 추가했다.
- 잘못된 디코딩 크기가 캔버스를 먼저 변경하는 실패를 재현하고 크기를 검증한 뒤 그리도록 수정했다.
- 첫 실기기 UI 확인에서 세로 영상 영역이 창보다 커지는 문제를 발견했다. 800×600, 1120×780, 1440×900 창과 세로/가로 영상 조합으로 브라우저 테스트를 작성해 세로 3개 실패를 확인하고 영상 영역을 창 안에 고정했다.

## 자동 검증 범위

- Rust: IPv4/IPv6, 포트 1/65535 및 잘못된 숫자·문자, 정확히 6자리 ASCII 코드, 기기 ID 1/256/257자, USB/Wi-Fi 목록과 Bonjour 공백·충돌 이름, 최대 16MiB 패킷·안전한 타임스탬프 경계.
- Rust: 표준 입력으로만 코드 전달, 실패 문구와 종료 상태 검사, 안정된 일련번호로 두 연결 방식 구분, 새 서비스 주소와 접미사, 다른 폰의 주소 재사용 차단, 일시적인 빈 mDNS 결과에 대한 주소 유지, 손상/누락된 저장 파일.
- Rust: 시작 전/후 취소, 중복 시작, 교체와 늦은 종료, 포트 할당 중 취소 정리, 실제 subprocess 표준 입력·실행 중 취소·시간 제한. 실제 `/bin/cat`·`/bin/sleep` 프로세스 시험은 Unix에서만 실행한다.
- 프론트: 발견만으로 시작하지 않음, 입력·버튼 경계, 동일 폰의 USB/Wi-Fi 선택, 중복 시작/페어링, 비밀 삭제, 실제 렌더링 후에만 live, 늦은 패킷/오류/완료, 수동 종료, 설정 복원과 손상 복구.
- 프론트: 첫 프레임 시간 제한 정확히 15초, 재연결 지연 경계·5회 제한·기기 부재·연결 방식 유지, H.264 SPS·키 프레임 처리, 디코더 지연 큐 제한, 프레임 닫기 및 종료 후 그리기 차단.
- 브라우저: 세 창 크기와 두 영상 방향에서 전체 영상 캔버스가 뷰어/푸터 안에 포함되고 종료 후 숨겨지는지 확인.

현재 **Rust 50개, 프론트 67개, 브라우저 17개**가 통과했다. Rust 기본 Tauri 기능을 포함한 테스트, Clippy 경고 금지, 포맷 및 TypeScript/Vite 빌드도 확인한다. 기존 Swift XCTest **88개**의 이전 검증 기록은 유지하며, 이번 iPhone 변경에서 Swift 소스·번들은 수정하지 않았다.

## 실기기 및 플랫폼 범위

- macOS의 실제 Tauri 앱에서 Samsung SM-S901N/Android 16의 **USB 및 Wi-Fi 886×1920 영상**이 캔버스에 표시되고 실제 첫 프레임 후 상태가 live로 바뀌는 것을 확인했다.
- 앱에서 USB 종료 후 Wi-Fi를 선택해 다시 시작했다. 종료 후 이 앱이 생성한 포워딩이 제거되고 기존 다른 포워딩은 유지되는지 확인했다.
- USB/Wi-Fi Rust 서비스의 실제 스트림은 아래 진단 예제로 다시 검증하고 출력 미디어는 ignored `dist/Verification/RustTauri`에 보관한다. 외부에 공유하지 않는다.
- 진단 예제에서 USB·Wi-Fi 각각 실제 프레임 11개를 수신했다. 두 H.264 파일을 FFmpeg로 끝까지 디코딩해 오류 없이 통과했다. 세션을 멈춘 뒤 두 진단이 생성한 포워딩도 제거됐다.
- macOS release 앱 번들(약 11MiB)을 빌드하고 ad-hoc 서명을 검증했다. scrcpy 라이선스와 출처 기록이 리소스에 포함되어 있다.
- release 앱을 다시 실행해 Wi-Fi 선택이 복원되지만 영상은 자동 시작하지 않는 것을 확인했다. 수동 시작 후 전체 세로 폰 화면이 창 안에 표시되고 `Wi-Fi` 및 `886×1920` 상태가 표시되는지 확인했다.
- Rust 백엔드는 `x86_64-pc-windows-gnu` 대상 컴파일 검사를 통과했다. **Windows PC에서 Tauri UI·설치 프로그램·실기기 실행은 아직 검증하지 않았다.** Windows/macOS 네이티브 테스트와 패키징 CI는 구성했으며 원격 저장소가 없어 여기서 실행하지 않았다.
- 새 Rust 앱의 페어링은 입력·표준 입력·성공/실패 처리 자동 테스트로 확인했다. 실기기 Wi-Fi 연결은 기존 ADB 호스트의 페어링을 사용했다. 새 코드로 다시 페어링하거나 물리적으로 USB 케이블을 분리한 시험은 하지 않았다.

저장소 루트에서 실행:

```sh
mkdir -p dist/Verification/RustTauri
cargo run --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --example android_stream_smoke -- usb "$PWD/dist/Verification/RustTauri/USB.h264"
cargo run --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --example android_stream_smoke -- wifi "$PWD/dist/Verification/RustTauri/WiFi.h264"
ffmpeg -v error -i dist/Verification/RustTauri/USB.h264 -f null -
ffmpeg -v error -i dist/Verification/RustTauri/WiFi.h264 -f null -
```

실기기 진단은 8초 동안 받은 H.264 패킷을 저장하고 프레임 수신을 확인한 뒤 종료·포워딩/임시 서버 파일 정리를 수행한다. 자동 테스트의 red/green, 빌드, 플랫폼 및 실기기 로그는 `dist/Verification/RustTauri/TestLogs`에 보관한다.

## 캡처 기능 TDD (2026-10-11)

- `media_tests.rs`와 `MediaCaptureController.test.ts`를 먼저 작성해 구현 모듈 부재로 red를 확인했다. PNG 인코딩 및 녹화 Stop의 응답이 없을 때 정확히 10초에 종료하는 회귀 테스트도 각각 red 후 수정했다.
- 캡처 모듈은 USB/Wi-Fi 전송과 분리했고 라이브 프레임이 없을 때 실행 차단, 중복 클릭 차단, 저장 취소, 빈 출력/인코더/저장 실패, 연결 종료 시 한 번만 마무리, 재연결 후 자동 녹화 방지, 저장 대화상자 중 앱 종료 대기를 테스트했다.
- 캔버스 소스는 코덱 협상, 최종 청크 포함, 반복 Stop, 트랙 해제, 용량 초과 및 시간 경계를 확인했다. Rust는 허용 형식·서명·확장자, 크기 0/1/256MiB/초과/usize::MAX, 기존 파일 보호와 임시 파일 정리를 검사했다.
- 실제 Chromium MediaRecorder로 생성한 영상을 다시 읽어 320×640 해상도의 재생 가능 데이터를 확인하고 PNG 원본 크기도 검증했다. 모의 인코더 테스트와 구분한다.
- macOS 기본 Quit 메뉴가 저장 단계를 건너뛰는 실기기 회귀를 발견했다. 커스텀 종료 메뉴로 앱의 녹화 저장 절차를 거치도록 수정했다.
- 캡처는 영상만 저장한다. 최대 256MiB이며 8MiB 안전 여유 전에 종료를 요청한다. 녹화 중 스크린샷은 비활성화하며 저장 취소·실패 후 다시 실행할 수 있다.

관련 red/green 로그는 `dist/Verification/RustTauri/TestLogs/phone-media-*`에 보관한다. 실제 폰 미디어는 `dist/Verification/RustTauri/MediaCapture`에만 저장하며 외부에 공유하지 않는다. Windows 네이티브 MediaRecorder·저장 창·설치 패키지는 Windows PC에서 추가 검증해야 한다.

캡처 실기기 검증: Samsung SM-S901N/Android 16을 연결한 macOS release 앱에서 USB/Wi-Fi 각각 886×1920 PNG를 저장했다. Wi-Fi 녹화는 연결 종료로 마무리해 H.264 MP4 약 11.03초를 저장했고, USB 녹화는 수정된 Command-Q 종료 메뉴로 마무리해 H.264 MP4 약 2.00초를 저장했다. 두 MP4와 두 PNG는 FFmpeg 디코딩을 오류 없이 통과했다. 저장 후 앱 종료 및 새 세션의 포워딩 정리를 확인했다. 종료 메뉴 수정 전 강제 종료로 남았던 해당 앱의 포워딩 두 개도 정확한 포트만 제거했다. 기존 Swift 포워딩은 유지했다. 물리적 USB 분리 및 Wi-Fi 끊김은 자동 행동 테스트로 대체했으며 실제 케이블 분리 시험으로 표현하지 않는다.

최종 macOS 앱 번들을 다시 빌드하고 `dist/Phone Mirror Desktop.app`의 ad-hoc 서명을 검증했다. 캡처 API가 응답하지 않을 때 PNG 및 녹화 종료 각각 10초의 시간 제한을 두며, 녹화 종료 제한에서 캡처 트랙을 해제한다. TypeScript/Vite 빌드, Prettier, Rust 기본 기능 포함 테스트/Clippy 경고 금지/rustfmt 및 Windows 백엔드 교차 컴파일 검사가 통과했다. 기존 Swift 테스트 35+53=88개도 다시 통과했다.

## 컴퓨터 오디오·마우스 제어 TDD (2026-10-11)

- `interaction_tests.rs`, `MouseInputController.test.ts`, `WebAudioPlayer.test.ts`를 먼저 작성해 모듈 부재로 red를 확인했다. 드래그 중 연결 종료에서 포인터 취소가 전달되지 않는 `UnexpectedEof` 회귀도 red 후 수정했다.
- Rust: scrcpy 5.0 터치/스크롤/뒤로 메시지 바이트, 위치 0/최대/영역 밖·크기 0/8193, 스크롤 ±16/초과/NaN, PCM 패킷 크기·정렬·플래그·잘림, 입력 큐 64/65·닫힘·취소, 터치 취소 메시지의 순서를 검사했다.
- Rust: 지원되지 않는 오디오는 상태를 표시하고 영상 세션을 종료하지 않으며, 큰 PCM payload는 할당 전 거부하고 부분 패킷 수신 중 취소도 종료한다.
- 프론트: 검은 여백·실제 영상 경계·창/영상 크기·영역 밖 드래그를 좌표로 변환하고 중복 down·불필요한 move·blur 취소·이전 세션 큐 폐기·스크롤 경계를 검사했다. 오디오 준비·음소거·연결 종료 및 늦은 PCM 폐기도 확인했다.
- 오디오: signed 16-bit stereo의 최소/최대 샘플을 변환하고 예정된 재생 버퍼 제한·트랙 해제·음소거 및 AudioContext 종료를 검증했다.
- 실제 Chromium에서 클릭/드래그/휠/우클릭을 발생시켜 전송된 입력과 여백 차단을 확인하고 실제 AudioContext에 테스트 PCM을 전달해 재생 상태 및 음소거 버튼을 검증했다.
- macOS release 앱/Samsung SM-S901N Android 16: USB에서 폰의 뒤로 버튼 클릭·우클릭 뒤로가기로 실제 화면이 이동했다. Wi-Fi에서 휠 및 드래그로 폰 설정 목록을 조작했다. 양쪽 연결 모두 영상과 컴퓨터 오디오 재생 상태를 확인했다.
- 자체 생성한 440Hz WAV를 폰의 로컬 플레이어로 재생해 USB 진단은 영상 218패킷/PCM 345패킷, Wi-Fi는 영상 223패킷/PCM 340패킷을 수신했다. 양쪽 raw PCM에 0이 아닌 샘플 403,478개가 있었으며 주파수 분석의 최대값이 440Hz였다. 컴퓨터의 물리 스피커 음량을 별도 측정한 것으로 표현하지 않는다.
- 서비스 진단은 `android_interaction_smoke` 예제이며 Samsung 로컬 플레이어와 생성한 WAV 파일을 사용하는 명시적 실기기 fixture다. 일반 사용자 실행이나 자동 단위 테스트에 포함하지 않는다. 소리나 무음 설정을 바꾸지 않고 테스트 후 해당 WAV를 제거한다.
- Windows 백엔드 교차 컴파일은 확인했다. Windows 네이티브 오디오 출력·마우스·Tauri UI는 실제 Windows PC에서 추가 검증해야 한다. Swift 소스는 이번 작업에서 수정하지 않았다.

scrcpy 5.0 프로토콜 출처: [ControlMessageReader](https://github.com/Genymobile/scrcpy/blob/v5.0/server/src/main/java/com/genymobile/scrcpy/control/ControlMessageReader.java), [AudioConfig](https://github.com/Genymobile/scrcpy/blob/v5.0/server/src/main/java/com/genymobile/scrcpy/audio/AudioConfig.java). 오디오 PCM과 로그는 ignored `dist/Verification/RustTauri`에만 보관한다. 현재 녹화는 기존과 같이 영상만 저장한다.

최종 release 번들을 `dist/Phone Mirror Desktop.app`에 갱신하고 ad-hoc 서명을 검증했다. 종료 후 새 USB/Wi-Fi 포워딩은 제거되고 기존 Swift 포워딩만 남는 것을 확인했다. 최종 자동 검증은 Rust 26개, 프론트 41개, 브라우저 8개이며 Prettier/rustfmt/TypeScript/Vite/Clippy 경고 금지와 Windows 백엔드 대상 컴파일 검사도 통과했다.


## 전체 화면 · PiP TDD (2026-10-11)

- Rust `window_presentation.rs` 테스트와 프론트 `WindowPresentationController.test.ts`를 먼저 작성해 모듈 부재로 red를 확인했다. UI 버튼 부재도 실패 테스트로 기록했다.
- Rust: 허용 모드/알 수 없는 문자열, 영상 크기 1/8192 및 0/8193, 작은 모니터 최소 크기, 음수 모니터 위치, NaN/Infinity/음수 작업 영역, 중복 전환, 기본 → PiP → 전체 화면 → 기본, 원래 위치·크기·최대화 상태의 보존, 전환 실패 롤백 및 복원 재시도를 확인했다.
- 프론트: 실제 프레임 전 차단, 중복 클릭, 전환 중 연결 종료, 컴포넌트 종료 후 늦은 응답과 원래 창 복원, 전환 실패 안내/재시도, Esc와 캔버스·연결 세션 유지, 네이티브 PiP 닫기 상태 동기화를 확인했다.
- 네이티브 복원 이벤트 뒤 이전 전환 응답이 PiP 상태를 덮는 회귀 테스트에서 `expected 'pip' to be 'normal'` red를 확인하고 네이티브 이벤트 세대로 해결했다.
- 브라우저: 240×180 PiP 최소 창에서 세로·가로 영상과 복원 버튼·마우스 좌표가 유효하고 동일 캔버스가 유지된다. 실제 MediaRecorder는 프레임을 생성해 녹화를 진행하며 전체 화면/PiP 전환 후에도 녹화가 유지되고 연결 종료 때 저장되는지 확인한다.
- macOS 실기기 검증 중 전체 화면 진입 후 WKWebView 키보드 포커스가 빠져 Esc가 전달되지 않는 동작을 발견했다. 네이티브 창·WebView 포커스와 메뉴의 Esc 복원 경로를 추가했다. 최종 실제 앱 검증 결과는 아래에 기록한다.
- 이번 작업에서 Swift 앱 소스와 번들은 수정하지 않았다. Windows 백엔드 교차 컴파일 검사는 통과했으며 Windows 네이티브 전체 화면/PiP 실행 검증은 실제 PC에서 필요하다.

로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-window-*`에 보관한다. 자동 검증 수는 Rust 30개, 프론트 47개, Chromium 브라우저 11개다.

최종 macOS release 앱에서 Samsung SM-S901N/Android 16의 USB와 Wi-Fi 가로 영상(1920×886)을 확인했다. USB는 전체 화면 진입 직후 Esc 복원과 PiP 진입/Esc 복원을 확인했다. Wi-Fi는 전체 화면/PiP 전환 및 PiP 닫기에서 기본 보기로 복원되는 것을 확인했다. 복원 시 원래 1120×780 창이 유지되며 같은 영상과 컴퓨터 오디오 재생 상태가 이어진다. 세로 영상과 최소 PiP 크기의 조작은 별도 브라우저 fixture로 검증했다. macOS 포커스 수정 뒤 Wi-Fi에서도 Esc 복원을 재검증했다. 최종 번들을 다시 ad-hoc 서명해 검증했고, USB 세션 종료 후 앱이 생성한 USB 포워딩만 제거된 것을 확인했다.


## 영상 중심 UI·녹화 상태 TDD (2026-10-11)

- 녹화 시계와 표시 형식, 공통 녹화 조작, 고정 연결 패널 및 네이티브 창 테두리 계산의 실패 테스트를 먼저 실행했다. 모듈 부재, 600px 높이에서 연결 버튼이 화면 밖으로 밀리는 동작, 전체 화면/PiP의 경과 시간 부재를 red로 기록하고 구현했다.
- 프론트: 0/999/1000ms, 역행·NaN 시계, 한 시간 경계·최대 표시값·잘못된 입력, 중복 시작·단일 타이머·정확한 해제, 재녹화 후 이전 용량 콜백 폐기를 검사했다. 백그라운드 타이머가 실행되지 않아도 종료 시 실제 경과 시간을 반영하는 회귀도 red 후 수정했다.
- 오디오 상태를 명시적인 타입으로 분리했다. 정상 재생 시 재생 버튼을 숨기고 준비/차단 상태에서 다시 표시한다. 종료 후 늦은 오디오 준비 실패·상태 갱신이 새 상태를 덮지 않는 테스트와 최초 연결의 오디오 준비 실패가 정상 표시되는 테스트를 각각 red 후 수정했다.
- Rust: 모니터 작업 영역에서 실제 창 테두리·제목 표시줄을 제외해 PiP 크기를 계산한다. 음수 모니터 좌표, 유한하지 않은 수, 음수 테두리, 최소 240×180 이하/경계 및 영상 방향별 계산을 검사했다.
- 실제 Chromium: 800×600에서 Wi-Fi 설정을 펼쳐도 연결 버튼이 유지되고, 영상 시작 후 설정이 접히며 다시 열리는 행동을 확인했다. 240×180 PiP와 전체 화면에서도 녹화 표시·증가하는 시간·종료 버튼이 뷰포트 안에 있고, 기본 보기로 복원하지 않고 종료·저장할 수 있다. 동일 캔버스와 실제 MediaRecorder를 사용하며 세 창 크기·세로/가로 영상의 배치도 검사했다.
- macOS release 앱/Samsung SM-S901N Android 16: Wi-Fi 1920×886 영상을 녹화해 일반 → 전체 화면 → 기본 → PiP로 전환해도 녹화 시간이 이어졌다. PiP에서 직접 종료하고 네이티브 저장 창으로 H.264 MP4 20.343초를 저장했다. USB에서는 전체 화면에서 직접 녹화를 종료하고 MP4 6.407초를 저장했다. 두 파일을 원본 시간 기준으로 FFmpeg 디코딩해 오류 없이 통과했다.
- macOS에서 Wi-Fi 설정 확장 후에도 연결 조작이 상단에 유지되는 것을 확인했다. PiP 연결 종료와 전체 화면 연결 종료 모두 기본 보기를 복원했다. 종료 후 이 앱이 생성한 포워딩이 제거되고 기존 Swift 포워딩은 유지됐다. 물리적인 케이블 분리 시험은 하지 않았다.
- 최종 Rust 31개·프론트 54개·브라우저 14개가 통과했다. Prettier/rustfmt, TypeScript/Vite, Rust 기본 Tauri 기능 포함 테스트, Clippy 경고 금지, Windows 백엔드 대상 컴파일 검사를 통과했다. 최종 macOS 앱을 빌드하고 `dist/Phone Mirror Desktop.app`의 ad-hoc 서명을 검증했다. Windows 네이티브 UI·저장 창은 Windows PC에서 검증하지 않았다. 이번 작업에서 기존 Swift 앱 소스·번들은 수정하지 않았다.

TDD red/green 및 검증 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-ux-*`, 실기기 녹화는 ignored `dist/Verification/RustTauri/ViewerUX`에만 보관한다. 녹화는 영상만 저장하며 검증 미디어는 외부에 공유하지 않는다.


## 영상 성능 점검 (2026-10-11)

- 코드 검토에서 과부하 시 디코더를 초기화한 뒤 scrcpy 기본 10초 기준 프레임 간격을 기다릴 수 있음을 발견했다. 모든 지원 프레임 설정에서 `video_codec_options=i-frame-interval=1`이 전달되는 Rust 테스트를 먼저 red로 확인하고 수정했다. 8Mbps와 기존 USB/Wi-Fi·오디오 설정은 유지한다. 키 프레임 빈도 증가는 같은 비트레이트에서 압축 효율과 교환 관계가 있다.
- 디코더 큐 12/13 경계, 참조 초기화 후 delta 무시/키 프레임 복구, 이전 디코더의 늦은 출력 폐기·프레임 해제를 테스트한다. 하드웨어 우선 힌트는 headless Chromium에서 디코더 종료를 유발했다. 사용 가능한 디코더 선택을 시스템에 맡기는 `no-preference`를 명시하고 해당 회귀 red를 기록했다. 하드웨어 디코딩을 강제하거나 지원된다고 가정하지 않는다.
- `video-performance.spec.ts`: 1920×886, 60fps, 3초 움직임 fixture를 실제 VideoEncoder로 H.264 인코딩한 뒤 `WebVideoRenderer`로 실시간 간격에 맞춰 재생한다. 캡처 없음/실제 MediaRecorder 켜짐 각각 180/180 프레임 표시, 디코더 큐 최대 1을 확인했다. 마지막 전체 테스트 실행에서 약 60.11/60.03fps, 출력 간격 p95 17.8/17.8ms, 최대 20.1/18.6ms, 패킷 디코더 입력→캔버스 drawImage p95 3.1/2.3ms였다. 수치는 관측값이며 CI에서 특정 FPS/지연을 보장하는 임계값으로 사용하지 않는다. 프레임 보존·큐 제한·녹화 결과만 회귀 조건이다.
- 이는 이 Mac의 Chromium 합성 입력 테스트다. 실제 Tauri WKWebView/WebView2, 화면의 물리적 주사/디스플레이 출력, 폰→컴퓨터 전체 지연 및 장시간 부하 결과로 표현하지 않는다. 3초 테스트는 메모리 누수나 발열에 따른 장시간 성능을 증명하지 않는다.
- 실제 Samsung SM-S901N Android 16에 자체 생성한 1920×886/60fps testsrc2 MP4를 로컬 테스트 fixture로 재생했다. Rust USB/Wi-Fi 스트림을 각각 8초 동안 실행해 startup 이후 첫~마지막 패킷 사이의 수신 간격을 측정했다. USB 431프레임, 약 58.80fps, 도착 간격 p95 21.87ms/최대 39.67ms; Wi-Fi 430프레임, 약 59.20fps, p95 25.58ms/최대 40.44ms였다. 키 프레임은 양쪽 8개이며 영상 PTS의 최대 간격은 각각 1087.67/1069.23ms였다. 원본 H.264 두 파일은 FFmpeg 디코딩을 오류 없이 통과했다.
- 수신 FPS는 실제 영상 표시 FPS와 구분한다. Wi-Fi 품질·폰 인코더·컴퓨터 부하에 따른 끊김을 완전히 배제하지 않는다. 정지 화면 진단은 양쪽 약 10fps/11프레임 후 전송이 쉬었으며 이를 프레임 누락으로 계산하지 않았다.
- 최종 Rust 32개/프론트 55개/브라우저 15개, TypeScript/Vite, 포맷, Clippy 및 Windows 백엔드 대상 검사를 통과했다. 최종 Mac 앱 번들을 갱신하고 ad-hoc 서명을 검증했다. 기존 Swift 앱은 수정하지 않았다. Windows 네이티브 및 장시간 연속 재생 성능은 아직 검증하지 않았다.

테스트 코드와 진단 출력을 재현 가능하게 유지하며, 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-perf-*`, 미디어는 ignored `dist/Verification/RustTauri/Performance`에 보관한다. 앱 자체 실행에 FFmpeg나 테스트 파일이 필요하지 않다.

최종 macOS release 앱에서도 자체 생성한 움직임 영상이 USB 캔버스에 표시되고 녹화·저장을 완료하는 것을 확인했다. 저장한 1920×886 H.264 MP4는 FFmpeg 디코딩을 통과했다. 검증 중 영상 종료 후 원래 폰 앱 화면으로 돌아온 구간도 녹화에 포함돼, 이 파일 전체를 60fps 고정 입력으로 계산하지 않는다. 폰에 올린 테스트 MP4는 정확한 해당 경로만 제거했고 연결 종료 후 앱 포워딩이 제거되는 것을 확인했다. 기존 Swift 포워딩은 유지됐다.

scrcpy 기준 프레임 기본 간격과 서버 옵션 처리 출처: [SurfaceEncoder v5.0](https://github.com/Genymobile/scrcpy/blob/v5.0/server/src/main/java/com/genymobile/scrcpy/video/SurfaceEncoder.java).

최종 단독 브라우저 재실행도 180/180 프레임을 양쪽 모두 표시했다. 다만 캡처 없음에서 출력 간격 최대 51.1ms(큐 최대 2), 녹화 켜짐에서 최대 27.3ms(큐 최대 1)가 관측됐다. 평균 FPS가 60에 가깝고 프레임 손실이 없어도 모든 출력 간격이 16.7ms인 것은 아니므로, 이 결과로 무끊김을 보장하지 않는다. 패킷 입력→drawImage p95는 각각 12.4/7.2ms였다. 측정 재실행 간 편차도 로그에 보존했다.


## 계측 → 화면 표시 → 원본 녹화 TDD (2026-10-11)

- 사용자 지시에 따라 장시간 검증은 제외했다. 30분 이상의 실기기 테스트나 예약 작업은 실행하지 않았다.
- 계측: `VideoPerformance` 모듈 부재 red 후 수신 간격·디코딩·drawImage 시간·표시 간격 p95와 최대 큐를 구현했다. 역행/NaN 시간, 표본 최대 256개, 미완료 디코딩 시각 최대 64개, 세션 초기화 및 오래된 디코더 응답 폐기를 검사한다. UI 갱신은 1초마다 수행하며 실제 패널의 표시와 캔버스 유지도 Chromium에서 확인했다. OS CPU/RSS나 실제 모니터 출력 시각을 이 값으로 대체하지 않는다.
- 표시: 동기 drawImage를 기대하던 테스트와 최신 프레임·단일 animation callback·취소 후 늦은 callback 테스트를 red로 확인했다. 디코딩 프레임은 최신 하나만 보관하고 rAF에서 표시하며, 교체·취소·그리기 실패 때 프레임을 닫는다. 압축 입력은 임의로 버리지 않는다. 폰 해상도 변경과 연결/보기 수명도 기존 테스트로 확인했다.
- 녹화: `recording.rs` 부재 및 `NativeMediaCapture` 부재를 각각 Rust/프론트 red로 확인했다. MP4 0.14 라이브러리로 원본 Annex B NAL을 길이 접두어 형식으로 바꾸고 SPS/PPS·원본 PTS를 MP4에 기록한다. 인코딩이나 캔버스 캡처는 실제 앱의 녹화 경로에서 수행하지 않는다. 파일 전체를 JS 메모리나 IPC에 보내지 않고 불투명한 완료 파일 식별자로 저장한다.
- Rust: 시작 코드·잘못된 NAL·기준 프레임 이전 delta 무시, 중복 시작, 크기/프레임 경계, 설정 부재, 빈 녹화, 잘못된 녹화 식별자, 손상된 패킷·시간 역행, 연결 종료, 설정 변경 전 마무리, MP4 읽기·표본 수, 파일 게시 후 기존 파일 보호·임시 파일 정리를 확인했다. 예산 초과 해제의 정수 래핑을 red 후 수정했다. 용량 0/한계/초과/usize::MAX, 프레임 수 200,000 한계, 시간 0/3,599,999ms/3,600초/Duration::MAX도 검사했다.
- 저장 큐는 64패킷·8MiB로 제한하고 try_send로만 입력한다. 대기열 초과는 해당 녹화를 실패시켜 참조 프레임이 빠진 손상 파일을 보존하지 않으며, 영상 수신은 기다리지 않는다. 별도 스레드가 순차로 저장한다. 파일은 256MiB에서 8MiB 여유 전·200,000프레임·1시간에 마무리하며, 설정 변경도 변경 전 파일을 마무리한다. 마지막 정지 프레임의 시간은 종료 시점까지 유지한다.
- 프론트: 네이티브 시작 대기 중 연결 종료, Stop 중복, Blob 없이 저장 식별자 전달, 시작 실패, 비활성 세션 차단, 중복 polling 차단·Stop 후 늦은 상태 응답·타이머 해제를 확인했다. 이전 CanvasMediaCapture는 스크린샷과 브라우저 fixture에 남아 있으며 실제 앱 녹화에는 사용하지 않는다.
- Chromium 3초 합성 H.264 180프레임 테스트에서는 표시 수+최신 교체 수=180을 검증한다. 최종 실행은 녹화 fixture 없음에서 177표시/3교체, 기존 canvas 녹화 fixture에서 180표시/0교체였고 최대 디코더 큐는 2/1이었다. 이 fixture의 녹화는 Rust 녹화 성능 결과로 표현하지 않는다. 최대 표시 간격은 49.7/20.3ms로 무끊김을 보장하지 않는다.
- 실제 macOS release 앱/Samsung SM-S901N Android 16의 USB 원본 녹화를 전체 화면에서 종료·저장했다. MP4 886×1920, 1,283프레임, 22.507911초를 확인하고 FFmpeg 끝까지 디코딩을 오류 없이 통과했다. 진행 중 폰 앱/영상 내용과 방향은 사용자 기기 상태이므로 고정된 순수 합성 입력 벤치마크로 계산하지 않는다.
- 실제 USB 성능 패널의 한 관측은 평균 표시 55.8fps, 디코딩 p95 3.0ms, 최대 디코더 큐 3, 표시 간격 최대 106ms였다. 계측 추가와 원본 녹화 전환은 끊김 원인을 분리하고 재인코딩을 제거하는 변경이며, 모든 실제 표시 간격이 개선됐다고 주장하지 않는다.
- Wi-Fi에서도 일반 보기에서 시작한 원본 녹화를 PiP에서 종료·저장했다. H.264 MP4 886×1920, 1,418프레임, 47.453940초를 확인하고 FFmpeg 끝까지 디코딩을 오류 없이 통과했다. 이 구간의 폰 콘텐츠도 변했으므로 고정 60fps 입력의 손실률로 해석하지 않는다. 두 저장 뒤 녹화 캐시 파일과 앱 USB 포워딩이 정리됐으며 기존 Swift 포워딩은 유지됐다. 폰에 올린 테스트 영상은 해당 파일만 제거했다.
- 최종 Rust 44개·프론트 63개·Chromium 16개, TypeScript/Vite, 포맷, Clippy 경고 금지 및 Windows 백엔드 대상 검사를 통과했다. Windows 실제 UI·하드웨어 실행은 검증하지 않았다. 기존 Swift 소스·번들은 수정하지 않았다.
- 최종 macOS 앱을 다시 빌드하고 `dist/Phone Mirror Desktop.app`에 반영한 뒤 ad-hoc 서명을 검증했다. 새 MP4 라이브러리와 수치 라이브러리의 라이선스 파일도 앱 리소스에 포함했다.

로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-pipeline-*`, 실기기 미디어는 ignored `dist/Verification/RustTauri/Pipeline`에 보관한다. 외부에 공유하지 않는다.

## Mac USB iPhone 수신 · 모의 검증 TDD (2026-10-11)

- 범위는 Mac USB 화면 수신과 기존 스크린샷·MP4 녹화·전체 화면·PiP 연결이다. iPhone 실기기는 없으며 장시간 검증은 실행하지 않았다. iPhone Wi-Fi, Windows iPhone 수신, iPhone 오디오와 마우스 제어는 구현하지 않았다.
- Rust `ios_tests.rs`에서 모듈 부재를 red로 기록했다. 기기 이름 공간 `ios:`, USB와 Wi-Fi 구분, 화면 장치와 웹캠 구분, 중복 장치, 식별자 0/252/253자와 공백·제어 문자, 손상된 검색 JSON, 패킷 헤더/길이·빈 데이터·타임스탬프 안전 정수 한계와 취소 후 전달 차단을 검사한다. Android 검색 실패에도 iPhone 검색이 독립적으로 유지되고 반대 경우도 유지된다.
- 캡처 포트·서비스 부재를 별도 red로 확인한 뒤 `IosCapturePort`를 주입하는 `IosCaptureService`를 구현했다. 취소된 시작, 지원하지 않는 연결 방식, 잘못된 영상 설정은 네이티브 호출 전에 차단한다. 권한 거부와 연결 종료는 모의 포트 오류를 사용해 검사하며 실제 케이블 분리나 실제 권한 거부 검증으로 표현하지 않는다.
- Mac 어댑터는 CoreMediaIO 화면 장치 등록 → AVFoundation USB muxed `iOS Device` 입력 → VideoToolbox H.264 → 공통 바이너리 영상 패킷으로 연결한다. 소프트웨어·하드웨어 인코더 선택을 강제하지 않는다. 최대 해상도·프레임 설정과 1초 기준 프레임, 참조 프레임 재정렬 금지, 늦은 캡처 프레임 폐기를 적용한다. 인코더 콜백과 캡처 큐를 배출한 뒤 FFI 컨텍스트를 해제한다. 앱 번들에 USB 화면 캡처용 카메라 권한 설명을 추가했다.
- 프론트의 지원 기능 함수 부재와 iPhone 신뢰 안내 부재를 red로 확인했다. iPhone 보기 전용 안내와 미지원 오디오·화면 켜두기 비활성화, 첫 표시 전/후 캡처·보기 버튼, 중복 시작·종료와 동일 USB 식별자 재연결, 이전 콜백 폐기를 확인했다. 검색 결과에서 활성 iPhone이 사라지면 Android 제어로 돌아가는 실패 테스트도 먼저 확인한 뒤 활성 지원 기능을 세션에 유지하도록 수정했다.
- 네이티브 모의 검증은 iPhone 대신 자체 생성한 CVPixelBuffer 30프레임을 실제 VideoToolbox 인코더에 입력한다. 설정 패킷 1개, 프레임 30개, 첫 키 프레임, 증가하는 PTS와 사전 취소 시 무출력을 확인했다. 같은 패킷을 기존 Rust 녹화기에 전달해 H.264 MP4 320×640 / 30프레임 / 약 1.000001초를 생성하고 MP4 읽기와 FFmpeg 전체 디코딩을 오류 없이 통과했다. 실제 iPhone USB 수신이나 실제 기기 성능 증거는 아니다.
- Chromium에서는 위 네이티브 인코더의 실제 패킷을 `WebVideoRenderer`로 디코딩해 320×640 캔버스를 확인했다. 실제 PNG 캡처, 모의 네이티브 완료 파일 식별자 전달·단일 저장, 일반 → 전체 화면 → PiP 녹화 상태와 PiP 종료·저장, 연결 종료 시 기본 보기 복원, iPhone 캔버스 클릭 시 입력 전송 없음도 확인했다. 네이티브 저장 IPC와 Tauri 창 API는 이 브라우저 fixture에서 모의 구현이며, 실제 MP4 생성은 위 Rust 검증과 구분한다.
- macOS 브라우저 테스트 사전 단계는 짧은 네이티브 인코더 fixture를 자동 생성하므로 미디어를 저장소에 포함하지 않는다. Windows에서는 Mac 전용 브라우저 테스트 하나를 건너뛰고 기존 Android 테스트를 유지한다. Windows 백엔드 교차 컴파일 검사는 통과했으며 Windows 실제 실행은 하지 않았다.
- Rust 50개, 프론트 67개, Chromium 17개가 통과했다. TypeScript/Vite, Prettier/rustfmt, Tauri 기본 기능 포함 Rust 테스트, Clippy 경고 금지 검사도 통과했다. Swift 소스와 Swift 앱 번들은 변경하지 않았다.

TDD red/green 및 검증 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-ios-*`, 자체 생성한 모의 MP4는 ignored `dist/Verification/RustTauri/Ios`, 브라우저 입력은 ignored `desktop/tests/generated/ios`에 보관한다. 배포용 프론트 번들에 모의 미디어와 테스트 페이지는 포함하지 않는다.

최종 macOS 앱은 release 빌드 후 `dist/Phone Mirror Desktop.app`에 반영하고 ad-hoc 서명을 검증했다. 번들의 카메라 권한 설명을 확인했으며 실제 Mac 앱의 기기 검색·준비 화면도 오류 없이 열렸다. 이 시작 확인에서 폰 영상 연결을 시작하지 않았고 iPhone 실기기 검증은 수행하지 않았다. 관련 프론트 8개 테스트와 Mac 전용 브라우저 테스트 1개의 별도 재실행도 통과했다.

## iPhone Wi-Fi 송출/수신 (실기기 없이, 2026-10-11)

- Rust 프로토콜 및 프론트 수신 컨트롤러 부재를 red로 확인한 뒤 독립 모듈을 구현했다. iOS 모듈 부재, 숫자가 아닌 포트 허용, 앞뒤 공백 이름 허용, 송출 활성화·재시도 정책 부재, 늦은 종료 실패가 새 상태를 덮는 동작도 실패를 확인한 뒤 수정했다.
- Rust 55개, 프론트 72개, iOS 코어 9개, 기존 Swift 53개가 통과했다. Chromium 전체 18개와 마지막 Wi-Fi 행동 1개 재실행도 통과했다. TypeScript/Vite, Prettier, rustfmt, 전체 타깃 Clippy 경고 금지, Windows GNU 백엔드 교차 컴파일 검사도 통과했다.
- Rust loopback에서 조각별 hello 수신, 중복 시작, 잘못된 키·challenge·tag·counter/replay·크기, hello JSON, 영상 설정 선행·SPS/PPS·PTS 역행, PCM 크기/flags, heartbeat, 취소·종료·늦은 receiver ID, 설치 UUID 유지 재접속과 다른 UUID 거부를 검사했다.
- Swift CryptoKit와 Rust AES-GCM의 같은 고정 golden vector를 확인했다. 실제 Swift `SenderNetwork` → 암호화 TCP → Rust 수신기에 모의 VideoToolbox 영상 5패킷과 PCM 4패킷을 전달했다. 이 검증은 loopback이며 ReplayKit 실기기 방송이나 물리적 단절 검증이 아니다.
- 합성 영상의 회전·SPS/PPS·키 프레임과 44.1kHz mono float PCM의 48kHz stereo Int16 변환을 확인했다. 브라우저에서는 iPhone Wi-Fi Web Audio 재생·제어 비활성화·수신 코드 표시/종료를 확인했다. 기존 캡처·녹화·전체 화면·PiP·Android 회귀 테스트를 유지했다.
- iPhone 앱과 방송 확장을 시뮬레이터 SDK 및 기기 SDK로 unsigned 빌드했다. 실제 서명·설치·방송·권한 알림은 확인하지 않았다. Windows는 백엔드 교차 컴파일만 확인했으며 전체 앱 실제 실행은 확인하지 않았다. CI를 추가했지만 원격 실행 증거는 없다.
- 기존 Chromium 성능 검증의 영상 구간은 3초씩 두 번이며 장시간·열·배터리 검증을 하지 않았다. 기존 macOS Swift 앱 소스와 번들은 이번 작업에서 변경하지 않았다.

로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-ios-wifi-*`, iOS 산출물은 ignored `ios/.build`에 보관한다. 실기기 설치에는 Signing Team과 등록 가능한 App Group이 필요하다. [송출 앱 사용/빌드](../ios/README.md), [전송 프로토콜](../docs/IOS_WIFI_PROTOCOL.md)을 참고한다.

## 화면·소리 동시 녹화와 일시 정지·재개 (모의 검증, 2026-10-11)

- Android USB/Wi-Fi와 iPhone Wi-Fi의 공통 PCM 수신 경로를 녹화기에 연결했다. 원본 H.264 영상과 AAC-LC 48kHz stereo 소리를 MP4에 저장한다. 컴퓨터 재생 음소거와 녹음 입력은 독립적이다. 오디오 입력이 없는 기존 iPhone Mac USB는 영상 전용 녹화를 유지한다. 기존 macOS Swift 앱 소스와 번들은 변경하지 않았다.
- `recording_audio`와 프론트 일시 정지 동작 부재를 먼저 red로 확인했다. 역행하는 pause 경계와 오디오 인코더 팩토리 부재도 별도 red로 기록했다. 이후 시간 정책·PCM 정렬·인코더 포트·MP4 작성기를 분리하고 시계와 오디오 인코더 생성자를 주입했다. 초기화 실패는 녹화 작업이나 임시 파일을 남기지 않는다.
- Rust에서는 PCM 최소/최대/초과 크기·잘못된 flags·길이·정수 오버플로, 겹친 PCM·누락 구간 무음, 역행 PTS, 잘못된 식별자, 반복 pause/resume, 첫 키 프레임 이전 pause, pause 상태 종료를 검사한다. 첫 키 프레임을 가로지르는 PCM은 48kHz 표본 단위로 자르는 동작도 모의 인코더 입력에서 확인한다.
- 두 구간 사이 2초의 주입된 정지 시간을 제외해 240ms 영상·음성 편집 길이가 같아지는 MP4를 검사했다. 재개 시 새 키 프레임을 기다리고 동일한 출력 시간축에 영상·음성을 배치한다. AAC의 1024표본 인코더 지연과 마지막 패딩은 MP4 edit list로 제외한다. UI 경과 시간은 버튼 완료 시점의 단조 시계이며 키 프레임 대기로 파일 길이와 약간 다를 수 있다.
- 프론트에서는 일시 정지 중 시간 고정, 재개 후 정지 시간 제외, 중복 행동 차단, 실패 후 재시도, 시작 대기 중 Stop, 연결 종료 후 늦은 pause 완료 폐기를 검사했다. Chromium에서는 전체 화면과 PiP에서 pause/resume/Stop 및 한 번만 저장하는 행동과 작은 보기의 버튼 경계를 확인했다. 브라우저 녹화 fixture는 MediaRecorder이며 Rust AAC 처리 성능의 증거로 사용하지 않는다.
- 실제 VideoToolbox에 합성 프레임을 넣은 짧은 모의 입력으로 H.264 320×640/8프레임과 AAC 48kHz stereo MP4를 생성했다. FFprobe에서 두 트랙의 시작 0과 길이 0.266667초를 확인하고 FFmpeg로 전체 파일 디코딩을 오류 없이 통과했다. 디코딩한 PCM은 12,800표본 프레임이며, 100ms에 시작하도록 만든 합성 톤의 검출 시점은 99ms였다. 무음/톤 구간과 시작 오차 ±15ms를 자동 검사한다. `npm run test:recording-audio`로 재현하며 FFmpeg는 개발 검증에만 필요하다.
- Rust 65개, 프론트 77개, Chromium 20개, 기존 Swift 53개, iOS 코어 9개가 통과했다. TypeScript/Vite, Prettier/rustfmt, Clippy 경고 금지, Windows GNU 백엔드 교차 컴파일도 통과했다. macOS release 앱을 갱신하고 ad-hoc 서명 및 AAC 의존성 라이선스 포함을 확인했다.
- 이번 작업은 합성 입력·모의 동작 검증만 수행했다. 실제 Android/iPhone 녹화, ReplayKit 방송, Windows 네이티브 실행 및 장시간·발열·배터리 검증은 하지 않았다. 별도 녹화 스레드와 제한된 비차단 큐는 유지하지만 모든 기기에서 무끊김을 보장하는 성능 결과로 표현하지 않는다.

TDD red/green 및 최종 검증 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-av-*`, 합성 미디어는 ignored `dist/Verification/RustTauri/AudioRecording`과 `desktop/tests/generated/audio-recording`에 보관한다. 실기기 미디어를 만들거나 외부에 공유하지 않았다.

## iPhone Mac USB 화면·소리 동시 수신 (모의 검증, 2026-10-11)

- USB 입력의 오디오를 `IosCapturePort`/`IosCaptureService.run_with_audio` → 공통 오디오 채널 → 기존 AAC MP4 녹화기로 연결했다. 기존 영상 전용 `run` 계약도 유지하며 새 오디오 권한을 요청하지 않는다. Swift 앱 소스와 번들 및 Android·iPhone Wi-Fi 경로는 유지했다.
- Rust USB 오디오 패킷/합성 미디어 검증 함수 부재와 프론트 USB 오디오 비활성화를 먼저 red로 확인했다. 브라우저 USB 소리 버튼 비활성, 시작 기준보다 이른 오디오로 세션 실패, 영상 전용 호출이 오디오 포트로 진입하는 경우도 red로 기록하고 수정했다.
- 입력 오디오 포트만 연결하고 AVCaptureAudioDataOutput에 48kHz stereo Int16 변환을 요청한다. 컴퓨터 마이크 입력은 열지 않는다. 포트 부재·권한/출력 불가는 영상 수신을 유지하면서 알린다. 실제 OS 권한 알림과 기기 포트 연결은 실행하지 않았다.
- 오디오 4/4096바이트, 0/미정렬/초과 크기, 헤더 잘림·flags·안전 정수 PTS 상한, sink 실패, 취소된 시작과 취소 후 늦은 입력을 검사했다. 주입된 포트의 공통 오디오 전달과 기존 영상 전용 호출을 확인했다. 네이티브 합성 입력 도중 첫 오디오 콜백에서 취소해 추가 전달이 없고 정상 종료하는 것도 검사했다.
- 같은 캡처 큐와 공통 시작 시각으로 영상/오디오를 정렬한다. 늦게 도착한 시작 이전 오디오는 표본 단위로 제외한다. 합성 USB 처리기의 시작 이전 표본이 세션을 실패시키지 않는 것과 100ms에서 시작하는 오디오의 증가하는 PTS·1024프레임 분할을 확인했다. 네이티브 오디오 콜백 오류는 Rust에 원래 오류로 전달한다.
- `npm run test:ios-usb-audio`: 합성 CVPixelBuffer 8프레임과 CMSampleBuffer PCM을 실제 네이티브 처리기에 넣어 H.264 320×640 + AAC 48kHz stereo MP4를 만들었다. 두 트랙 길이는 약 0.266667초, 디코딩 PCM은 12,800표본 프레임이며 100ms 톤은 99ms에 검출됐다. FFmpeg 전체 파일 디코딩과 무음·톤 구간 및 동기화 ±15ms 검사를 통과했다. 실제 iPhone USB 입력이나 AVFoundation 기기 리샘플링 검증은 아니다.
- 프론트 78개와 Chromium 21개가 통과했다. USB iPhone 소리 재생, 오디오 포함 네이티브 녹화 시작 인자, 일시 정지·재개, PiP 종료·한 번 저장, 기존 영상 전용 기기 표시와 Android/Wi-Fi 회귀를 확인했다. 브라우저 IPC와 창 API는 모의 구현이다.
- Rust 71개(Tauri 기본 기능 포함), Swift 53개, TypeScript/Vite, Prettier/rustfmt, Clippy 경고 금지 및 Windows GNU 백엔드 교차 컴파일 검사를 통과했다. macOS release 앱을 갱신하고 ad-hoc 서명 및 오디오 권한 설명을 확인했다. Windows iPhone USB는 지원하지 않으며 Windows 네이티브 실행은 하지 않았다.
- 실기기 없이 짧은 합성·모의 검증만 수행했다. 실제 iPhone 화면/소리·USB 신뢰·보호 콘텐츠·물리 단절 및 장시간 테스트는 하지 않았다. 무끊김·모든 iPhone/앱의 오디오 제공을 보장하는 결과로 표현하지 않는다.

로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-usb-audio-*`, 합성 미디어는 ignored `desktop/tests/generated/audio-recording`에 보관한다.

## Windows iPhone USB 화면·소리 수신 (모의 검증, 2026-10-11)

- Windows USB는 Phone Mirror Sender의 ReplayKit 방송과 Apple 기기 드라이버의 로컬 usbmux 서비스를 연결한다. Wi-Fi 없이 USB 터널로 H.264 영상과 PCM 앱 소리를 받아 기존 AAC MP4 녹화·일시 정지/재개·캡처·전체 화면·PiP 경로를 사용한다. macOS의 기존 네이티브 USB 경로와 Swift 앱 소스·번들은 변경하지 않았다. 사용 준비는 [Windows USB 안내](README.md#windows-iphone-usb-화면소리-수신)를 참고한다.
- USB 서비스/프론트 컨트롤러/iOS 연결 코드 부재를 red로 기록했다. 재시도 시계 주입, Windows USB 안내와 송출 앱 화질 설정 표시, 바이너리 Connect 응답과 뒤따르는 미디어 바이트 보존도 각각 red 이후 구현했다. USB 검색·터널·재시도 시간은 주입하며 인증/암호화/미디어 수신은 공통 `IosMediaReceiverService`로 분리했다. 기존 Wi-Fi 컨트롤러/수신기 이름은 호환 진입점으로 유지한다.
- Rust는 헤더 크기/버전/태그, plist·바이너리 응답, 포트 0/1/65535, 잘린 분할 응답, USB/Network 기기 구분, 드라이버 오류·0대/복수 기기, 중복 시작·잘못된 종료 식별자·반복 종료를 검사했다. 같은 물리 식별자의 USB 번호 변경 재검색, 인증된 기기의 USB 표시, 새 수신 키 발급, 재시도 대기 중 즉시 취소와 늦은 콜백 차단을 검사했다. 4초짜리 루프백 테스트로 요청의 3초 제한이 열린 미디어 터널을 종료하지 않는 것도 확인했다. 물리 케이블 단절 시험은 아니다.
- 프론트는 USB 시작/중복 행동/시작 대기 중 종료/늦은 완료 정리, 드라이버 오류 안내, 연결 방식과 송출 앱 설정 안내를 검사했다. Chromium의 Windows 사용자 에이전트 및 모의 IPC로 USB 수신 시작 → 기기 선택 → 소리 재생 → 오디오 포함 녹화 → PiP 일시 정지·재개 → 한 번 저장 → 수신 종료 행동을 확인했다.
- `npm run test:ios-windows-usb`: 실제 Swift Network.framework USB 루프백 리스너와 합성 VideoToolbox 입력 → 모의 Apple usbmux TCP 서비스 → 실제 Rust USB 클라이언트/공통 수신/녹화기로 0.4초 H.264 + AAC 48kHz stereo MP4를 생성했다. FFmpeg 전체 디코딩, 두 트랙 길이 차이 1ms 미만, 무음/톤 구간과 100ms 톤 시작 오차 ±15ms 검사가 통과했다(검출 99ms). Mac에서 수행한 모의 전송 검증이며 Apple Windows 드라이버나 실제 ReplayKit USB 방송 검증은 아니다.
- 프론트 81개, Chromium 전체 22개와 최종 USB 행동 1개 재검사, 기존 Swift 53개, iOS 코어 10개가 통과했다. TypeScript/Vite 및 iOS 시뮬레이터·기기 SDK unsigned 빌드가 통과했다. unsigned 빌드는 실제 iPhone 설치·실행 증거가 아니다.
- Rust 백엔드 77개(`--no-default-features`)와 Clippy 경고 금지, rustfmt/Prettier 검사가 통과했다. `x86_64-pc-windows-gnu` 백엔드 교차 컴파일 검사도 통과했다. 전체 Windows Tauri 앱의 네이티브 빌드·실행 증거와 구분한다. macOS Rust 앱의 release 패키지를 갱신하고 ad-hoc 서명을 검증했으며 새 USB 의존성 라이선스 14개가 포함된 것을 확인했다.
- 실제 iPhone/Android, Windows 네이티브 실행, Apple 드라이버 서비스, Windows 설치 파일 제작, 원격 CI 실행 및 장시간 검증은 수행하지 않았다. Windows 네이티브 Tauri 빌드용 기존 CI를 유지한다. iPhone 송출 앱 설치에는 실제 Signing Team/App Group 설정이 필요하다.

TDD와 검증 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-windows-usb-*`, 합성 미디어는 ignored `desktop/tests/generated/windows-usb`에 보관한다. 연결 코드는 로그에 출력하지 않고 모의 입력용 임시 코드 파일도 종료 시 삭제한다.

## iPhone QR 연결 (모의 검증, 2026-10-11)

- USB/Wi-Fi 수신 패널에 활성 연결 코드별 QR을 추가했다. 기존 `PMU1`/`PMW1` 문자열을 앱 내부에서 벡터 QR로 인코딩하며 외부 생성 서비스·파일 저장·비동기 작업을 사용하지 않는다. 수신 종료 시 제거하고 키가 바뀌면 동기적으로 갱신한다. 기존 직접 입력과 Mac 네이티브 USB 수신 및 Swift 앱을 유지했다.
- 프론트 QR 생성 함수/표시 부재와 iOS 스캔 상태 정책 부재를 먼저 red로 기록했다. 이후 QR 인코더/표시를 분리하고 iPhone에 주입 가능한 카메라 포트와 UIKit 어댑터를 연결했다. 스캔 승인·검증·중복/늦은 콜백 처리는 카메라·SwiftUI·저장소와 독립적인 `SenderConnectionScanState`가 담당한다.
- 256바이트 입력 허용과 257바이트 거부, USB 포트 1/65535 및 0/65536/잘못된 숫자, Wi-Fi IPv4/IPv6, 잘못된 키·주소·타 앱 QR을 검사했다. QR 생성 실패 시 직접 입력 유지, 수신 종료 시 QR 제거, 재시작 시 새 QR, 스캔 전 권한/취소/거부, 중복 권한·스캔, 취소/새 스캔 이후 늦은 응답, 카메라 실패, 명시적 저장 전 설정 보존과 손상된 저장 데이터 거부를 검사했다. 스캔 성공은 코드 입력만 바꾸고 자동 저장/화면 방송을 시작하지 않는다.
- Chromium에서 실제 표시된 SVG QR을 320px 화면에 렌더링하고 별도 `jsQR` 디코더로 읽어 USB/Wi-Fi 원문과 정확하게 일치하는 것을 확인했다. 기존 앱 행동 fixture도 유효한 연결 키로 바꾸고 USB/Wi-Fi 수신·QR 표시·오디오·녹화·PiP 동작 2개를 다시 확인했다. 연결 키는 합성 테스트 값이며 실기기 QR을 만들거나 공유하지 않았다.
- 프론트 85개, Chromium 전체 24개와 수신 행동 재검사 2개, Rust 백엔드 77개, 기존 Swift 53개, iOS 코어 12개 및 최종 스캔 경계 2개 재검사가 통과했다. TypeScript/Vite, Prettier/rustfmt, Clippy 경고 금지, Windows GNU 백엔드 교차 컴파일이 통과했다. iOS 시뮬레이터/기기 SDK unsigned 빌드와 macOS Rust 앱 release 패키지·ad-hoc 서명·QR 라이선스 2개 포함을 확인했다.
- 실제 iPhone 카메라·권한 UI·스캔·ReplayKit 방송, Windows 네이티브 실행 및 장시간 검증은 하지 않았다. 브라우저 QR 디코딩과 iOS 정책 모의 테스트는 실제 iPhone 카메라 판독 증거가 아니다. 업데이트한 송출 앱의 실기기 설치에는 기존 Signing Team/App Group 설정이 필요하다.

로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-qr-*`에 보관한다. [QR 사용 방법](README.md#qr-코드로-iphone-연결)을 참고한다.

## Android Wi-Fi QR 페어링 (모의 검증, 2026-10-11)

- Android 공식 `WIFI:T:ADB;S:studio-...;P:...;;` QR을 생성하고 해당 서비스 이름을 mDNS에서 기다린 뒤 ADB 페어링을 수행한다. 성공 응답의 기기 식별자와 정확히 일치하는 연결 서비스를 재검색해 연결한다. 같은 IP나 다른 폰의 임의 연결 서비스를 고르지 않는다. 기존 USB·6자리 코드 페어링·Wi-Fi 재연결/저장·iPhone 기능·Swift 앱 소스와 번들은 유지했다.
- 새 Rust 서비스/프론트 컨트롤러 부재를 먼저 red로 기록했다. 네이티브 시간 초과가 정리 경로를 건너뛰는 동작, 취소 실패를 성공으로 표시하는 동작, 취소 후 늦은 시작 실패가 취소 상태에 머무는 동작도 각각 red로 확인한 뒤 구현했다. 검색/페어링/연결은 `AndroidQrPairingPort`, 단조 시계/검색 간격은 `AndroidQrPairingClock`으로 주입한다. Tauri IPC와 OS 프로세스는 별도 어댑터이며 QR 인코더는 iPhone과 공통 로컬 렌더러를 사용한다.
- Rust는 서비스 이름/GUID 정확한 매칭, 다른 기기 제외, 포트 1/65535와 잘못된 0, QR 키 형식, stdin 전달/명령행에서 키 제외, 실패·손상된 성공 응답의 비밀 제거, 반복 시작/종료, 잘못된 식별자, 중복 대기, 정지된 검색 취소, 새 QR의 키 회전, 120초 경계 만료를 검사했다. 실제 시계의 대기 종료 정리는 주입 시각으로 남은 시간을 1초로 줄여 확인했다. QR 유효 시간을 실제로 120초 기다리지 않았다.
- 프론트는 표시/완료 후 기기 갱신, QR 제거, 반복 시작 차단, 시작 도중 취소/늦은 완료, 실패 시 직접 입력 유지, 취소 실패 재시도/재시작 차단, 취소 후 늦은 시작 실패 정리를 검사했다. Chromium에서 실제 SVG QR을 독립 `jsQR` 디코더로 읽어 ADB 원문과 일치하는 것을 확인했다. 800×600 화면에서 연결 조작 고정, QR 대기 중 수동 무선 작업 잠금과 USB 보기 유지, 연결 완료 및 취소 후 늦은 연결 완료 폐기도 확인했다.
- Rust 백엔드 82개(`--no-default-features`), 프론트 90개, Chromium 26개, 기존 Swift 53개가 통과했다. TypeScript/Vite, Prettier/rustfmt, Clippy 경고 금지, Windows GNU 백엔드 교차 컴파일이 통과했다. macOS Rust 앱 release 패키지를 갱신하고 ad-hoc 서명을 검증했다. 기존 QR 라이선스는 계속 포함한다.
- 실제 Android/iPhone, Android 설정 QR 스캐너, 물리 USB, 네트워크 mDNS 검색, Windows 전체 앱 네이티브 빌드·실행, 원격 CI 및 장시간 검증은 수행하지 않았다. ADB 호출은 주입한 모의 실행기만 사용했으며 실제 기기 신뢰 등록을 변경하지 않았다. 기존 짧은 합성 영상/녹화 브라우저 회귀는 실제 Android QR 성능 검증과 구분한다.

로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-android-qr-*`에 보관한다. [사용 방법](README.md#android-wi-fi-qr-페어링)을 참고한다.

## Wi-Fi 자동 화질 조절 (모의 검증, 2026-10-11)

- Android 정책·수신 통계·설정 저장·비트레이트 매핑과 iPhone 송출 정책 부재를 먼저 red로 기록한 뒤 구현했다. 중복 인코더 비트레이트 인자, USB 설정 보존, 자동 화질 재활성화 시 단계 유지도 추가 failing test로 확인하고 수정했다. 정책과 단조 시각 입력은 UI·Tauri·Network.framework·인코더에서 분리했다.
- 프론트는 잘못된/비유한 측정값, 최소 표본, 반복 시각, 쿨다운, 최저/최고 단계, 사용자 상한, 정지 화면과 전송 지연 구분, 구간 초기화, 이전/손상 설정, 토글 반복, 녹화 변경 보류 및 비동기 중단 후 늦은 재시작 폐기를 검사한다. Chromium에서는 실제 짧은 브라우저 녹화 중 변경 보류, 녹화 마무리 후 적용, 상태 표시와 USB 제외를 확인한다. 네트워크 악화는 주입된 측정값이며 실제 혼잡 검증이 아니다.
- Rust는 실제 scrcpy 인자에 비트레이트가 한 번만 들어가는지, Wi-Fi 단계 매핑·해상도/프레임 경계·잘못된 설정 및 USB의 기존 8Mbps 유지를 검사한다. iOS 코어에서는 송출 지연·시간 경계·최저/최고 비트레이트·복원·저장 형식과 허용/금지 인코더 입력을 검사한다. 합성 64×32 프레임 두 장을 실제 Mac VideoToolbox 인코더에 넣고 실행 중 비트레이트 변경을 확인했다. 이것은 iPhone 하드웨어 검증이 아니다.
- Rust 85개, 프론트 96개, Chromium 28개, iOS 코어 15개, 기존 Swift 53개가 통과했다. TypeScript/Vite·Prettier·rustfmt·Clippy 경고 금지와 Windows GNU 백엔드 교차 컴파일을 확인했다. iOS 시뮬레이터/기기 SDK unsigned 빌드와 Mac Tauri release 빌드도 확인했다. Windows 전체 앱 네이티브 실행·원격 CI·실기기·장시간 검증은 하지 않았다.
- Android 화질 변경은 영상/소리 세션을 짧게 재시작한다. 녹화 중에는 파일을 보호하기 위해 변경하지 않는다. iPhone은 해상도·소리를 유지한 채 목표 비트레이트만 변경한다. 측정 지표는 Android 수신 간격 변동/디코드 지연과 iPhone 로컬 소켓 완료 지연이며 대역폭·RTT·컴퓨터 수신 확인을 직접 측정하지 않는다. 실제 네트워크의 무끊김을 보장하는 결과로 표현하지 않는다. 기존 Swift 앱 소스와 번들은 이번 작업에서 변경하지 않았다.

TDD red/green과 최종 검증 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-adaptive-*`에 보관한다. 실제 폰 미디어를 생성하거나 외부에 공유하지 않았다.

## 연결 문제 진단 (모의 검증, 2026-10-11)

- Rust 진단 서비스와 프론트 행동/표시 부재를 먼저 red로 기록했다. 실제 어댑터, 앱 UI 통합, 입력 타입 경계, 브라우저 안내 표시, 앱 종료 취소 및 주입 타이머도 별도 red 후 구현했다. 인증된 iPhone 연결이 끊겨 `Offline` 기기 정보가 남아 있을 때 정상으로 잘못 표시하는 문제를 loopback 실패 테스트로 확인하고 수정했다.
- Rust는 Android USB/Wi-Fi·Mac iPhone USB·Windows iPhone USB·iPhone Wi-Fi의 점검 선택, 해결 안내/상태 매핑, IPv4/IPv6와 포트 1/65535·0/65536·호스트명·코드/개행 입력, 알 수 없는 요청 필드 거부를 검사한다. 느린 점검의 제한 시간, 중복 실행, 다른 ID의 취소, 반복 취소, 앱 종료 및 시각 주입을 검사한다. 가짜 타이머로 6초짜리 논리적 제한을 실제 기다림 없이 검증한다. 결과를 저장하는 기능은 없으며 기존 설정/북마크를 변경하지 않는다.
- 모의 ADB에서 `devices -l` 원본의 무선 오프라인 상태를 확인하고, 비정상 명령 성공 여부와 원본 오류 로그 차단, 허용된 조회 명령·표준 입력 없음, 화면 모듈 부재를 검사했다. 짧은 loopback TCP 포트 열림/닫힘과 암호화된 iPhone hello 연결·해제 상태를 실제 소켓으로 검사했다. iPhone 미실행·방송 대기를 읽을 때 수신 키를 노출하거나 방송을 자동으로 시작하지 않는다. 이 소켓 검증은 물리적 케이블 단절이나 실제 네트워크 장애 검증이 아니다.
- 프론트는 기기 없이 대상 선택, 진단/재시도/해결 안내 표시, 포트 경계·잘못된 플랫폼·식별자 256/257자·제어 문자·잘못된 런타임 주소 타입, 중복 행동, 취소/종료 뒤 늦은 완료 폐기, 취소 실패 뒤 완료 대기 및 원본 백엔드 오류 비노출을 검사했다. 실제 앱 컴포넌트에서 기존 세션 시작/종료 명령을 호출하지 않는 것도 확인했다.
- Chromium에서는 800×600에서 주소 오류와 iPhone 안내, 진행 중인 짧은 브라우저 녹화와 영상 세션 유지, 기존 QR·자동 화질·캡처·일시 정지·전체 화면·PiP 회귀를 검사했다. 브라우저의 점검 결과와 IPC·창 API는 모의 구현이다. 기존 성능 검증은 3초씩 두 구간이며 장시간 검증은 하지 않았다.
- Rust 96개, 프론트 104개, Chromium 30개, 기존 Swift 53개, iOS 코어 15개가 통과했다. TypeScript/Vite·Prettier·rustfmt·Clippy 경고 금지, Windows GNU 백엔드 교차 컴파일, Mac Tauri release 빌드와 ad-hoc 서명을 확인했다. 이번 변경은 iPhone 송출 앱이나 기존 Swift Mac 앱 소스·번들을 수정하지 않는다. Windows 전체 앱 네이티브 실행·원격 CI·Android/iPhone 실기기 검증은 수행하지 않았다.

TDD red/green 및 최종 검증 로그는 ignored `dist/Verification/RustTauri/TestLogs/phone-diagnostics-*`에 보관한다. 실기기 미디어를 생성하거나 외부에 공유하지 않았다.

## Android 다국어 입력 — 2026-10-11

- TDD 실패 확인: `TextInputController`와 `TextInputPanel`이 없는 상태에서 새 Vitest 테스트가 import 실패했으며 Rust의 `ControlInput::Paste` 부재로 프로토콜 테스트가 컴파일 실패했다. 구현 후 통과했다. 조합 완료 후 microtask를 거쳐 도착하는 마지막 입력이 중복 전송되는 테스트도 먼저 실패(1회 대신 2회 전송)한 뒤 이벤트 처리 보강으로 통과했다.
- 실제 Samsung SM-S901N Wi-Fi 설정 검색창에서 최초 다국어 붙여넣기와 같은 내용의 반복 붙여넣기를 확인했다. 빠른 연속 확정 텍스트는 일부 문자가 뒤바뀌는 실패를 재현했다. 기기 ACK 및 100ms 처리 간격을 추가하기 전 시간 경계 테스트가 실패했으며, 추가 후 99ms에는 다음 메시지를 보내지 않고 100ms에 전송하는 테스트, 2초 ACK 제한과 취소 테스트가 통과했다.
- 최종 실기기 검사 `android_text_input_smoke`는 한국어·일본어·중국어·아랍어·이모지·결합 문자의 정확한 입력, 같은 텍스트 반복 붙여넣기, 즉시 큐에 넣은 `한`→`日`→`中`→`ع`→`Z`와 Backspace의 순서를 확인했다. 실제 영상 패킷 329개를 수신했고 세션을 정리했다. USB 다국어 입력, 물리적 케이블 분리, Windows 네이티브 실행, 실제 macOS IME 조합 UI는 이번 실기기 검사의 범위가 아니다.
- Vitest 전체 123개, Rust 백엔드 전체 및 Chromium Playwright 전체 35개가 통과했다. 새 테스트는 빈 값·NUL·잘못된 유니코드·UTF-8 최대 길이, 공백·줄바꿈, 읽기 실패, 반복 행동, 대기열 상한, 늦은 클립보드 결과·전송 오류, 기기 교체·취소, 조합 확정·취소·마지막 이벤트, 버튼·⌘V·Ctrl+V, 설정칸 포커스 분리 및 iPhone에서 입력 UI 제외를 다룬다. 브라우저 입력 테스트는 실제 텍스트/클립보드 이벤트를 쓰지만 Android 수신은 모의 백엔드다. OS IME 조합 테스트는 합성 DOM 이벤트다.
- macOS 전체 데스크톱 컴파일·Clippy·앱 번들과 Windows GNU 백엔드 교차 컴파일이 통과했다. 전체 Windows 데스크톱 교차 컴파일은 `x86_64-w64-mingw32-windres` 부재로 완료하지 못했다. Windows 네이티브 CI는 기존 구성을 유지하며 이번에 원격 실행하지 않았다.
- 실제 기기 UI XML은 ignored `desktop/src-tauri/target/verification/text-input/`에만 보관한다. 스크린샷·녹화·원본 클립보드를 외부에 공유하지 않았다.

재현할 때 잠금 해제된 Android의 빈 **설정 검색칸**에 커서를 둔 뒤 명시적으로 ADB 식별자를 지정한다. 예제는 Settings 패키지의 입력칸을 확인하고 사용자 텍스트가 있으면 중단한다. 이전 검사에서 남은 알려진 테스트 문구만 지울 수 있다.

```sh
cargo run --manifest-path desktop/src-tauri/Cargo.toml --no-default-features \
  --example android_text_input_smoke -- ADB_IDENTIFIER
```

## 녹화 중 스크린샷 — 2026-10-11

- TDD: 녹화 중·일시 정지 중 반복 캡처, 캡처/녹화 저장 창 순서, 저장 취소·인코딩/저장 실패, 종료 대기, 일반/전체 화면/PiP UI를 검사하는 신규 테스트 7개가 구현 전에 모두 실패했다. 녹화 제한과 버튼 비활성화를 해제한 후 통과했다. 녹화 마무리 실패 뒤 늦은 PNG 저장 결과가 실패 안내를 덮어쓰는 별도 테스트도 먼저 실패한 뒤 결과 채널과 종료 대기를 보강해 통과했다.
- `RecordingScreenshot.test.tsx` 11개는 위 행동에 더해 0/1/256MiB/256MiB+1 크기 경계(큰 크기는 모의 Blob 메타데이터), 대기 중 중복 클릭, 늦은 인코딩 완료, 녹화 시간과 일시 정지 보존, 동기 캡처·녹화 마무리 예외 후 복구를 확인한다. 동기 예외로 종료 대기 상태가 남는 두 테스트도 실패를 확인한 뒤 작업 Promise를 먼저 등록하는 방식으로 수정했다. 기존 unit/behavior 및 Rust 백엔드 회귀 검사도 통과했다.
- 최종 Vitest 전체 134개 중 133개가 기본 제한 시간으로 통과했다. 컴퓨터 부하 중 기존 `PhoneMirrorApp` 연결/종료 테스트가 5초 제한을 넘겼고, 코드 변경 없이 해당 파일 10개를 단일 worker·15초 제한으로 재실행해 모두 통과했다(해당 테스트 실제 실행 시간 2.0초). Chromium 전체 실행에서 변경된 캡처 동작을 반영하지 않은 기존 최소 창 크기 기대값 두 개를 갱신한 뒤, 최종 미디어·뷰어 10개를 다시 실행해 통과했다. 나머지 Chromium 28개는 앞선 전체 실행에서 통과했다.
- Chromium에서는 실제 Canvas PNG 인코딩과 MediaRecorder를 사용해 일반/전체 화면/PiP 모두에서 빨간 프레임을 녹화 중 저장하고 파란 프레임을 일시 정지 중 저장한다. 캡처 직후 미리보기를 녹색으로 바꾸어도 PNG 픽셀은 클릭 당시 색과 원본 320×640 크기를 유지한다. 재개·종료 후 생성된 영상도 디코딩한다. 기기 입력은 모의 백엔드이며 iPhone 브라우저 검증의 미디어는 합성 데이터다.
- Samsung SM-S901N의 실제 Wi-Fi H.264를 `RecordingSession`에 전달하면서 로컬 PNG를 저장했다. 활성 녹화와 일시 정지 중 PNG 저장 및 기존 파일 경로 중복 저장 실패 후에도 같은 녹화 작업이 유지되고, 완료된 886×1920 MP4를 FFmpeg로 끝까지 디코딩했다. `android_recording_screenshot_smoke`의 PNG는 클릭 시 복사한 실제 H.264의 마지막 프레임을 FFmpeg로 변환해 생성한다. **네이티브 WebView의 캡처 버튼·운영체제 저장 창을 실기기로 조작한 검증은 아니며**, 프론트 Canvas 경로 검증과 별도의 로컬 백엔드 실기기 검증이다. 실제 iPhone·Windows UI·USB 케이블 분리는 검사하지 않았다.
- 실제 PNG/MP4/H.264는 ignored `desktop/src-tauri/target/verification/recording-screenshot/` 아래에만 보관하며 외부에 공유하지 않는다. macOS 전체 Clippy 및 앱 빌드, Windows GNU 백엔드 교차 컴파일이 통과했다. Windows 네이티브 실행·설치 프로그램 빌드·원격 CI 실행과는 구분한다. 기존 Swift 코드는 변경하지 않았다.

```sh
npm --prefix desktop test
(cd desktop && npx playwright test)
cargo test --manifest-path desktop/src-tauri/Cargo.toml --no-default-features
cargo run --manifest-path desktop/src-tauri/Cargo.toml --no-default-features \
  --example android_recording_screenshot_smoke -- ADB_IDENTIFIER
```

## iPhone 키보드 다국어 입력 — 2026-10-11

- TDD: 프론트 `IosKeyboardInputController`, Swift 키보드 입력 도메인, Rust `ios_keyboard` 부재로 신규 테스트가 각각 import/컴파일 실패했다. iPhone 앱 UI 통합 테스트도 붙여넣기 버튼 부재로 먼저 실패했다. 구현 후 통과했다. 늦은 시작 이후 중복 시작, 종료 실패 시 재시도용 수신 ID 보존, 짧은 키보드 재연결 후 이전 입력 세대 폐기 테스트의 실패를 확인한 뒤 수명 처리를 보강했다. Swift 설정 중복 준비가 이전 확인 토큰을 무효화하는 실패도 먼저 확인한 뒤 중복 요청을 거부하도록 수정했다.
- 프론트 전체 139개와 Chromium 전체 41개, Swift iOS 코어 전체 19개 및 Rust 백엔드 전체가 통과했다. Chromium은 실제 클립보드·단축키·DOM 입력을 사용하며 일반/전체 화면/PiP에서 iPhone 붙여넣기와 직접 입력, 연결 종료 시 비활성화 및 마우스 제어 미활성화를 확인한다. 브라우저 기기 수신은 모의 구현이다. IME 조합 확정/취소와 마지막 이벤트 중복은 합성 DOM 이벤트 테스트이며 OS IME 실사용 검증은 아니다.
- Rust 키보드 테스트는 방향별 키 분리·변조·순서/재전송 거부, 인증 없는 입력 거부, 중복 수신 시작/종료, UTF-8 0/1/262130/262131바이트 경계, NUL·미지원 키 거부, 실제 loopback TCP 인증·다국어 전송과 ACK 대기, 재접속 세대 폐기, 가상 시각 2999/3000ms ACK 제한 및 대기 입력 취소를 확인한다. Swift는 코드 포트 1/65535/0·잘못된 접두사, 누락/손상된 저장 값, 암호화 재전송 거부, Unicode·편집 명령·최대 길이 및 UI 독립 설정 수명 정책을 확인한다.
- `ios_keyboard_mock_receiver` ↔ `KeyboardInputMock`는 실제 loopback TCP에서 생산용 Swift `KeyboardConnection`과 Rust 서비스를 연결하여 한국어·일본어·중국어·아랍어·이모지·결합 문자, 같은 텍스트 반복 전송, Backspace·좌우 이동·줄바꿈과 ACK 순서를 확인했다. 문서는 합성 `KeyboardTextDocument`이며 실제 `UITextDocumentProxy`를 쓰는 iPhone 입력칸 검증이 아니다. 일회용 코드는 ignored `desktop/src-tauri/target/verification/keyboard-input/`에서 0600으로 생성하고 검증 종료 시 삭제한다. 실제 화면 미디어를 생성하거나 외부에 공유하지 않았다.
- iPhone 키보드 확장을 포함한 송출 앱의 시뮬레이터 및 기기 SDK unsigned 빌드를 확인했다. 실제 iPhone은 연결되어 있지 않다(`devicectl`에는 simulated 기기만 표시). 기기 SDK 빌드는 설치·전체 접근 허용·로컬 네트워크 권한·타 앱 입력칸에 대한 실기기 증거가 아니다. Windows GNU 백엔드 교차 컴파일, macOS 전체 Clippy 및 Desktop 앱 빌드/서명을 확인하며 Windows 네이티브 실행·설치 프로그램·원격 CI 실행과 구분한다. 기존 macOS Swift 앱은 변경하지 않는다.

재현 명령:

```sh
npm --prefix desktop test -- --maxWorkers=1
(cd desktop && npx playwright test --workers=2)
swift test --package-path ios
cargo test --manifest-path desktop/src-tauri/Cargo.toml --no-default-features
swift build --package-path ios --product KeyboardInputMock
cargo build --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --example ios_keyboard_mock_receiver
```

두 검증 실행 파일을 미리 빌드한 뒤 Rust 예제에 기존 파일이 없는 private 코드 경로를 주고, 같은 경로를 Swift 검증기에 전달한다. 제한 시간 10초 안에 연결한다. 실제 설치/사용은 `ios/README.md`의 키보드 절차를 따른다.

## 앱 내 업데이트 — 2026-10-11

새 동작의 실패를 먼저 확인했다. 프론트 컨트롤러·Rust 정책·배포 모듈이 없는 상태에서 import/컴파일 실패를 기록했고, 설치 중 잘못된 진행률이 `NaN`이 되는 실패와 반복 배포가 다른 파일을 덮어쓰는 실패를 재현한 뒤 수정했다.

검증 범위는 자동 확인과 수동 설치 분리, 설정 없음·잘못된 설정, HTTPS 주소 검증, 같은 작업 중복 실행, 취소 뒤 늦은 응답, 설치 시작 뒤 취소 거부, 24시간 경계, 네트워크 오류 후 재시도, 연결·녹화·파일 저장·백그라운드 작업 중 설치 거부다. 실제 배포 키로 서명한 장치 데이터 없는 고정 파일을 이용해 서명 검증과 본문·서명된 버전 변조 거부를 확인한다. 배포 파일 준비 테스트는 3개 플랫폼·미완성 목록·잘못된 URL·누락 서명·체크섬 변조·동일 파일 반복 작업을 검사한다.

전체 Rust 서비스 테스트 112개, 프론트 전체 테스트와 Chromium 전체 42개, 배포 테스트 17개를 통과했다. `verify_application_update` 예제로 로컬 업데이트 아카이브의 공개 키 서명과 버전을 검증할 수 있다. 검증 중 생성하는 패키지와 로그는 무시된 `desktop/src-tauri/target` 안에 둔다.

업데이트 서버와 원격 GitHub 저장소가 없으므로 인터넷 서버에서 다운로드하여 실제 설치·재시작하는 배포 통합 검증은 수행하지 않았다. iPhone은 연결되지 않았고, 이 작업에서 iPhone 하드웨어 검증을 하지 않았다. Windows 네이티브 설치·업데이트 실행과 원격 CI 실행도 이 Mac에서 수행한 검증과 구분한다. 기존 Swift Mac 앱은 변경하지 않았다.

Windows GNU 타깃 `cargo check --target x86_64-pc-windows-gnu`는 업데이트 플러그인을 포함해 통과했다. TLS 라이브러리의 C 코드 때문에 MinGW-w64 14.0.0 도구를 준비해 Mac에서 크로스 컴파일했으며 Windows에서 앱을 실행한 증거는 아니다. macOS의 `cargo clippy --all-targets -- -D warnings`도 통과했다. 로컬 Mac 업데이트 아카이브는 실제 공개 키와 서명된 버전 `0.2.0`으로 검증했다.

최종 프론트 전체 147개는 `npm test -- --maxWorkers=1 --minWorkers=1 --testTimeout=15000`으로 통과했다. 같은 Mac에서 병렬 Rust 빌드와 기본 5초 테스트 예산을 함께 사용했을 때 UI 테스트가 시간 초과되어 실행 조건을 조정했다. 제품 코드의 동작 단언은 유지했다. 최종 Mac 0.2.0 `.app`과 서명된 `.app.tar.gz`를 생성하고 아카이브 서명·버전을 다시 검증했다. 아카이브 첫 바이트 변조와 다른 버전 선언도 각각 거부했다.

`/Applications/Phone Mirror Desktop.app`은 이전 앱을 무시된 `target/update-backups`에 백업한 뒤 교체했고, 코드 서명과 원본/설치 바이너리 체크섬이 일치함을 확인했다. 실제 설치 앱을 실행해 **현재 버전 0.2.0**, **자동으로 새 버전 확인**, **배포 주소 미등록** 안내와 HTTPS 주소 입력란을 네이티브 macOS UI에서 확인했다. 실서버 업데이트 설치 검증은 위에 적은 배포 주소 부재로 여전히 수행하지 않았다.

## 공개 전 검증 — 2026-10-12

공개 예정 파일과 전체 Git 이력을 다시 검사했다. 현재 파일 425개와 이력의 파일 내용 370개에서 스캐너가 검사하는 자격 증명·개인 키·검토 대상 미디어 패턴은 발견되지 않았다. 이름·개인 경로·네트워크 주소 후보는 추가 검토했고, 발견된 경로와 주소는 테스트용 합성 입력 또는 UI 예시였다. 이 검사는 모든 비밀이나 개인정보가 없다는 보장은 아니다. 실제 폰 화면, UI XML, 녹화와 실행 로그는 무시된 `target`에 유지한다.

검토 중 업데이트 서명 키가 CI 패키지 작업 전체에 전달되는 설정을 발견했다. 패키징 단계에만 키를 전달하도록 회귀 테스트를 먼저 실패시킨 뒤 설정을 수정했고 테스트가 통과했다. 일반 설치·단위 테스트 단계에서는 서명 키를 전달하지 않는다. 서드파티 문서에서 아직 존재하지 않는 업데이트 라이선스 리소스를 포함했다고 설명한 문구도 수정했다. 완전한 바이너리 배포용 고지 수집은 첫 공개 바이너리 릴리스 전 별도 점검 대상이다.

- 프론트 단위·행동 테스트 152개 통과 (`--maxWorkers=1 --minWorkers=1 --testTimeout=15000`).
- Chromium 브라우저 테스트 43개 통과. 합성 H.264 영상과 진단 요약 다운로드를 포함한다.
- 배포·공개 점검·CI 키 범위 테스트 20개 통과.
- Rust 서비스 테스트 114개, 원래 Swift Mac 앱 테스트 88개, iOS 코어 테스트 19개 통과.
- 프론트 생산 빌드, Prettier, Rust 포맷, macOS 전체 타깃 Clippy, Windows GNU 타깃 크로스 컴파일 통과.
- iOS 시뮬레이터와 기기 SDK의 서명 없는 빌드 통과. 실제 iPhone 설치·실행 검증은 아니다.

연결된 Samsung Android의 실제 연결 방식은 Wi-Fi 검색 서비스였다. 검증 예제는 ADB 목록에서 전체 서비스 식별자와 실제 USB/Wi-Fi 분류를 사용하는 방식으로 수정했다. Wi-Fi 영상 886×1920에서 녹화·일시정지 중 PNG 저장, 중복 경로 저장 실패 처리, MP4 전체 디코딩을 확인했다. 다국어 입력 재검증은 설정 검색칸에 커서가 없어 입력 전 중단됐으며, 오늘의 실기기 성공으로 표시하지 않는다. 이전 다국어 입력의 Wi-Fi 실기기 검증 기록과 자동 테스트 증거는 위 기록을 참고한다. 물리적 케이블 분리, Windows 네이티브 실행, iPhone 하드웨어, 실제 HTTPS 업데이트 서버 설치·재시작은 이번에 검증하지 않았다.

## 전체 재점검 — 2026-10-12

- Windows 클립보드의 CRLF 줄바꿈을 지원하도록 브라우저 테스트를 수정했다. Unicode 본문을 검증한 뒤 OS에서 읽은 원문이 그대로 전달되는지 확인한다. 제품의 붙여넣기 데이터는 정규화하지 않는다.
- `core.autocrlf=true` 체크아웃에서 서명된 고정 파일의 바이트가 바뀌는 실패를 재현했다. `.gitattributes`로 LF를 고정하고 실제 임시 Git 체크아웃 회귀 테스트를 추가했다.
- 업데이트 취소 응답보다 확인 결과가 먼저 도착하는 경우와 설치 실패보다 취소 거부가 늦게 도착하는 경우를 실패 테스트로 재현했다. 취소 완료 전 새 작업을 막고 중복 취소를 병합하며, 설치 실패가 취소 응답에 덮어쓰이지 않도록 수정했다.
- 배포 아카이브의 서명 메타데이터 버전과 배포 버전 불일치 테스트가 먼저 실패한 뒤 검사를 추가해 통과했다. 이 배포 준비 검사는 메타데이터 검사이며, 앱의 공개 키 암호학적 검증을 대체하지 않는다.
- Vitest를 4.1.11로 올린 뒤 npm 의존성 감사 0건, 프론트 155개, 배포 22개, Chromium 43개, Rust 서비스 114개, TypeScript/Vite 생산 빌드 및 포맷 검사를 통과했다. 브라우저 병렬 실행에서는 성능 검사의 디코더가 닫히는 실패가 한 번 발생했으며, 해당 검사 단독 실행과 전체 직렬 실행은 통과했다. 이 실행 환경 의존성은 제품 성능 성공으로 확대 해석하지 않는다.
- 공개 파일·Git 이력의 제한된 패턴 검사에서 0건을 확인했다. 기존 Swift·iOS 소스를 변경하지 않았으며, 이번 재점검에서 추가 iPhone 실기기 검증이나 실제 HTTPS 업데이트 설치·재시작을 수행하지 않았다.
- Windows 네이티브 CI에서 `published_recording_preserves_existing_destination_and_cleans_temporary_files`가 실패했다. 녹화 저장의 임시 파일 동기화에 읽기 전용 핸들을 사용해 Windows 쓰기 권한 요구를 충족하지 못했다. 쓰기 권한으로 열어 동기화하도록 수정하고 같은 회귀 테스트를 다시 실행한다. Mac CI의 Rust 테스트·Clippy·앱 번들은 먼저 통과했다.

재현 실패 및 최종 로그는 ignored `desktop/src-tauri/target/overall-review/`에 보관한다. 공식 바이너리 공개 전 제3자 라이선스 목록 수집, 업데이트 피드 제공, 코드 서명·공증 준비가 남아 있다.
