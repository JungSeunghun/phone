# Phone Mirror Desktop — Rust + Tauri

기존 Swift 앱과 별도로 유지하는 Windows/macOS용 폰 화면 미러링 앱입니다. Android는 Windows/macOS에서 USB·Wi-Fi를 지원하고, iPhone은 macOS USB 화면 수신 경로를 구현했습니다. iPhone 실기기 검증은 아직 하지 않았습니다. 앱 식별자와 설정 저장 공간이 달라 두 앱을 독립적으로 사용할 수 있습니다.

Android 화면을 앱 내부 캔버스에 표시하고 USB·Wi-Fi 기기 선택, 무선 검색·페어링·주소 직접 연결, 설정 저장과 자동 재연결을 지원합니다. Android는 컴퓨터 오디오 재생과 마우스 클릭·드래그·스크롤·뒤로가기도 지원합니다. Mac USB iPhone은 화면과 기기 오디오 수신을 지원하며 마우스 조작·폰 화면 켜두기는 지원하지 않습니다. PNG 스크린샷, MP4 녹화, 전체 화면과 PiP는 공통 영상 경로를 사용합니다. 별도 iPhone 송출 앱의 화면·앱 소리는 Mac과 Windows에서 받을 수 있습니다. Windows USB는 송출 앱의 화면 방송과 Apple 기기 통신 드라이버를 사용하며, Mac USB는 기존 네이티브 수신을 사용합니다.

## 실행 및 빌드

- Node.js 22, npm, Rust stable을 설치하세요. 개발·테스트 도구는 Rust 1.99.0에서 검증했습니다.
- Android 연결에는 Platform Tools 전체 폴더를 설치하고 `adb`/`adb.exe`가 PATH에서 검색되게 하세요. Windows에서는 함께 제공되는 DLL도 필요합니다. Mac iPhone USB 경로는 ADB 설치에 의존하지 않습니다.
- `PHONE_MIRROR_ADB_PATH`로 실행 파일의 전체 경로를 지정할 수도 있습니다. `ANDROID_HOME`/`ANDROID_SDK_ROOT` 아래 `platform-tools`, 앱 실행 파일 옆의 ADB, macOS Homebrew 설치 경로도 검색합니다.
- macOS 빌드에는 Xcode Command Line Tools가 필요합니다. 앱 최소 버전은 macOS 14이며 H.264 WebCodecs를 지원하는 WKWebView가 필요합니다.
- Windows 빌드에는 Visual Studio C++ Build Tools와 Windows SDK가 필요합니다. 실행에는 최신 Edge WebView2가 필요하며 NSIS 설치 패키지는 Tauri의 기본 WebView2 설치 흐름을 사용합니다.

```sh
cd desktop
npm ci
npm run tauri dev
```

macOS 앱 번들:

```sh
npm run tauri build -- --bundles app
```

Windows PowerShell 설치 패키지:

```powershell
npm run tauri build -- --bundles nsis
```

결과는 `src-tauri/target/release/bundle`에 생성됩니다. 현재 Mac에서 만든 앱은 저장소 루트의 `dist/Phone Mirror Desktop.app`에도 보관합니다. 기존 `dist/Phone Mirror.app`은 Swift 앱입니다.

## 폰 연결

Android USB 연결은 폰의 개발자 옵션에서 USB 디버깅을 켜고 컴퓨터를 허용한 다음 기기 목록의 USB 항목을 선택하세요.

iPhone은 Mac에 데이터 USB 케이블로 연결하고 잠금을 해제한 뒤 **이 컴퓨터를 신뢰**를 승인하세요. USB 화면 장치가 기기 목록에 나타나면 선택하고 `폰 화면 보기`를 누릅니다. Mac의 카메라 권한은 USB 화면 수신에 사용하며 첫 연결 때 허용해야 합니다. 거부했다면 시스템 설정에서 앱의 카메라 권한을 허용하세요. 장치가 나열돼도 실제 프레임을 그리기 전에는 `화면 수신 중`으로 표시하지 않습니다. 신뢰되지 않은 폰은 macOS가 화면 장치를 노출하지 않을 수 있어 목록에 나타나지 않습니다. 현재 iPhone은 실기기 미검증 상태이며 보호된 콘텐츠의 캡처 가능 여부도 확인하지 않았습니다.

Mac 캡처 어댑터는 CoreMediaIO의 USB 화면 장치 허용 설정과 AVFoundation의 `iOS Device` muxed 입력을 사용합니다. 일반 웹캠과 Continuity Camera는 iPhone 화면 장치로 나열하지 않습니다. Wi-Fi 화면 장치 허용은 끕니다. 기기 식별자는 `ios:` 이름 공간으로 Android와 분리하고 동일한 USB 화면 장치 식별자로 다시 찾습니다. 권한 거부·장치 없음·첫 프레임 제한 시간·연결 종료를 구분하며, iPhone이 잠시 검색에서 사라져도 활성 세션의 지원 기능은 유지합니다.

Wi-Fi 연결은 폰과 컴퓨터를 같은 네트워크에 연결하고 Android 11 이상에서 무선 디버깅을 켜세요. `Wi-Fi 페어링 · 연결`을 펼친 뒤 검색된 페어링 주소 또는 폰에 표시되는 페어링 IP:포트와 6자리 코드를 입력합니다. 이어서 무선 디버깅의 **연결 IP:포트**로 연결하세요. 페어링 포트와 연결 포트는 다릅니다. 같은 ADB 호스트에서 이미 페어링한 폰은 기존 인증을 사용할 수 있습니다.

화면 보기 버튼으로 시작하며 실제 디코딩된 프레임이 캔버스에 그려진 후 `화면 수신 중`으로 표시합니다. 앱을 다시 실행해도 영상은 자동 시작하지 않습니다. 연결 종료는 시작 중인 작업과 재연결 대기를 취소합니다.

재연결은 물리 기기 일련번호와 선택한 연결 방식을 기준으로 합니다. 저장한 서비스 이름을 mDNS로 다시 검색하고 새 주소의 일련번호를 확인합니다. 같은 폰의 USB가 남아 있어도 선택한 Wi-Fi를 USB로 자동 전환하지 않습니다. 재시도 간격은 1·2·4·8·16초이며, 기기 없음/오프라인 상태는 횟수를 소모하지 않습니다. 새 프레임이 표시되면 실패 횟수를 초기화합니다. 주소 재발견에는 네트워크의 mDNS 동작이 필요하며 검색이 차단되면 현재 주소를 직접 입력할 수 있습니다.

페어링 코드는 ADB 프로세스의 표준 입력으로만 전달하며 설정이나 로그에 저장하지 않습니다. 무선 북마크에는 일련번호·이름·서비스 이름을 저장하며 IP/포트는 저장하지 않습니다. 활성 ADB 연결의 서비스 해석 결과는 일시적인 빈 검색 결과에 대비해 메모리에만 보관합니다.

## 영상 중심 레이아웃

연결 상태와 연결 시작·종료 버튼은 뷰어 상단에 고정됩니다. 기기·화질·Wi-Fi 설정은 별도로 스크롤되며, 실제 영상이 표시되면 설정 패널을 자동으로 접어 영상 영역을 확보합니다. `설정 열기`로 다시 펼칠 수 있고 연결 종료·재연결 상태에서는 설정을 다시 표시합니다. 하단 도구 모음에는 오디오와 캡처를 모으고, 소리가 정상 재생되면 재생 버튼을 숨깁니다.

## 전체 화면 · PiP 보기

실제 폰 영상이 표시되면 뷰어 오른쪽 위의 `전체 화면` 또는 `PiP`를 누르세요. 전체 화면에서는 설정 패널을 숨기고 모니터 전체를 사용합니다. macOS는 별도 Spaces 전환 없이 전체 화면을 표시합니다.

PiP는 현재 앱 창을 작고 항상 위에 있는 창으로 전환합니다. 제목 표시줄로 이동하거나 가장자리를 드래그해 크기를 조절할 수 있으며 최소 영상 영역 창 크기는 240×180입니다. 기본 크기는 폰 영상 방향과 현재 모니터 작업 영역에 맞춥니다. 브라우저의 영상 전용 PiP 대신 같은 캔버스를 유지하므로 USB·Wi-Fi 영상, 컴퓨터 소리, 마우스 조작과 진행 중인 녹화가 유지됩니다.

`기본 보기`, Esc 또는 메뉴 `보기 → 기본 보기`로 원래 위치·크기·최대화 상태로 돌아옵니다. PiP의 창 닫기 버튼도 기본 보기로 복원합니다. 앱 종료는 Cmd+Q(macOS) / Ctrl+Q(Windows) 또는 종료 메뉴를 사용하세요. 연결이 끊기면 기본 보기로 돌아와 연결 상태와 재연결 안내를 표시합니다. 다시 연결돼도 자동으로 PiP/전체 화면을 시작하지 않습니다. 캡처 시작은 기본 보기에서 사용합니다. 녹화 중에는 모든 보기에서 녹화 상태·경과 시간·`녹화 종료 및 저장` 버튼을 유지하며, 작은 보기에서도 연결 종료와 소리 끄기/해제를 할 수 있습니다.

창 정책은 Rust `WindowPresentation`과 교체 가능한 `WindowPresentationPort`로 분리하고, 프론트는 `WindowPresentationController`와 `WindowPresentationBackend` 계약을 사용합니다. Tauri 창 API는 별도 어댑터에만 들어 있습니다. [Tauri WebviewWindow](https://docs.rs/tauri/2.12.2/tauri/webview/struct.WebviewWindow.html)의 전체 화면·위에 표시·위치·크기 API를 사용합니다.

## 컴퓨터 소리와 마우스 조작

`폰 화면 보기`를 누르면 폰 영상과 함께 컴퓨터의 기본 오디오 출력 장치로 폰 소리를 재생합니다. 자동 재생이 제한되면 `소리 재생`을 누르세요. `음소거`는 컴퓨터 재생만 끄며 폰 설정을 바꾸지 않습니다. Android 11 이상에서 지원하며 앱의 재생·보호 정책에 따라 소리 전달이 제한될 수 있습니다. 오디오를 사용할 수 없을 때도 영상과 마우스 연결은 유지합니다.

폰 화면 안에서 왼쪽 클릭은 터치, 누른 채 이동은 드래그, 휠은 스크롤, 오른쪽 클릭은 뒤로가기입니다. 화면 주변의 검은 여백은 클릭 대상에서 제외합니다. 세로·가로 회전과 창 크기에 따라 좌표를 다시 계산하고, 드래그 중 창이 포커스를 잃거나 포인터가 취소되면 터치를 해제합니다. 연결을 종료하거나 재연결할 때 이전 세션의 대기 입력과 오디오는 폐기합니다.

오디오는 scrcpy 5.0의 48kHz/16-bit/stereo PCM을 바이너리 채널로 전달하고 Web Audio로 재생합니다. 전송량은 약 1.5Mbps이며 예정된 재생이 150ms를 넘으면 대기 버퍼를 초기화해 지연 누적을 제한합니다. 입력은 세션별 제한된 큐를 통해 순서대로 제어 소켓에 쓰며, 종료 중 눌려 있던 포인터는 취소 메시지로 정리합니다. `AudioSink`, `MouseInputController`, Rust `ControlSession` 및 프로토콜 인코더는 서로 분리되어 있습니다.

## 스크린샷과 녹화

실제 첫 프레임을 받은 뒤 `스크린샷 저장` 또는 `화면 녹화`를 누르세요. 스크린샷은 원본 캔버스 해상도의 PNG입니다. 원본 H.264를 MP4로 저장하며 영상은 재인코딩하지 않습니다. Android USB·Wi-Fi와 iPhone Mac USB·Wi-Fi는 수신한 48kHz 스테레오 PCM을 AAC-LC 128kbps로 인코딩해 함께 저장합니다. iPhone Mac USB는 선택한 iPhone 화면 장치의 오디오 포트만 사용합니다. 오디오 포트가 없거나 소리 권한·출력을 사용할 수 없으면 안내를 표시하고 영상 수신을 유지합니다. 이 경우 수신하지 못한 소리는 녹화할 수 없습니다. 컴퓨터 재생 음소거는 녹화 소리를 끄지 않습니다. 소리가 전달되지 않은 구간은 무음으로 저장하며 컴퓨터 마이크는 사용하지 않습니다. 다음 키 프레임부터 저장하므로 시작까지 짧은 대기가 있을 수 있습니다. `녹화 종료 및 저장`에서 운영체제 저장 창을 엽니다. 녹화 중에는 스크린샷을 비활성화합니다. 녹화 상태·경과 시간·일시 정지·재개·종료 버튼은 모든 보기에서 유지됩니다.

`녹화 일시 정지`는 녹화 입력과 경과 시간만 멈추며 화면·소리 재생을 유지합니다. `녹화 재개`는 다음 키 프레임부터 새 구간을 같은 파일에 연결합니다. 정지 중과 재개 후 키 프레임 대기 구간은 파일에서 제외합니다. 영상과 오디오는 공통 소스 시간으로 다시 정렬하며 AAC 분석 지연 1024샘플과 마지막 패딩은 MP4 edit list로 제외합니다. UI 경과 시간은 버튼 동작 기준이며 실제 첫 키 프레임·재개 대기 때문에 파일 길이와 짧은 차이가 생길 수 있습니다. 정지 상태에서도 종료·연결 해제·앱 종료 시 저장을 마무리합니다.

수동 연결 종료, 연결 실패 및 앱 종료 시 현재 녹화를 마무리하고 저장 창을 표시합니다. 자동 재연결 후 녹화를 자동으로 다시 시작하지 않습니다. 저장 취소는 해당 캡처만 버립니다. 기존 파일 덮어쓰기는 지원하지 않으므로 새 이름을 선택하세요. 완성 파일을 임시 파일에 쓴 뒤 원자적으로 공개하며 실패 시 임시 파일을 정리합니다.

파일 최대 크기는 256MiB이며 한도 8MiB 전에 종료·저장을 시도합니다. 정지 시간을 제외한 1시간 또는 영상·오디오 합계 200,000샘플에서도 종료합니다. 폰 회전 등으로 영상 설정이 바뀌면 변경 전 녹화를 마무리해 저장하며 새 녹화는 직접 시작해야 합니다. 저장·오디오 인코딩은 별도 Rust 스레드와 최대 64입력·8MiB 대기열을 사용합니다. 대기열이 초과되면 녹화는 실패하지만 화면·소리 재생은 저장을 기다리지 않습니다. 샘플 수·용량을 초과해 오디오 트랙을 완성하지 못하면 부분 파일을 폐기합니다. 임시 파일에 순차 기록하고 파일 전체를 프론트로 복사하지 않습니다. 저장 폴더는 하드 링크를 지원해야 합니다(APFS/NTFS 등). 앱 종료 시 저장 응답은 최대 180초 기다립니다. 강제 종료나 OS 종료에서는 미저장 녹화를 복구하지 못합니다.

기본 보기 하단 `성능 정보`에서 세션 평균 표시 FPS, 수신·표시·최신 프레임 교체 수, 수신/표시 간격, 디코딩·그리기 시간과 최대 디코더 큐를 확인합니다. UI는 1초마다 갱신하고 표본은 최근 최대 256개만 보관합니다. 디코딩된 프레임은 최신 것 하나만 보관하고 모니터 갱신 주기에 맞춰 표시합니다. 압축 프레임은 참조 관계를 유지해 디코딩합니다. 수치는 캔버스 그리기 기준이며 실제 디스플레이 출력이나 폰부터의 전체 지연을 측정하지 않습니다. 정지 화면에서 낮은 FPS는 정상일 수 있습니다.

캡처 구조는 `MediaCaptureSource`(교체 가능한 캡처 계약), `NativeMediaCapture`(원본 녹화 어댑터), `MediaCaptureController`(사용자 행동·수명·주입 가능한 `RecordingClock`), `MediaCaptureStore`(PNG 바이너리와 완료 녹화 식별자의 저장 어댑터)로 분리했습니다. Rust `recording.rs`는 Tauri와 독립적으로 원본 패킷·시간·MP4·저장 대기열을 담당하고 `media.rs`는 PNG 등 바이너리 캡처 저장을 담당합니다. 네이티브 저장 창은 [Tauri Dialog](https://v2.tauri.app/plugin/dialog/)를 사용합니다.

## iPhone Mac USB 화면·소리 수신

잠금 해제와 USB 신뢰를 완료한 iPhone을 선택해 연결합니다. Mac의 카메라·오디오 캡처 권한을 허용하세요. OS는 오디오 권한을 마이크 권한으로 표시할 수 있지만 컴퓨터 마이크 장치는 열지 않으며 선택한 iPhone 입력의 오디오 포트만 연결합니다. 화면·소리는 동일한 AVCaptureSession에서 받고, 영상과 PCM을 같은 원본 시각 기준으로 전달합니다. AVCaptureAudioDataOutput에 48kHz stereo Int16 little-endian 변환을 요청하며 최대 1024프레임씩 공통 오디오 채널로 전달합니다.

화면과 소리 녹화, 일시 정지·재개, 전체 화면·PiP는 기존 공통 경로를 사용합니다. 시작 기준보다 이른 영상은 제외하고 초기 오디오는 표본 단위로 자릅니다. 종료 시 영상·오디오 delegate를 해제하고 캡처 큐와 인코더 콜백을 배출한 뒤 Rust 컨텍스트를 해제합니다. 기기·앱·보호 콘텐츠가 오디오를 제공하지 않는 경우 그 소리를 복구하거나 컴퓨터 마이크로 대체하지 않습니다.

`npm run test:ios-usb-audio`는 합성 CMSampleBuffer를 USB 오디오 처리기에 넣고 약 267ms의 MP4와 100ms 톤 동기화를 FFmpeg로 확인합니다. 실제 iPhone·권한 알림·USB 오디오 포트 검색 검증은 아니며 장시간 테스트를 하지 않습니다. Windows USB는 아래의 별도 송출 앱·USB 터널 경로를 사용합니다. Mac의 AVFoundation USB 입력을 Windows에서 사용하지 않습니다.

네이티브 경계의 근거: [Apple AVCaptureAudioDataOutput](https://developer.apple.com/documentation/avfoundation/avcaptureaudiodataoutput), [입력 포트](https://developer.apple.com/documentation/avfoundation/avcaptureinput/port), [PCM 표본 복사](https://developer.apple.com/documentation/coremedia/cmsamplebuffercopypcmdataintoaudiobufferlist(_:at:framecount:into:)).

## 구조

| 위치 | 역할 |
|---|---|
| `src-tauri/src/domain.rs` | 기기·연결·설정·주소·영상 패킷 규칙 |
| `src-tauri/src/application.rs` | 세션 의도, 중복 시작·취소·세대 관리 |
| `src-tauri/src/infrastructure` | 주입 가능한 ADB 실행, 무선 서비스, 검색, 저장, scrcpy 전송 |
| `src-tauri/src/window_presentation.rs` | 전체 화면·PiP 전환, 모니터 경계와 원래 창 복원 정책 |
| `src-tauri/src/window_presentation_adapter.rs` | Tauri 네이티브 창 표시 어댑터 |
| `src-tauri/src/desktop.rs` | Tauri 명령·채널 어댑터와 앱 수명 관리 |
| `src/domain` | 공통 DTO 계약과 프론트 입력·패킷 검증 |
| `src/application` | 사용자 행동, 설정, 첫 프레임 및 재연결 상태 |
| `src/infrastructure` | Tauri IPC와 교체 가능한 영상 렌더러 |
| `src/presentation` | React 화면과 레이아웃 |

영상 경로는 Android scrcpy 5.0 서버 → ADB 포워딩 → Rust 패킷 검증 → Tauri 바이너리 채널 → WebCodecs H.264 디코더 → 캔버스입니다. 디코딩한 프레임을 이미지나 Base64로 변환해 IPC에 보내지 않습니다. 느린 디코딩 큐가 12프레임을 초과하면 참조 상태를 초기화하고 다음 키 프레임을 기다려 누적 지연을 제한합니다. 서버에 1초 기준 프레임 간격을 요청해 scrcpy 기본 10초 간격의 복구 대기를 줄입니다. 실제 간격은 폰 인코더·화면 변화에 따라 달라지며 정지 화면은 프레임을 계속 보내지 않을 수 있습니다. WebCodecs는 지연 최적화를 요청하고 사용 가능한 디코더를 시스템이 선택하도록 하므로 하드웨어 디코더가 없는 환경에서도 동작합니다. 다른 렌더러는 `VideoSink`를 구현해 교체할 수 있습니다.

scrcpy 서버는 앱에 포함되며 실행 시 외부 `scrcpy`나 FFmpeg가 필요하지 않습니다. Apache 2.0 라이선스와 출처는 앱 리소스의 `licenses`에 포함합니다. FFmpeg는 개발 검증에만 사용합니다.

## 테스트

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

Tauri 없이 도메인·서비스 테스트만 실행하려면 `npm run test:backend`를 사용하세요. 브라우저 테스트는 실제 폰 데이터를 사용하지 않는 별도 fixture로 창 크기·방향별 영상 영역과 종료 행동을 검사합니다. 이 fixture는 배포용 번들에 포함되지 않습니다.

macOS의 `npm run test:browser`는 사전 단계에서 네이티브 인코더로 모의 영상 30프레임을 생성합니다. Rust와 Xcode Command Line Tools가 필요하며 결과는 ignored `tests/generated/ios`에만 기록합니다. Chromium이 그 패킷을 디코딩하고 실제 PNG 캡처·모의 네이티브 녹화 식별자 저장·전체 화면/PiP 조작을 검사합니다. MP4 생성은 별도 Rust 테스트에서 같은 패킷으로 확인합니다. Windows에서는 이 Mac 전용 브라우저 테스트 하나를 건너뛰며 Android 브라우저 회귀 테스트는 실행합니다.

iPhone 캡처 포트 `IosCapturePort`와 서비스 `IosCaptureService`는 Tauri에서 독립적이며 모의 포트를 주입할 수 있습니다. Objective-C/Apple API는 `native/ios_capture.m`에, 안전한 패킷·기기 규칙은 `ios.rs`에, FFI 수명과 취소 처리는 `ios_capture.rs`에 분리했습니다. 네이티브 콜백은 캡처 종료·인코더 배출이 완료될 때까지 컨텍스트를 유지합니다. 이 분리로 향후 iPhone Wi-Fi 송출 수신기를 기존 표시·녹화 경로에 연결할 수 있습니다.

Apple API 자료: [USB 화면 장치 허용](https://developer.apple.com/documentation/coremediaio/kcmiohardwarepropertyallowscreencapturedevices), [AVCaptureDevice](https://developer.apple.com/documentation/avfoundation/avcapturedevice), [USB iPhone 화면 캡처 안내](https://support.apple.com/en-mide/guide/quicktime-player/qtp356b55534/mac).

Windows 백엔드 컴파일 확인:

```sh
rustup target add x86_64-pc-windows-gnu
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --target x86_64-pc-windows-gnu
```

이는 전체 Windows 앱의 네이티브 실행 검증과 다릅니다. `.github/workflows/desktop.yml`은 Windows/macOS에서 프론트·브라우저·Rust 테스트와 패키징을 수행하도록 구성되어 있습니다. 현재 저장소에는 원격이 없어 이 CI를 실제 실행하지 않았습니다. 검증 범위와 실기기 결과는 [TESTING.md](TESTING.md)에 기록합니다.

공식 자료: [Tauri 구조](https://v2.tauri.app/concept/architecture/), [바이너리 채널](https://v2.tauri.app/develop/calling-frontend/), [WebCodecs AVC 규격](https://www.w3.org/TR/webcodecs-avc-codec-registration/), [Android Wi-Fi 연결](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi).

## iPhone Wi-Fi

Mac·Windows 모두 **iPhone Wi-Fi 송출 → iPhone 수신 시작**으로 임시 수신 포트와 연결 코드를 만듭니다. 같은 Wi-Fi의 [Phone Mirror Sender](../ios/README.md)에 코드를 저장하고 시스템 화면 방송을 시작한 뒤 연결된 기기에서 해당 iPhone을 선택하세요. 앱 소리는 컴퓨터에서 재생하며 iPhone 마우스 제어는 지원하지 않습니다. Mac USB 수신과 Android USB·Wi-Fi는 기존 경로를 유지합니다.

`IosWifiReceiverService`가 AES-GCM 인증, 안정적인 설치 식별자, 짧은 heartbeat, 취소·재접속과 제한된 미디어 대기열을 담당합니다. `IosWifiReceiverController`는 주입한 backend로 수신 시작·종료·늦은 응답 정리를 처리하고, Wi-Fi iPhone capabilities에만 오디오를 활성화합니다. WebCodecs·PNG·화면/앱 소리 MP4·전체 화면·PiP 경로를 공유합니다. 화질·프레임은 iPhone 앱에서 설정합니다. 주소 변경 시 새 연결 코드를 입력하세요. 수신 코드는 데스크톱 설정이나 로그에 저장하지 않습니다. [프로토콜](../docs/IOS_WIFI_PROTOCOL.md)과 [iPhone 앱 빌드](../ios/README.md)를 참고하세요.

녹화의 시간·PCM 정렬 정책은 `recording_audio.rs`, 작업 수명·취소·주입 가능한 시계와 인코더 팩토리는 `recording.rs`, MP4 트랙과 edit list는 `recording_muxer.rs`에 분리합니다. AAC 어댑터는 MIT 라이선스 [oxideav-aac](https://github.com/OxideAV/oxideav-aac) 0.1.7이며 C 라이브러리나 외부 FFmpeg 실행 파일을 런타임에 요구하지 않습니다. 합성 파일 디코딩·100ms 음원 시작점 검증은 개발용 `npm run test:recording-audio`로 실행합니다. macOS VideoToolbox, Rust와 개발 환경의 FFmpeg/ffprobe가 필요하고 영상 구간은 약 267ms입니다. 결과는 ignored `tests/generated/audio-recording`에 보관합니다.

## Windows iPhone USB 화면·소리 수신

1. Windows에서 Apple Devices/Apple Mobile Device Support를 설치하고 Apple USB 기기 통신 서비스가 실행되는지 확인합니다. [Apple 기기 인식 안내](https://support.apple.com/en-ca/108643)를 참고하세요.
2. iPhone에 서명·설치한 [Phone Mirror Sender](../ios/README.md)를 사용합니다. 데이터 USB 케이블로 iPhone 한 대만 연결하고 잠금을 해제한 뒤 컴퓨터 신뢰를 승인합니다.
3. Windows 앱의 `iPhone Windows USB 송출`을 펼쳐 `iPhone USB 수신 시작`을 누릅니다. 표시된 `PMU1|포트|연결 키` 코드를 iPhone 송출 앱에 저장하고 시스템 화면 방송을 시작합니다.
4. 인증된 방송이 기기 목록에 USB로 나타나면 선택하고 `폰 화면 보기`를 누릅니다. 화면·앱 소리, PNG 캡처, MP4 동시 녹화, 일시 정지·재개, 전체 화면·PiP를 공통 경로로 사용합니다. 화질·프레임은 iPhone 송출 앱에서 설정합니다.

Wi-Fi 연결은 필요하지 않습니다. Windows의 로컬 Apple 서비스 `127.0.0.1:27015`에 기기를 검색하고 iPhone 방송 확장의 루프백 TCP 포트 27483을 USB로 연결합니다. 컴퓨터 내부 미디어 수신기도 루프백에만 열며, iPhone도 루프백에서만 방송 접속을 받습니다. 암호화·일회용 연결 키·챌린지·패킷 순서는 기존 미디어 프로토콜과 동일합니다. USB 키를 설정 저장소나 로그에 남기지 않고 수신 종료 시 폐기합니다. iPhone 앱에는 사용자가 저장한 연결 코드가 App Group 설정으로 남습니다.

현재 한 수신기에 iPhone 한 대를 지원합니다. 연결이 끊기면 같은 USB 일련번호를 다시 검색해 새 장치 번호로 연결하며 다른 iPhone으로 자동 전환하지 않습니다. 초기 USB 기기 검색과 터널 요청은 각각 3초로 제한하고 미디어 연결의 전체 수명에는 이 제한을 적용하지 않습니다. 송출 앱의 재시도 정책과 방송 수명은 별도로 유지합니다. 새 수신을 시작하면 새 코드를 iPhone에 저장해야 합니다.

`ios_usb`는 주입 가능한 `UsbMuxPort`, `UsbRetryScheduler`, `IosUsbReceiverService`로 검색·터널·재연결 정책을 분리합니다. `ios_receiver`는 USB/Wi-Fi와 독립적인 공통 인증 미디어 수신기이며 이전 `ios_wifi` API는 호환성을 위해 유지합니다. 프론트도 `IosReceiverController`/`IosReceiverPanel`을 공통으로 사용하고 USB·Wi-Fi IPC 어댑터를 분리합니다. Swift macOS 앱과 Mac 네이티브 USB 입력은 변경하지 않습니다.

Apple 기기 서비스가 없거나 기기가 0대/여러 대면 수신 준비를 중단하고 안내합니다. 신뢰·서명된 송출 앱·ReplayKit 화면 방송이 필요하며, 보호 콘텐츠와 송출되지 않는 앱 소리는 받을 수 없습니다. USB 통신 프로토콜 근거는 [libusbmuxd](https://github.com/libimobiledevice/libusbmuxd), [usbmuxd 프로토콜 처리](https://github.com/libimobiledevice/usbmuxd/blob/master/src/client.c)입니다. 이 라이브러리의 바이너리를 앱에 포함하지 않고 제한된 plist 클라이언트를 구현했습니다.

`npm run test:ios-windows-usb`는 Mac에서 합성 Swift USB 리스너 → 모의 Apple USB 서비스 → Rust 미디어 수신 → H.264/AAC MP4를 짧게 검증합니다. 실제 Windows 드라이버·iPhone·ReplayKit 실행 검증이 아닙니다. Windows 대상 백엔드 교차 컴파일과 기존 Windows CI의 전체 Tauri 빌드 경로는 유지하며, 이번 로컬 실행에서 Windows 설치 프로그램·네이티브 실행·원격 CI 성공을 검증하지 않습니다.

## QR 코드로 iPhone 연결

USB·Wi-Fi 수신을 시작하면 각 연결 코드 위에 QR 코드가 표시됩니다. iPhone의 Phone Mirror Sender에서 `QR 코드 스캔`을 누르고 컴퓨터 화면을 비춘 뒤 `연결 코드 저장`을 누르세요. 기존과 같이 시스템 화면 방송 버튼으로 송출을 시작합니다. Mac USB 네이티브 수신은 송출 앱이나 QR이 필요하지 않습니다.

QR은 기존 `PMW1`/`PMU1` 연결 코드를 그대로 담으며 외부 QR 서비스 없이 앱 안에서 생성합니다. 수신 종료 시 QR과 연결 코드가 함께 사라지고 다시 시작하면 새 키로 갱신됩니다. Wi-Fi 주소가 여러 개면 해당 네트워크의 QR을 선택하세요. QR은 연결 키를 포함하므로 공유하지 마세요.

iPhone 카메라는 스캔 화면에서만 사용하며 사진·영상·소리를 저장하지 않습니다. 스캔 취소·권한 거부·카메라 사용 불가 시 기존 직접 입력을 사용할 수 있습니다. 다른 앱의 QR, 잘못된 포트·키·주소는 저장하지 않고 재스캔을 안내합니다. 스캔한 코드는 사용자가 저장하기 전까지 기존 설정을 덮어쓰지 않습니다. iPhone 송출 앱을 업데이트해 설치해야 스캔 버튼을 사용할 수 있습니다.

구현 근거: [QR 인코더](https://github.com/soldair/node-qrcode), [Apple 카메라 접근 API](https://developer.apple.com/documentation/avfoundation/avcapturedevice/requestaccess(for:completionhandler:)), [QR 메타데이터 출력](https://developer.apple.com/documentation/avfoundation/avcapturemetadataoutput).

## Android Wi-Fi QR 페어링

1. Mac 또는 Windows의 `Wi-Fi 페어링 · 연결`에서 `Android QR 페어링 시작`을 누릅니다.
2. Android 11 이상 폰과 컴퓨터를 같은 Wi-Fi에 연결하고 개발자 옵션 → 무선 디버깅 → **QR 코드로 기기 페어링**을 엽니다. 해당 스캐너로 컴퓨터의 QR을 읽습니다. 일반 카메라 앱이나 iPhone 송출 앱을 사용하지 않습니다.
3. 앱이 해당 폰의 페어링 서비스를 발견해 자동으로 페어링하고 연결 포트를 검색합니다. 완료되면 갱신된 기기 목록에서 Wi-Fi 기기를 선택해 화면을 봅니다. 이미 사용 중인 USB 화면 세션은 유지합니다.

QR은 Android 공식 `WIFI:T:ADB;S:studio-...;P:...;;` 형식을 사용합니다. 앱에서 만든 무작위 서비스 이름과 키는 120초 동안만 유효하며 QR을 로컬에서 생성합니다. 해당 서비스 이름에만 페어링하고 ADB의 성공 응답에서 받은 기기 식별자와 일치하는 연결 서비스를 선택합니다. 검색된 다른 폰이나 같은 IP의 임의 연결 서비스에는 연결하지 않습니다. 연결 포트가 늦게 나타나거나 바뀌면 유효 시간 내에 다시 검색합니다. 이후 재연결과 저장은 기존 기기 식별자/북마크 경로를 사용합니다.

최신 Android Platform Tools와 작동하는 ADB mDNS 검색이 필요합니다. 네트워크가 검색을 막거나 시간 초과·오류가 나면 기존 6자리 코드 페어링/주소 입력을 사용할 수 있습니다. QR 대기 중에는 수동 페어링·연결 작업을 잠시 잠그며 USB 화면 보기와 기존 화면 세션은 유지합니다. 취소·완료·실패 시 QR을 제거하고 새 QR을 만들면 새 키를 사용합니다. 취소는 대기 작업을 중단하며 이미 완료한 ADB 신뢰 등록을 해제하지 않습니다.

QR 키를 앱 설정·북마크·로그에 저장하지 않습니다. ADB에는 비밀번호를 명령행 인자 대신 표준 입력으로 전달하고 원래 ADB 오류 출력은 UI에 노출하지 않습니다. Android 10 이하의 기존 연결 기능은 유지하며 QR 페어링은 지원하지 않습니다. [Android ADB Wi-Fi 구조와 QR 형식](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md), [ADB 페어링 성공 응답과 기기 식별자](https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/client/adb_wifi.cpp)를 참고합니다.

이 구현은 모의 ADB·주입 시계·합성 QR 검증만 수행했습니다. 실제 Android QR 스캐너, 네트워크 mDNS, Windows 네이티브 실행 및 장시간 검증은 하지 않았습니다.

## Wi-Fi 자동 화질 조절

Android Wi-Fi 화면 보기에서 `Wi-Fi 페어링 · 연결`의 자동 화질을 켜거나 끌 수 있습니다. 기본값은 켜짐이며 설정을 저장합니다. 사용자 설정을 상한으로 유지하면서 최대 해상도·프레임·인코더 비트레이트를 1280px/30fps/4Mbps, 720px/15fps/1.5Mbps 단계로 낮춥니다. 원본 프레임 시간 간격을 제외한 수신 지연 변동과 디코더 지연을 측정하므로 정지 화면의 낮은 프레임 수만으로 화질을 낮추지 않습니다. 연속 3개 불량 측정 구간에서 낮추고 10개 양호 구간에서 복원하며 변경 간격은 하향 15초, 상향 30초입니다. RTT나 실제 네트워크 대역폭 측정은 아닙니다.

Android 송출 설정 변경은 scrcpy 영상 세션을 다시 연결하므로 화면과 소리에 짧은 중단이 발생합니다. 녹화·일시 정지·녹화 파일 마무리·캡처 중에는 변경을 대기하고 완료 후 적용합니다. 상태 메시지에 적용 화질과 녹화 대기를 표시합니다. 자동 화질을 끄면 현재 화질을 유지하며 다음 화면 보기 시작 시 사용자 설정으로 돌아갑니다. Wi-Fi의 비트레이트는 선택한 해상도·프레임 단계에 맞춰 설정하며 USB는 기존 8Mbps와 사용자 설정을 유지합니다.

iPhone Wi-Fi는 업데이트한 Phone Mirror Sender에서 `Wi-Fi 자동 화질`을 켜고 연결 코드를 저장한 뒤 방송을 시작합니다. 송출 소켓 완료 지연이 지속되면 VideoToolbox 비트레이트를 6→3→1.5Mbps로 낮추고 안정되면 천천히 복원합니다. 해상도·프레임·소리와 녹화 시간축을 유지하며 영상 세션을 재시작하지 않습니다. 이 설정은 다음 방송부터 적용됩니다. 소켓 완료는 송출 측 압력 지표이며 수신 컴퓨터의 도착 확인이나 RTT가 아닙니다. 비트레이트는 인코더의 목표값이므로 모든 네트워크에서 무끊김을 보장하지 않습니다. iPhone USB와 기존 Swift Mac 앱은 변경하지 않습니다.

검증 범위와 TDD 기록은 [테스트 문서](TESTING.md#wi-fi-자동-화질-조절-모의-검증-2026-10-11)를 참고하세요.

## 설치 파일과 릴리즈 초안

Mac ARM64·Intel DMG와 Windows x64 NSIS 설치 프로그램을 지원합니다. `desktop-v*` 태그 워크플로는 모든 설치 파일 검증 후 GitHub Releases **초안만** 생성하며 수동 실행은 빌드만 합니다. 로컬 빌드 명령, 버전 규칙, Apple/Azure 서명 설정은 [배포 안내](RELEASING.md)를 참고하세요. 실제 공개 배포는 실행하지 않았습니다.

## 연결 문제 진단

기기 설정의 `연결 문제 진단`을 열고 Android/iPhone과 USB/Wi-Fi를 선택한 뒤 `연결 진단 시작`을 누르세요. 기기가 아직 목록에 없을 때도 사용할 수 있습니다. 선택된 기기가 있으면 해당 연결의 식별자로 점검하며, 진단 실행 중에는 진단 대상 변경과 중복 실행을 막습니다. `진단 취소`와 완료 후 `다시 진단`을 지원합니다.

- Android USB: ADB 실행 파일·실행 응답, 해당 USB 기기의 디버깅 승인/오프라인/검색 상태, 화면 전송 모듈을 확인합니다.
- Android Wi-Fi: 위 점검에 무선 디버깅 서비스 검색을 추가합니다. 선택한 기기의 주소 또는 직접 입력한 **연결 IP:포트**가 있으면 TCP 접근을 확인합니다. 입력하지 않으면 포트 점검을 생략합니다. 잘못된 주소·포트는 실행 전에 거부합니다. 페어링 포트와 연결 포트는 다르며, TCP 접근 성공만으로 페어링·화면 수신 성공을 판단하지 않습니다.
- iPhone Mac USB: 기존 네이티브 USB 캡처 기기 검색과 승인 상태를 확인하고 잠금 해제·컴퓨터 신뢰·카메라 권한·데이터 케이블 확인을 안내합니다.
- iPhone Windows USB: Apple 기기 서비스의 USB 검색 결과와 앱의 송출 수신 상태를 확인합니다. 여러 iPhone이 있으면 한 대만 연결하도록 안내합니다. 새로운 터널이나 화면 방송은 시작하지 않습니다.
- iPhone Wi-Fi: 컴퓨터의 루프백 외 네트워크 주소 존재 여부와 앱 수신기의 미실행·방송 대기·인증된 연결·오프라인 상태를 확인합니다. iPhone 방송 포트에 시험 접속하거나 새로운 수신기를 만들지 않습니다.

항목별 `점검 통과`, `문제 확인`, `확인 필요`와 해결 안내를 제공합니다. 점검별 기본 제한은 2초이며 다른 점검에 응답이 없어도 가능한 결과를 계속 표시합니다. 실제 방화벽 설정·게스트 Wi-Fi 격리·다른 장치의 네트워크·iPhone ReplayKit 권한은 자동으로 확인하지 못하므로 가능한 원인을 확정된 고장처럼 표시하지 않습니다. 진단 결과는 실행 당시의 상태입니다.

진단은 연결 종료·페어링·ADB 서버 재시작·설정 변경을 실행하지 않습니다. ADB의 `version`, `devices -l`, `mdns services`와 USB 검색을 사용하며 ADB가 실행 중이지 않으면 도구의 일반 동작으로 데몬이 시작될 수 있습니다. 영상·소리·녹화 세션은 유지합니다. 결과와 해결 안내에는 원본 도구 로그·기기 일련번호·IP 주소·연결 키·페어링 코드를 담거나 저장하지 않습니다. 직접 입력한 주소는 해당 진단 요청에서만 사용합니다.

진단 정책과 해결 안내는 Rust 서비스, 운영체제/ADB 점검은 주입 가능한 포트, 시각과 제한 시간 대기는 주입 가능한 타이머로 분리했습니다. 프론트도 도메인 입력 검증·행동 컨트롤러·Tauri IPC·표시 패널을 분리했습니다. 기존 Swift 앱과 USB·Wi-Fi 화면·소리·캡처·녹화·전체 화면·PiP 기능은 유지합니다.
