import { createRoot } from "react-dom/client";
import { PhoneMirrorController } from "./application/PhoneMirrorController";
import {
  TauriPhoneMirrorBackend,
  LocalSettingsStorage,
} from "./infrastructure/TauriPhoneMirrorBackend";
import { PhoneMirrorApp } from "./presentation/PhoneMirrorApp";
import "./presentation/styles.css";
const controller = new PhoneMirrorController(
  new TauriPhoneMirrorBackend(),
  new LocalSettingsStorage(),
);
createRoot(document.getElementById("root")!).render(
  <PhoneMirrorApp controller={controller} />,
);
