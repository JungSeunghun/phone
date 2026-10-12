import { useTranslation } from "./ApplicationLanguage";
import { useSyncExternalStore } from "react";
import type { PhoneMirrorController } from "../application/PhoneMirrorController";
import type { AndroidQrPairingController } from "../application/AndroidQrPairingController";
import { AndroidQrPairingPanel } from "./AndroidQrPairingPanel";
export function AndroidWirelessConnectionPanel({
  controller,
  pairingController,
  pairingBusy,
}: {
  controller: PhoneMirrorController;
  pairingController: AndroidQrPairingController;
  pairingBusy: boolean;
}) {
  const translate = useTranslation();

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  return (
    <details className="wireless-panel">
      <summary>{translate("Android Wi-Fi 연결")}</summary>
      <AndroidQrPairingPanel
        controller={pairingController}
        disabled={state.wirelessBusy || pairingBusy}
      />
      <details className="manual-connection">
        <summary>{translate("코드·주소로 연결")}</summary>
        <p className="hint">
          {" "}
          {translate(
            "Android 개발자 옵션 → 무선 디버깅 → 페어링 코드로 기기 페어링을 여세요.",
          )}{" "}
        </p>
        <button
          className="secondary"
          disabled={state.wirelessBusy || pairingBusy}
          onClick={() => void controller.refreshServices()}
        >
          {" "}
          {translate("무선 기기 검색")}{" "}
        </button>
        <div className="service-list">
          {state.services.map((service) => (
            <button
              key={[service.kind, service.name, service.address].join(":")}
              disabled={state.wirelessBusy || pairingBusy}
              className="service"
              onClick={() => controller.selectService(service)}
            >
              <span>
                {service.kind === "pairing"
                  ? translate("페어링")
                  : translate("연결")}{" "}
                · {service.name}
              </span>
              <small>{service.address}</small>
            </button>
          ))}
        </div>
        <label>
          {" "}
          {translate("페어링 주소")}{" "}
          <input
            aria-label={translate("페어링 주소")}
            value={state.pairingAddress}
            placeholder="192.168.0.12:37123"
            maxLength={128}
            disabled={state.wirelessBusy || pairingBusy}
            onChange={(event) =>
              controller.setPairingAddress(event.target.value)
            }
          />
        </label>
        <label>
          {" "}
          {translate("6자리 페어링 코드")}{" "}
          <input
            aria-label={translate("6자리 페어링 코드")}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={state.pairingCode}
            maxLength={6}
            disabled={state.wirelessBusy || pairingBusy}
            onChange={(event) => controller.setPairingCode(event.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={!state.canPair || pairingBusy}
          onClick={() => void controller.pair()}
        >
          {" "}
          {translate("페어링")}{" "}
        </button>
        <label>
          {" "}
          {translate("연결 주소")}{" "}
          <input
            aria-label={translate("연결 주소")}
            value={state.connectionAddress}
            placeholder={translate("폰의 무선 디버깅 연결 IP:포트")}
            maxLength={128}
            disabled={state.wirelessBusy || pairingBusy}
            onChange={(event) =>
              controller.setConnectionAddress(event.target.value)
            }
          />
        </label>
        <button
          className="secondary"
          disabled={!state.canConnect || pairingBusy}
          onClick={() => void controller.connect()}
        >
          {" "}
          {translate("Wi-Fi 연결")}{" "}
        </button>
        <p role="status" className="hint">
          {translate(state.wirelessMessage)}
        </p>
      </details>
    </details>
  );
}
