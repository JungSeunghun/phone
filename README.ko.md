# Phone Mirror

[English](README.md) · [기여 안내](CONTRIBUTING.md) · [지원·검증 표](docs/SUPPORT.md)

Android와 iPhone 화면을 컴퓨터 앱 안에서 보고, 캡처·녹화·다국어 입력을 사용하는 프로젝트입니다.

기본 앱은 `desktop/`의 **Rust + Tauri + React** 앱이며 macOS와 Windows를 대상으로 합니다. 기존 Swift macOS 앱은 보존하고 [별도 문서](docs/SWIFT_APP.ko.md)로 구분했습니다. iPhone 송출 앱과 키보드 확장은 `ios/`에 있습니다.

## 주요 기능과 검증 상태

Android USB·Wi-Fi 연결, QR·코드 페어링, 자동 재연결, 마우스 조작, 오디오 재생·녹화, 다국어 붙여넣기와 조합 확정 후 직접 입력을 제공합니다. 녹화·일시정지 중 PNG 캡처, MP4 저장, 전체 화면·PiP도 지원합니다.

iPhone 수신과 암호화된 키보드 입력 경로를 구현했지만 **iPhone 실기기 검증은 아직 하지 않았습니다.** OS·연결 방식별 차이와 검증 증거는 [지원 표](docs/SUPPORT.md)를 확인하세요. 데스크톱·Swift macOS·iPhone 송출 앱 UI는 한국어와 영어를 지원합니다. 설정의 **언어 / Language**에서 **한국어** 또는 **English**를 선택하면 즉시 적용되고 재실행 후에도 유지됩니다.

## 실행

Node.js 22, Rust 1.90 이상과 [Tauri 플랫폼 빌드 도구](https://v2.tauri.app/start/prerequisites/)가 필요합니다. Android 사용 시 Platform Tools 전체 폴더를 설치하고 `adb`가 PATH에서 검색되게 하세요.

```sh
cd desktop
npm ci
npm run tauri dev
```

macOS는 14 이상이 필요하며 빌드에는 Xcode Command Line Tools를 사용합니다. Windows 빌드에는 MSVC·Windows SDK, 실행에는 WebView2가 필요합니다. [상세 실행·빌드 안내](desktop/README.md), [iPhone 설정](ios/README.md), [설치 파일·업데이트 배포](desktop/RELEASING.md)를 참고하세요. 공개 설치 파일 배포는 아직 준비 단계입니다.

## 처음 연결하기

- **Android USB:** 데이터 케이블 연결 → USB 디버깅 설정 → 폰에서 컴퓨터 승인 → USB 기기 선택 → **폰 화면 보기**.
- **Android Wi-Fi:** 같은 네트워크 → Android 11 이상 무선 디버깅 → **Android Wi-Fi 연결**에서 QR·코드 페어링 → 연결 포트로 연결. 페어링 포트와 연결 포트는 다릅니다.
- **iPhone:** Mac USB는 잠금 해제·컴퓨터 신뢰·카메라 권한이 필요합니다. Windows USB와 Wi-Fi는 iPhone 송출 앱의 화면 방송을 사용합니다. 다국어 입력은 PhoneMirror 키보드 확장과 전체 접근 설정도 필요합니다.

앱의 **처음 연결하기** 안내에서 연결별 단계를 확인할 수 있습니다. 저장된 기기를 앱 실행 시 자동으로 미러링하지 않습니다.

## 문제 신고와 개인정보

**연결 문제 진단 → 진단 요약 저장**에서 JSON을 저장하고 내용을 확인한 뒤 이슈에 첨부하세요. 정해진 점검 코드·결과·폰 종류·연결 방식만 내보내며 네이티브 앱은 앱 버전도 추가합니다. IP·기기 식별자·입력 내용·원본 로그·화면은 포함하지 않습니다.

실제 폰 화면·녹화·연결 코드·클립보드 내용을 공개 이슈에 올리지 마세요. 보안 문제는 [보안 신고 안내](SECURITY.md)를 사용하세요. 앱의 자동 업데이트는 서명된 파일만 설치하며, 공식 배포 주소는 아직 연결하지 않았습니다.

## 기여와 라이선스

[기여 안내](CONTRIBUTING.md), [구조 설명](docs/ARCHITECTURE.md), [개선 계획](docs/ROADMAP.md), [검증 기록](desktop/TESTING.md)을 제공합니다. 프로젝트 자체 코드는 [MIT](LICENSE), 외부 코드와 라이브러리는 각각의 원래 라이선스를 따릅니다. [외부 라이선스 고지](THIRD_PARTY_NOTICES.md)를 유지합니다.
