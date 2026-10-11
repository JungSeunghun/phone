import { useMemo } from "react";
import { createConnectionCodeQr } from "../infrastructure/ConnectionCodeQr";
export function ConnectionCodeQr({
  code,
  index,
}: {
  code: string;
  index: number;
}) {
  const image = useMemo(() => {
    try {
      return createConnectionCodeQr(code);
    } catch {
      return undefined;
    }
  }, [code]);
  return image ? (
    <figure className="connection-code-qr">
      <img
        src={image}
        width={256}
        height={256}
        alt={`iPhone 연결 QR 코드 ${index}`}
      />
      <figcaption>iPhone 송출 앱에서 ‘QR 코드 스캔’을 누르세요.</figcaption>
    </figure>
  ) : (
    <p className="hint">
      QR 코드를 만들 수 없습니다. 연결 코드를 직접 입력하거나 수신을 다시
      시작하세요.
    </p>
  );
}
