import { useTranslation } from "./ApplicationLanguage";
import { useState } from "react";
const paths = {
  "android-usb": [
    "데이터 USB 케이블로 폰과 컴퓨터를 연결하세요.",
    "폰의 개발자 옵션에서 USB 디버깅을 켜고 컴퓨터 연결을 승인하세요.",
    "USB 기기를 선택하고 ‘폰 화면 보기’를 누르세요.",
  ],
  "android-wifi": [
    "폰과 컴퓨터를 같은 네트워크에 연결하세요.",
    "Android 11 이상에서 무선 디버깅을 켜고 Android Wi-Fi 연결에서 QR 또는 코드로 페어링하세요.",
    "연결된 기기에서 폰을 선택하고 ‘폰 화면 보기’를 누르세요.",
  ],
  "ios-usb": [
    "iPhone 잠금을 해제하고 USB를 연결한 뒤 ‘이 컴퓨터를 신뢰’를 승인하세요.",
    "Mac USB는 컴퓨터의 카메라 권한이 필요합니다. Windows USB는 Apple 기기 드라이버와 iPhone 송출 앱의 화면 방송을 사용합니다.",
    "USB 기기를 선택하고 ‘폰 화면 보기’를 누르세요.",
  ],
  "ios-wifi": [
    "iPhone과 컴퓨터를 같은 네트워크에 연결하세요.",
    "컴퓨터에서 iPhone Wi-Fi 수신을 시작하고 송출 앱에 연결 QR을 저장한 뒤 화면 방송을 시작하세요.",
    "연결된 기기에서 iPhone을 선택하고 ‘폰 화면 보기’를 누르세요.",
  ],
} as const;
export function FirstConnectionGuide() {
  const translate = useTranslation();

  const [path, setPath] = useState<keyof typeof paths>("android-usb");
  return (
    <details className="first-connection-guide">
      <summary>{translate("처음 연결하기")}</summary>
      <label>
        {" "}
        {translate("처음 연결할 방식")}{" "}
        <select
          aria-label={translate("처음 연결할 방식")}
          value={path}
          onChange={(event) => {
            if (event.target.value in paths)
              setPath(event.target.value as keyof typeof paths);
          }}
        >
          <option value="android-usb">Android USB</option>
          <option value="android-wifi">Android Wi-Fi</option>
          <option value="ios-usb">iPhone USB</option>
          <option value="ios-wifi">iPhone Wi-Fi</option>
        </select>
      </label>
      <ol>
        {paths[path].map((step) => (
          <li key={translate(step)}>{translate(step)}</li>
        ))}
      </ol>
      {path === "android-wifi" && (
        <p className="hint">
          {translate(
            "코드로 페어링했다면 연결 주소로 연결하세요. 페어링 포트와 연결 포트는 다릅니다.",
          )}
        </p>
      )}
      {path.startsWith("ios-") && (
        <>
          <p className="hint">
            {translate(
              "다국어 입력은 ‘iPhone 다국어 입력 연결’에서 별도로 설정하세요. Phone Mirror 키보드의 ‘전체 접근 허용’이 필요합니다.",
            )}
          </p>
          <p className="hint">
            {translate("iPhone 실기기 검증은 아직 완료하지 않았습니다.")}
          </p>
        </>
      )}
      <p className="hint">
        {" "}
        {translate("연결되지 않으면 ‘연결 문제 진단’을 실행하세요.")}{" "}
      </p>
    </details>
  );
}
