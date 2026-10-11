# Phone Mirror Wi-Fi v1

수신 구현은 `desktop/src-tauri/src/ios_wifi.rs`, 송출 구현은 `ios/Shared`입니다. Tauri·React와 분리된 프로토콜이며 로컬 TCP로 H.264 Annex B와 48kHz stereo signed Int16 little-endian PCM을 전달합니다. AES-GCM 인증 전에 기기를 등록하거나 미디어를 처리하지 않습니다.

연결 코드: `PMW1|IPv4:port|64자리 hex 키`. 송출 입력은 `[IPv6]:port`도 검증하지만 현재 데스크톱 수신기는 IPv4 인터페이스만 엽니다. 주소는 IP 리터럴, 포트는 ASCII 숫자 1–65535입니다. 수신기는 명시적으로 시작할 때 임의 포트와 임시 32바이트 키를 만듭니다. 네트워크 장치마다 같은 포트/키의 코드를 표시합니다.

서버 greeting 20바이트: ASCII `PMW1` + 임의 16바이트 challenge. HKDF-SHA256(secret, salt=challenge, info=UTF8 `PhoneMirrorWiFi/v1`, 32바이트)로 세션 키를 만듭니다. AES-256-GCM nonce는 0 네 바이트 + counter의 u64 big-endian입니다. counter는 연결마다 0에서 시작하고 정확히 1씩 증가합니다. 연결별 challenge로 과거 연결 패킷의 재사용을 거부합니다. 연결 키를 가진 클라이언트만 유효한 콘텐츠를 만들 수 있으며 greeting 변경도 인증 실패로 이어집니다.

암호화 프레임:

| 필드 | 크기 | 의미 |
|---|---:|---|
| body length | 4 | big-endian, 25–4MiB+25 |
| counter | 8 | big-endian, 순서가 정확히 맞아야 함 |
| ciphertext | 가변 | AES-GCM 암호화한 `kind 한 바이트 + payload` |
| tag | 16 | AES-GCM 인증 태그 |

AAD는 length+counter 12바이트입니다. nonce는 전송하지 않습니다. payload는 최대 4MiB입니다. 종류: 1 hello JSON, 2 video, 3 audio, 4 빈 heartbeat. hello는 최초 한 번, 버전 1·UUID `deviceId`·1–80자 `name`·boolean `audio`로 제한합니다. 알 수 없는 JSON 필드는 거부합니다. hello JSON 최대 512바이트, 최초 wire body 최대 1024바이트, 인증 제한 5초, 다음 패킷 응답 제한 6초, heartbeat 1초입니다.

Video/audio payload는 기존 scrcpy 호환 inner header 12바이트: timestamp u64 BE(µs, bit62 configuration, bit61 keyframe) + payload length u32 BE + body입니다. 영상은 SPS/PPS configuration 후 증가하는 PTS의 Annex B 패킷입니다. configuration 최대 64KiB이며 SPS와 PPS 모두 있어야 합니다. 오디오는 flags 없이 4–4096바이트, 4의 배수인 PCM body이며 증가하는 PTS여야 합니다. 오디오가 비활성인 hello에서는 audio 패킷을 거부합니다.

수신기의 동시 인증 대기 연결은 최대 4개입니다. 수신 코드당 기기 UUID 하나만 페어링하며 활성 연결 중 중복 송출·다른 UUID는 거부합니다. 종료된 송출은 offline으로 표시하고 같은 UUID의 재접속을 허용합니다. 수신 종료 시 페어링과 키를 제거합니다. 기기 identity는 `ios-wifi:{UUID}`, selection ID는 `wifi:ios-wifi:{UUID}`입니다. 기기 UUID는 송출 앱 설치별 식별자이며 하드웨어 UDID가 아닙니다.

보기 구독은 연결당 한 개, SPS/PPS를 캐시해 새 보기에 전달합니다. 구독이 없으면 압축 프레임·소리를 쌓지 않습니다. 구독 큐는 32패킷 및 4MiB 둘 다 제한합니다. 큐 초과는 연결을 종료해 다음 연결의 새 configuration/keyframe으로 복구합니다. 송출기 전송 대기열도 4MiB로 제한하며 압축 참조 프레임을 임의로 폐기하지 않습니다. 느린 네트워크·디코더에서 무끊김을 보장하는 프로토콜은 아닙니다.
