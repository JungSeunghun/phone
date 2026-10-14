# 테스트와 개발 기준

새 행동의 테스트를 먼저 작성하고 실패를 확인한 뒤 구현하고 리팩터링한다. 경계값·허용 값·잘못된 값·비동기 취소·반복 행동을 포함한다. 이 앱의 백엔드는 별도 서버가 아니라 기기 연결과 저장 서비스 계층이다.

## 자동 테스트

```sh
swift test --build-system native
```

- Core: 지원 화질 및 fps 조합, 범위 밖 정수, 누락·잘못된 형식·손상·버전 불일치 설정, 실제 UserDefaults 재생성/복원, 기기 식별자 길이와 금지 문자, 창 좌표 및 크기 경계.
- Core: USB 목록 파싱과 승인/오프라인 상태, 중복·무선·에뮬레이터 제외.
- Core: 재연결 1·2·4·8·16초 경계, 연속 5회 제한, 같은 기기만 재연결, 부재·승인 대기·오프라인 상태, 수동 취소, 설정 토글, 실제 프레임 이후 횟수 초기화, 녹화 저장 중 대기.
- Presentation: 설정 복원·저장 실패 안내, 시작/종료 버튼, 반복 행동, 첫 프레임 전 캡처 차단, 재연결·기기 및 플랫폼 변경 취소, 오래된 검색 결과·영상·오류 콜백 무시, 15초 연결 시간 및 4초 수신 지연 경계, 조작 허용 상태, 종료 후 재연결 차단.

## TDD 기록

2026-10-11 설정 및 재연결 테스트를 먼저 실행해 구현 타입이 없는 실패를 확인했다. 구현 후 Core 20개 테스트가 통과했다. 이후 USB 파서와 Presentation 행동 테스트를 먼저 추가해 파서 및 화면 모델 API가 없는 실패를 확인하고 구조 분리 및 구현을 진행했다. 이후 터치 좌표 경계 테스트를 먼저 추가하고 미구현 상태의 실패를 확인했다. 추가 행동 테스트에서 자동 재연결 비활성화/시도 소진 후 시작 버튼 상태와 빈 문자 전달 문제 3건의 실패를 확인하고 수정했다. 실행 로그는 작업 중 로컬 `/tmp/phone-tdd-core-red.log`, `/tmp/phone-tdd-core-green.log`, `/tmp/phone-tdd-app-red.log`에 보관했다.

## 빌드와 실기기

```sh
bash scripts/build.sh
"dist/Phone Mirror.app/Contents/MacOS/PhoneMirror" --self-test
"dist/Phone Mirror.app/Contents/MacOS/PhoneMirror" --smoke-test "$PWD/dist/Verification"
```

GUI 앱을 종료한 상태에서 Android USB 실기기로 검증한다. 첫 프레임, PNG 저장, MP4 저장, 실제 전송 소켓 중단과 녹화 마무리, 자동 재연결, 수동 종료 후 재시작 방지를 확인한다. 소켓 중단은 실제 케이블을 뽑는 시험과 구분한다. 미디어는 실제 폰 내용을 포함하므로 외부로 공유하지 않고 gitignore 적용된 출력 폴더에만 저장한다. iPhone은 기기가 없어 실기기 검증하지 않았다.

## 이번 검증 결과 (2026-10-11)

- XCTest 51개 모두 통과: Core 25개, Presentation 행동 26개. 테스트 하나에서 여러 허용 값 및 경계 조합을 반복 검증한다.
- 릴리스 빌드, CLI 자체 검사, 앱 서명 검증 통과.
- SM-S901N Android 실기기에서 886×1920 프레임과 PNG 저장, 정상 MP4 저장, 실제 영상 소켓 중단 중 녹화 마무리, 수동 시작 없는 자동 재연결 및 실제 첫 프레임, UserDefaults 기기 선택 복원, 수동 종료 후 3초 이상 자동 재시작 방지 확인.
- 정상 녹화 3.067초 H.264/AAC, 연결 중단 녹화 2.167초 H.264. 둘 다 FFmpeg로 끝까지 디코딩해 오류 없음. 소리가 실제로 준비되지 않은 녹화는 영상만 저장한다.
- GUI에서 항상 맨 위/자동 재연결 값을 바꾸고 앱을 종료·재실행하여 복원 확인. 검증 후 원래 기본값으로 되돌리고 Android 실제 화면 표시 상태로 열어 두었다.
- 물리적인 USB 케이블 분리와 iPhone 실기기 시험은 실행하지 않았다.

실행 로그와 red/green 증거는 로컬 `dist/Verification/TestLogs`에 보관한다. 출력 폴더는 버전 관리 대상이 아니다.

## Wi-Fi 확장 TDD와 검증 (2026-10-11)

초기 무선 도메인 및 행동 테스트를 구현 전에 실행해 미구현 타입/API 실패를 확인했다. 실제 주소 변경 중 기존 세션이 유지되는 실패를 먼저 재현하고 새 엔드포인트로 세션을 교체하도록 구현했다. 최대 길이 Wi-Fi 선택 저장, 서비스 접미사 변경, 다른 폰의 주소 재사용 사례도 테스트를 먼저 작성했다.

첫 실기기 포트 변경 시험에서 Bonjour 검색 이름에 `(2)`가 붙고 이전 서비스가 캐시에 남는 사례가 발견됐다. 이름의 공백을 읽지 못하고 목록 순서에 따라 다른 엔드포인트를 고르는 실패를 회귀 테스트로 확인했다. 공백을 포함한 서비스와 ADB 식별자를 파싱하고, 새 충돌 인스턴스를 우선하며 중복 목록 순서가 바뀌어도 선택이 안정적이도록 수정했다. Wi-Fi 시간 초과에 USB 전용 안내가 남는 경우도 실패 테스트 이후 수정했다.

### 자동 테스트 범위

- Core: IPv4·대괄호 IPv6 주소, 포트 1/65535 및 0/65536/음수/기호/비 ASCII 숫자/잘못된 호스트, 정확히 6자리 ASCII 코드와 앞자리 0, mDNS 페어링·연결 포트 분리, 손상된 목록과 중복 항목, 공백 및 Bonjour 충돌 접미사.
- Core: 실제 기기 식별자·선택한 연결 방식·변하는 주소를 분리, 같은 기기의 USB/Wi-Fi 구분, 기기 ID 최대 길이 256 및 Wi-Fi 선택 ID 저장, 무선 북마크 저장·복원·손상 복구. 북마크에 주소와 페어링 코드를 저장하지 않는다.
- Backend: ADB 실행 의존성 주입, 코드의 표준 입력 전달과 명령 인자 배제, 종료 코드가 0이어도 실패 문구면 거부, 잘못된 입력은 프로세스를 시작하지 않음, 실제 subprocess 표준 입력·취소·시간 제한.
- Backend: 실제 일련번호 확인, 저장한 서비스의 새 주소와 포트 검색, 서비스 접미사 변경, 다른 폰·알 수 없는 식별자 배제, 검색 실패 시 USB 유지, 중복 alias와 IP 항목의 안정적인 우선순위.
- Frontend: 페어링·연결 입력 경계와 버튼 활성화, 검색 결과에서 올바른 포트 선택, 중복 클릭 차단, 취소 후 늦은 완료 무시, 코드 삭제 및 오류 노출 방지, 연결 결과로 기기 목록 갱신.
- Frontend: 새 주소로 같은 폰 재연결, 연결 중 주소 변경 시 이전 세션 종료, 같은 폰이어도 USB로 자동 전환하지 않음, 선택 저장·복원과 앱 실행 시 미러링 자동 시작 방지, Wi-Fi 시간 초과 안내와 조작 차단.

지원하지 않는 iPhone Wi-Fi 대상이 세션 생성과 자동 재연결 검증을 통과하는 경우도 실패 테스트로 재현하고 두 경로에서 차단했다.

최종 UI 확인에서 일시적으로 빈 mDNS 검색 결과를 주소 변경으로 판단하는 경우를 발견했다. 실패 테스트 이후 ADB가 계속 보고하는 연결의 서비스 해석 결과를 메모리에 유지하도록 수정했다. 새 검색 주소가 나오면 갱신하고 ADB에서 사라진 연결은 캐시에서 제거한다. 이 캐시는 설정 파일에 저장하지 않는다.

최종 XCTest **88개 통과**: Core 35개, 화면 행동 37개, 백엔드 서비스/프로세스 16개. 각 테스트에서 여러 허용 값·경계 조합도 확인한다.

### 실기기 결과

- 사용자 제공 일회용 코드로 Android 실기기를 실제 ADB Wi-Fi 페어링했다. 코드를 로그 파일이나 앱 설정에 기록하지 않았다.
- 앱 UI에서 무선 검색 결과와 직접 연결, 범위 밖 포트 65536 차단, USB/Wi-Fi 별도 목록, 영상 헤더의 방식 표시, 886×1920 실제 Wi-Fi 영상, 재실행 후 Wi-Fi 선택 복원과 자동 시작 방지를 확인했다.
- Wi-Fi 실기기 통합 검증: PNG·MP4 저장, 실제 영상 소켓 중단 시 녹화 마무리, 수동 시작 없는 재연결, 무선 디버깅을 잠시 껐다 켜서 **실제 연결 포트 변경 후 같은 폰의 새 영상 프레임 수신**, USB 장치 유지, 수동 종료 후 재연결 차단이 모두 통과했다.
- 이후 기존 USB 실기기 통합 검증도 다시 실행해 영상·PNG·MP4·소켓 중단·자동 재연결·수동 종료가 모두 통과했다.
- Wi-Fi 정상 및 연결 중단 MP4를 FFmpeg로 끝까지 디코딩해 오류가 없음을 확인했다. 오디오 트랙은 녹화 시작 시 실제 오디오 준비 상태에 따라 포함된다.
- 실제 Wi-Fi IP 주소 변경은 공유기 설정을 바꾸지 않고 도메인·백엔드·화면 행동 테스트로 검증했다. 물리적으로 케이블을 분리하는 시험 및 iPhone Wi-Fi 지원은 이 작업에 포함하지 않았다.

```sh
"dist/Phone Mirror.app/Contents/MacOS/PhoneMirror" --smoke-test-wifi "$PWD/dist/Verification/WiFi" --verify-port-change
"dist/Phone Mirror.app/Contents/MacOS/PhoneMirror" --smoke-test "$PWD/dist/Verification/USB"
```

포트 변경 검증 옵션은 같은 폰의 USB 연결이 필요하며 이미 활성화된 무선 디버깅을 잠깐 껐다 켜서 재현한다. 시험 후 활성화 상태를 유지한다. 로그 및 TDD red/green 증거는 gitignore가 적용된 `dist/Verification/TestLogs`에 보관한다. 자동 검색과 변경 주소 재발견에는 네트워크의 mDNS 동작이 필요하며, 차단된 네트워크에서는 현재 주소를 직접 입력할 수 있다.


## 보안 회귀 검증 (2026-10-14)

세 보안 개선점은 변경 전 테스트 실패를 확인한 뒤 수정했다.

- `unauthenticated_idle_client_does_not_block_legitimate_keyboard`: 기존 구현에서 정상 키보드 인증이 1초 안에 진행되지 않아 실패했다. 수정 후 인증 전 연결을 최대 4개 병렬 처리하며, IP당 8초에 8회와 추적 주소 64개 제한을 적용한다. 전체 인증의 읽기·쓰기에는 8초 제한을 적용하며, 종료 시 대기 작업과 소켓을 취소한다. 연결 수 한계, 반복 잘못된 인증, 정확한 시도 제한 시간 경계, 연결 세대, ACK 시간 초과와 취소를 검사한다. 이는 자원 제한과 단일 미인증 연결의 지연을 줄이는 조치이며, 네트워크 전체의 서비스 거부 공격을 막는다는 보장은 아니다.
- `testConnectionSecretsAreNotSavedInDefaults`: 기존 송출 설정과 키보드 코드가 UserDefaults에 남아 두 assertion이 실패했다. 수정 후 App Group Keychain에 저장하고 저장 성공 후 기존 값을 제거한다. 주입한 저장소로 누락·손상·읽기/쓰기 실패·반복 이관을 검사한다.
- 추가 이관 회귀 테스트 `testLegacyValuesCannotReplaceExistingSecureCodesOrBypassReadFailure`에서 오래된 값이 이미 저장된 Keychain 코드를 덮어쓰고 읽기 실패를 우회하는 네 assertion의 실패를 확인했다. 수정 후 Keychain을 먼저 읽고, 기존 보안 항목이 없는 경우에만 검증된 값을 이관한다. 보안 저장값이 있으면 오래된 UserDefaults 값은 제거한다.
- `saved_capture_has_owner_only_permissions_in_shared_directory`: 기존 PNG가 `0644`로 생성되어 `0600` 기대값에 실패했다. 수정 후 내용을 쓰기 전에 Unix `0600`과 실제 모드 확인, Windows 현재 사용자 SID의 보호된 DACL을 적용한다. Windows는 ACL을 지속적으로 지원하지 않는 저장 장치를 거부한다. 원자적 저장, 기존 파일 보존, 임시 파일 정리도 기존 회귀 검사로 확인한다. macOS 공유 폴더 ACL의 상속 여부도 검사한다.

검증 명령:

```sh
cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked
cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets --locked -- -D warnings
cargo check --manifest-path desktop/src-tauri/Cargo.toml --no-default-features --locked --tests --target x86_64-pc-windows-gnu
swift test
swift test --package-path ios
# desktop에서 실행
npm test
npm run build
```

macOS에서 기존 Swift 앱 53개, iOS 코어 26개, 데스크톱 프런트엔드 199개 자동 테스트가 통과했다. Rust 전체 143개가 통과한 뒤 인증 대기 중 종료 테스트를 추가했고 최종 관련 검사(키보드 9개, 미디어 5개)가 통과했다. Clippy의 경고 금지 검사, Rust/Swift 형식 검사와 데스크톱 빌드도 통과했다. iOS 앱과 방송·키보드 확장은 `iphonesimulator`와 `iphoneos` SDK로 `CODE_SIGNING_ALLOWED=NO` 빌드했다. Windows 결과는 테스트 소스까지 포함한 크로스 컴파일이며 Windows 네이티브 실행 결과가 아니다. 기존 Windows CI는 이 ACL 테스트를 네이티브 `cargo test`에 포함한다.

Android USB 실기기(SM-S901N)에서 기존 녹화·캡처 통합 예제를 두 번 실행했다. 두 실행 모두 녹화 완료 시 “녹화할 기준 프레임을 받지 못했습니다.” 오류로 종료했으므로 전체 통합 성공으로 보고하지 않는다. 그 전에 생성된 녹화 중/일시정지 중 PNG 총 네 파일은 실제 화면의 PNG 시그니처와 `0600` 권한을 확인했다. 이 검증은 캡처 저장에 한정하며 물리적 케이블 분리 시험은 아니다. 실제 화면 미디어는 외부로 공유하지 않고 무시된 `desktop/src-tauri/target/verification/recording-screenshot`에만 보관한다.

실제 iPhone이 연결되어 있지 않아 서명된 앱과 확장 간 Keychain 공유, ReplayKit·실제 iPhone 키보드 검증은 수행하지 않았다. Windows 네이티브 ACL 적용·읽기 검증도 이 macOS 환경에서는 수행하지 않았다. 로컬 검사 로그는 무시된 `.build/security-*.log`에 보관한다.

## Android 녹화 기준 프레임 준비 검증 (2026-10-14)

이전 녹화 검사 오류는 MP4 writer의 영상 샘플 수가 0인 상태에서 종료할 때 발생하는 경로다. 녹화 시작 전 수신한 키 프레임은 저장하지 않고 다음 키 프레임을 기다리는 기존 정책은 적절하지만, 작업 생성 직후 시작 성공을 반환해 아직 새 기준 프레임이 없는 녹화를 종료할 수 있었다. 최초 진단에서는 이전 검사와 같은 USB 기기로 수정 전 긴 녹화가 통과했다(시작 전/후 키 프레임 1/7). 당시 실패 로그에는 패킷 통계가 없어 과거 기기 상태나 프레임 중단 이유까지 단정하지 않는다. 추가한 같은 연결의 150ms 재녹화 검사는 새 키 프레임 요청만 적용한 상태에서도 동일 오류로 실패해 시작 준비 경합을 실제 기기에서 재현했다.

### 수정

- Android 녹화 시작과 실제 일시정지→재개 전환마다 해당 세션의 제한된 제어 큐에 scrcpy 5.0 `TYPE_RESET_VIDEO`(17)를 보낸다. [상류 메시지 정의](https://github.com/Genymobile/scrcpy/blob/v5.0/server/src/main/java/com/genymobile/scrcpy/control/ControlMessage.java)와 [인코더 재생성 경로](https://github.com/Genymobile/scrcpy/blob/v5.0/server/src/main/java/com/genymobile/scrcpy/video/SurfaceEncoder.java)를 확인했다. 요청은 `RecordingFrameRequester`로 주입하므로 녹화 정책은 USB·Tauri·OS 인코더 API에 의존하지 않는다. iOS에는 Android 제어 메시지를 보내지 않는다.
- 네이티브 시작 IPC는 muxer가 첫 IDR 영상 샘플을 수용한 후 성공한다. 준비 대기는 최대 5초이며 세션 lock을 잡은 채 기다리지 않는다. 프레임이 없을 때 시간 초과·연결 종료·잘못된 샘플은 실패하고 임시 작업을 정리한다. 종료 직전에 이미 받은 샘플은 저장할 수 있도록 유지한다.
- 키 프레임 플래그가 있어도 IDR NAL이 없는 샘플은 거부한다. 시작 전·일시정지 중 영상이나 기준 프레임 전의 delta를 파일에 재사용하지 않는다. 반복 시작·반복 재개·취소된 세션·혼잡하거나 닫힌 제어 큐를 검사하며, 재개 요청 실패 시 일시정지 상태를 유지한다.
- 실기기 예제는 시작 준비를 기다리고, 시작/재개의 인코더 configuration 갱신, 같은 연결의 150ms 재녹화까지 검사한다. 테스트 시간을 늘려 실패를 숨기거나 녹화 이전 영상으로 파일을 채우지 않는다.

### TDD와 자동 검사

프레임 요청 누락 및 실패 무시 테스트 두 개의 assertion 실패를 확인한 뒤 구현했다. 이후 첫 프레임 이전 준비 성공과 5초 경계 테스트 두 개의 실패를 확인하고 준비 대기를 구현했다. 마지막으로 IDR이 없는 키 프레임 플래그가 성공하는 테스트 실패를 확인하고 샘플 검증을 보완했다. 로그는 무시된 `.build/recording-frame-requests-red.log`, `.build/recording-readiness-red.log`, `.build/recording-invalid-key-red.log`에 보관한다.

최종 `cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked`: **151개 통과**. 준비 완료·시간 경계·임시 파일 정리·늦은 프레임·연결 종료 직전 받은 영상의 저장·반복 행동·오디오 및 일시정지 타임라인을 포함한다. `npm test`: **199개 통과**(대기 중 네이티브 시작 뒤 종료, 재개 실패 안내와 일시정지 유지 등 기존 프런트엔드 행동 포함). Clippy `--all-targets --locked -- -D warnings`, Rust 형식 검사, `git diff --check`, 데스크톱 빌드도 통과했다. Windows `x86_64-pc-windows-gnu`는 `--no-default-features --tests --locked` 크로스 컴파일이 통과했으며 Windows 네이티브 실행 결과가 아니다. 기존 Swift macOS 앱 소스는 변경하지 않았다.

### 실제 Android USB 결과

SM-S901N, 886×1920 실제 영상으로 최종 수정본의 녹화·일시정지·재개, 녹화 중/일시정지 중 PNG 저장, 중복 저장 실패 후 녹화 유지, 같은 연결의 150ms 재녹화가 통과했다. 화면이 켜진 상태와 꺼진 상태에서 검사했으며 마지막 검사 후 화면을 깨웠다. 시작과 재개가 각기 새 인코더 configuration을 수신하는 것을 확인했다. 두 MP4를 FFmpeg로 끝까지 디코딩했다. 마지막 실행의 일반 녹화는 53프레임/4.667736초, 짧은 재녹화는 2프레임/0.201314초였고, 두 MP4와 두 PNG의 `0600` 권한도 확인했다.

실제 미디어는 무시된 `desktop/src-tauri/target/verification/recording-screenshot` 아래에만 보관하고 외부로 공유하지 않았다. 이 결과는 Android USB 녹화 검증이며, 물리적 케이블 분리·Android Wi-Fi·실제 iPhone·Windows 네이티브 검증을 의미하지 않는다. 최종 로그는 `.build/recording-physical-final.log`, `.build/recording-all-tests.log`, `.build/recording-clippy.log`, `.build/recording-windows-check.log`에 보관한다.

최종 커밋 전 재검토에서는 `cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked` 151개, `swift test --build-system native` 92개, `swift test --package-path ios` 26개를 다시 실행해 모두 통과했다. 이 재검토 결과는 무시된 `.build/final-review-*-tests.log`에 보관한다.
