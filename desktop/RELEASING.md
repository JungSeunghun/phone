# Phone Mirror Desktop 설치 파일과 배포

이 절차는 독립 Rust/Tauri 앱을 대상으로 한다. 기존 네이티브 Swift Mac 앱과 iPhone 송출 앱은 별도 프로젝트로 유지한다. 이 작업에서는 태그를 생성하거나 푸시하지 않았으며 GitHub Releases를 만들거나 공개하지 않았다.

## 설치 파일 만들기

Node.js 22, Rust stable과 해당 플랫폼의 Tauri 빌드 도구가 필요하다. Mac은 Xcode Command Line Tools, Windows는 MSVC C++ Build Tools와 Windows SDK가 필요하다. [Tauri 준비 절차](https://v2.tauri.app/start/prerequisites/)를 참고한다.

프로젝트 루트에서 시작한다.

```sh
cd desktop
npm ci
npm run test:release
npm run release:validate
# Apple Silicon Mac에서:
rustup target add aarch64-apple-darwin
npm run package:mac
node scripts/release.mjs stage --target macos-arm64
# Intel Mac용 DMG (Mac에서 해당 Rust 타깃 설치 후):
rustup target add x86_64-apple-darwin
node scripts/release.mjs package --target macos-x64
node scripts/release.mjs stage --target macos-x64
```

Windows PowerShell에서는 다음을 실행한다.

```powershell
cd desktop
npm ci
rustup target add x86_64-pc-windows-msvc
npm run test:release
npm run package:windows
node scripts/release.mjs stage --target windows-x64
```

원본 설치 파일은 `desktop/src-tauri/target/<Rust 타깃>/release/bundle/dmg` 또는 `nsis`에 생성된다. 배포용 이름으로 정리한 파일과 메타데이터는 프로젝트 루트의 `dist/Release/stages/<타깃 ID>`에 생성된다. 프론트 빌드가 정리하는 `desktop/dist`와 분리해 다른 타깃의 준비 파일을 유지한다.

| 타깃 ID | 배포 파일 (0.1.0 예시) |
| --- | --- |
| macos-arm64 | Phone-Mirror-Desktop_0.1.0_macos-arm64.dmg |
| macos-x64 | Phone-Mirror-Desktop_0.1.0_macos-x64.dmg |
| windows-x64 | Phone-Mirror-Desktop_0.1.0_windows-x64-setup.exe |

Mac은 앱과 Applications 바로가기가 있는 DMG, Windows는 현재 사용자용 NSIS 설치 프로그램이다. 기본 `unsigned` 모드는 Mac ad-hoc 서명이며 Developer ID 서명·공증이 아니다. 다른 컴퓨터에서 보안 경고가 나타날 수 있다. 일반 사용자 배포 전에는 아래 `signed` 구성을 사용한다.

ADB는 설치 파일에 포함하지 않는다. Android 사용자는 최신 Android Platform Tools를 설치하고 앱이 찾을 수 있도록 PATH 또는 기존 ADB 설정을 준비해야 한다. Windows의 iPhone USB에는 Apple Devices의 기기 드라이버/서비스와 iPhone 송출 앱이 필요하다. Windows 설치 프로그램은 WebView2가 없으면 다운로드하는 방식이므로 해당 경우 인터넷이 필요하다. iPhone 송출 앱은 이 워크플로에서 배포하지 않는다.

## 태그 기반 GitHub Releases 초안

`.github/workflows/desktop-release.yml`은 `desktop-v*` 태그 푸시에 반응한다. 허용 형식은 `desktop-v0.2.0`, `desktop-v0.2.0-beta.1`처럼 정규 MAJOR.MINOR.PATCH와 선택적인 `alpha.N`, `beta.N`, `rc.N`이다. 버전 구성 요소는 0~65535, 사전 배포 번호는 1~9999이며 앞자리 0·빌드 메타데이터·공백은 허용하지 않는다.

태그를 만들기 **전에** 다음 값 여섯 개를 같은 버전으로 맞춘다.

- `desktop/package.json`: version
- `desktop/package-lock.json`: 최상위 version과 packages[""]의 version
- `desktop/src-tauri/tauri.conf.json`: version
- `desktop/src-tauri/Cargo.toml`: package.version
- `desktop/src-tauri/Cargo.lock`: phone-mirror-desktop 패키지의 version

이 문서는 실제 태그 생성이나 푸시를 실행하지 않는다. 향후 관리자가 버전을 맞춰 태그를 푸시하면 Mac ARM64·Mac x64 DMG와 Windows x64 NSIS를 만들고 테스트한다. Mac x64는 macos-latest에서 명시적 Rust 타깃으로 빌드하므로 Intel 기기 실행 검증과 구분해야 한다. Windows 설치 프로그램은 Windows runner에서 빌드한다.

세 빌드가 모두 성공하면 파일 크기·SHA-256·서명 모드·태그의 커밋을 검증하고 **비공개 초안(draft: true)** 에 설치 파일 3개, `SHA256SUMS.txt`, `release-manifest.json`을 올린다. 릴리즈 생성/업로드 작업에만 `contents: write`를 부여하고 나머지 작업은 읽기 권한을 사용한다. GitHub Actions 저장소 정책에서 이 권한 사용을 허용해야 한다. 별도 개인 액세스 토큰은 필요 없다.

Actions에서 수동 `Run workflow`를 실행하면 테스트와 설치 파일 생성·Actions artifact 업로드까지만 한다. 태그를 선택해 수동 실행해도 Releases는 생성하지 않는다. 워크플로에는 초안을 공개로 전환하는 작업이 없다. 공개하려면 관리자가 설치 파일과 서명을 확인한 뒤 GitHub UI에서 별도로 승인·공개해야 한다.

같은 태그를 다시 실행할 때 기존 초안의 동일한 파일은 건너뛴다. 이미 공개된 릴리즈, 다른 커밋의 초안, 이름은 같지만 해시가 다른 파일, 해시 정보가 없는 기존 파일은 수정하지 않고 실패한다. DMG 생성 시간이나 인증서 타임스탬프로 재빌드 결과가 달라질 수 있다. 이 경우 새 버전/태그를 사용하거나 관리자가 기존 초안을 직접 검토하고 충돌 파일을 처리해야 한다. 자동 삭제·덮어쓰기 기능은 없다.

## 서명 설정

저장소 Settings → Secrets and variables → Actions에서 Repository variable `DESKTOP_RELEASE_SIGNING`을 설정한다. 기본값은 `unsigned`; 실제 서명은 `signed`이다. signed는 세 플랫폼 모두 서명되도록 요구하며 자격 증명이 빠지면 빌드를 중단한다. 인증서나 개인 키를 저장소·채팅·로그에 넣지 않는다.

### Mac Developer ID와 공증

[Tauri Mac 서명 문서](https://v2.tauri.app/distribute/sign/macos/)에 따라 Apple Developer 계정의 **Developer ID Application** 인증서와 개인 키를 Keychain에서 암호화한 `.p12`로 내보내고 App Store Connect API 키를 준비한다. 다음 항목을 GitHub Actions **Secrets**에 넣는다.

| Secret | 값 |
| --- | --- |
| APPLE_CERTIFICATE | `.p12` 파일의 base64 문자열 |
| APPLE_CERTIFICATE_PASSWORD | `.p12` 내보내기 암호 |
| APPLE_SIGNING_IDENTITY | `Developer ID Application: 이름 (TEAMID)` |
| APPLE_API_ISSUER | App Store Connect API issuer ID |
| APPLE_API_KEY | API key ID |
| APPLE_API_PRIVATE_KEY_BASE64 | 해당 `.p8` 개인 키 파일의 base64 문자열 |

Mac에서 파일을 변환할 때 `base64 -i certificate.p12 | pbcopy`, `base64 -i AuthKey_KEYID.p8 | pbcopy`처럼 결과를 클립보드에 넣어 Secret 입력란에 붙여넣을 수 있다. 키 파일 경로는 본인 파일로 바꾼다. 빌드 스크립트는 `.p8`을 runner 임시 디렉터리에 0600 권한으로 저장하고 `APPLE_API_KEY_PATH`를 Tauri에 전달한다. 작업 종료 시 파일을 삭제한다. Mac 빌드에만 Apple 자격 증명을 전달하고 unsigned 빌드에는 제거한다.

Tauri가 앱 서명과 공증을 처리하고 CI가 `codesign`, `stapler validate`, `spctl`로 결과를 확인한다. 이 검증 대상은 DMG 안의 앱이며 DMG 자체의 별도 공증을 주장하지 않는다. 실제 Apple 인증서로 서명·공증한 실행 결과는 아직 검증하지 않았다.

### Windows Azure Artifact Signing

[Tauri Windows 서명 문서](https://v2.tauri.app/distribute/sign/windows/)의 Azure Artifact Signing 방식이다. Azure에 계정과 Public Trust 인증서 프로필을 만들고 신원 확인 및 서비스 주체에 필요한 인증서 프로필 서명 권한을 구성한다. 계정 제공 지역과 자격 요건은 Azure 안내를 확인한다.

GitHub Actions **Secrets**:

- `AZURE_CLIENT_ID`: 서비스 주체 애플리케이션 ID
- `AZURE_CLIENT_SECRET`: 서비스 주체 인증 정보
- `AZURE_TENANT_ID`: Azure tenant ID

GitHub Actions **Variables**:

- `WINDOWS_SIGNING_ENDPOINT`: 계정 지역 엔드포인트, 예: `https://eus.codesigning.azure.net`
- `WINDOWS_SIGNING_ACCOUNT`: Artifact Signing 계정 이름
- `WINDOWS_SIGNING_PROFILE`: 인증서 프로필 이름

CI는 .NET 8과 `artifact-signing-cli` 0.11.0을 준비하고 Tauri의 signCommand를 통해 앱 실행 파일과 NSIS 설치 프로그램을 서명한다. Windows runner의 Windows SDK 도구를 사용하며 최종 두 파일의 Authenticode 상태가 Valid인지 확인한다. Azure 자격 증명은 Windows 빌드 환경에만 전달한다. 실제 Azure 서명 실행이나 Windows 설치/실행은 이 Mac에서 검증하지 않았다. 서명만으로 SmartScreen 경고가 사라짐을 보장하지 않는다.

## 검증과 한계

배포 정책/파일 처리/GitHub API 포트는 Tauri·OS 미디어 코드와 독립적이다. 모의 API로 초안 생성·재실행·공개 릴리즈 수정 거부·취소·오류와 태그 커밋 검증을 테스트하며 테스트는 GitHub에 쓰지 않는다. API 쓰기 CLI는 GitHub Actions 태그 push 환경에서만 실행되도록 제한한다.

로컬 준비만 확인하려면 세 타깃의 stage 폴더를 모은 뒤 `node scripts/release.mjs prepare --source <폴더> --tag desktop-v0.2.0`을 사용한다. 출력은 프로젝트 루트의 `dist/Release/ready`이며 네트워크 업로드는 하지 않는다. `release-manifest.json`의 commit과 SHA256SUMS는 빌드 추적/무결성 정보로, 코드 서명을 대신하지 않는다.

실행 기록은 [TESTING.md](TESTING.md)에 기록한다. GitHub 호스팅 CI 실제 실행, Windows 네이티브 실행, iPhone 실기기, 장시간 검증은 이번 작업에 포함하지 않는다.

## 앱 내 업데이트 (0.2.0부터)

앱 설정의 **앱 업데이트**에서 현재 버전, 자동 확인 설정, 수동 확인, 다운로드 취소, **업데이트하고 다시 시작**을 제공한다. 자동 확인은 실행 시와 실행 중 24시간 간격이며 연결 중 정기 확인은 대기한다. 설치는 사용자의 버튼 동작으로 시작하고, 활성 미러링·녹화·파일 저장·아직 끝나지 않은 기기 작업이 있으면 네이티브 계층에서도 거부한다. 다운로드는 512 MiB로 제한하고 HTTPS·공개 키 서명·서명에 포함된 버전을 확인한다. 앱 종료 시 기존 녹화 저장 흐름은 유지한다.

0.2.2부터 공식 업데이트 주소는 `https://github.com/JungSeunghun/phone-mirror/releases/latest/download/latest.json`이다. 새 앱은 이 주소를 기본값으로 사용하며 기존 사용자 지정 주소는 유지한다. 0.2.0에서는 **업데이트 배포 주소**에 이 주소를 직접 저장한다. 정식 릴리스와 `latest.json`이 공개되어 있어야 작동하며, 기존 공개 키로 서명된 파일만 설치할 수 있다. 초안의 모든 파일을 검증한 뒤 릴리스를 공개하고 최신 릴리스로 지정한다.

업데이트 서명 개인 키는 이 Mac의 `~/.config/phone-mirror/updater-signing.key`에 권한 600으로 생성했고, 공개 키는 `desktop/src-tauri/tauri.conf.json`에 포함했다. 개인 키는 저장소 밖에 유지하고 별도로 안전하게 백업한다. 키가 바뀌면 기존 설치 앱은 새 키의 업데이트를 받을 수 없으므로 기존 키를 유지하거나 기존 키로 키 교체 버전을 배포해야 한다. OS 코드 서명·Apple 공증과 업데이트 서명은 서로 별개다.

로컬에서 서명 업데이트 파일을 만들 때:

```sh
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.config/phone-mirror/updater-signing.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=''
cd desktop
node scripts/release.mjs package --target macos-arm64
node scripts/release.mjs stage --target macos-arm64
```

개인 키를 지정하면 Mac `.app.tar.gz`와 Windows NSIS `.exe`에 `.sig`를 함께 만든다. 키가 없는 개발 패키지는 일반 설치 프로그램만 만든다. GitHub Actions에는 `TAURI_SIGNING_PRIVATE_KEY`(키 파일 내용), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`를 secrets로 등록한다. ARM Mac·Intel Mac·Windows의 서명 업데이트가 모두 준비되면 기존 초안 배포 흐름은 `latest.json`과 3개 파일·서명을 추가한다. 부분적으로 준비된 업데이트는 실패한다. CLI `prepare`에는 HTTPS `DESKTOP_UPDATE_ASSET_BASE_URL`을 지정하며, 태그 워크플로는 해당 태그의 GitHub 다운로드 경로를 사용한다. 초안은 자동 공개하지 않는다.

최초 서버 연결 시 3개 플랫폼 파일과 `.sig`를 공개하고, `latest.json`을 앱에 등록한 고정 HTTPS 주소에 제공한다. GitHub라면 `https://github.com/OWNER/REPO/releases/latest/download/latest.json`을 사용할 수 있다. 미리보기 버전은 정식 앱의 자동 업데이트 대상으로 허용하지 않는다. Rust 최소 버전은 업데이트 플러그인에 맞춰 1.90으로 올렸다.

GitHub의 `releases/latest/download/latest.json` 주소를 사용할 때는 검토한 공개 정식 릴리스가 해당 주소에 연결되도록 최신 릴리스 설정도 확인한다. 버전별 다운로드 주소는 매니페스트 내부 파일 URL에 사용하고, 앱에는 새 매니페스트를 따라갈 수 있는 고정 주소를 등록한다.

## 0.2.2 배포 범위

업데이트 서명은 기존 Phone Mirror 키를 유지한다. 현재 OS 코드 서명 모드는 `unsigned`이므로 Mac은 ad-hoc 서명·미공증, Windows는 게시자 코드 서명이 없는 개발용 설치 파일이다. 업데이트 서명 검증과 Apple 공증·Windows Authenticode는 별개다. 이 상태를 릴리스 설명과 manifest에 표시한다. 일반 사용자용 OS 신뢰 배포에는 위 Developer ID·Azure 서명 설정을 별도로 완료해야 한다. 라이선스 고지와 고정 의존성 소스 링크는 앱의 `licenses/runtime` 리소스에 포함한다.

## 저장소 이름 변경

저장소 이름은 `phone`에서 `phone-mirror`로 변경했다. 현재 공식 주소는 `https://github.com/JungSeunghun/phone-mirror/releases/latest/download/latest.json`이다. 기존 0.2.2 앱과 저장된 이전 주소는 GitHub 리다이렉트를 사용하며, 다음 빌드부터 새 주소를 기본값으로 사용한다. 기존 사용자 지정 주소를 덮어쓰지 않는다. 이전 `phone` 이름으로 새 저장소를 만들면 리다이렉트가 끊기므로 재사용하지 않는다. 기존 릴리스 파일, 앱 식별자와 업데이트 서명 키는 유지한다.
