import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  translate,
  type ApplicationLanguage,
} from "../domain/ApplicationLanguage";
import type { ApplicationLanguageController } from "../application/ApplicationLanguageController";
const LanguageContext = createContext<ApplicationLanguage>("ko");
export function ApplicationLanguageProvider({
  controller,
  children,
}: {
  controller: ApplicationLanguageController;
  children: ReactNode;
}) {
  const { language } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <LanguageContext.Provider value={language}>
      {children}
    </LanguageContext.Provider>
  );
}
export function useTranslation() {
  const language = useContext(LanguageContext);
  return (text: string) => translate(language, text);
}
export function ApplicationLanguageSetting({
  controller,
}: {
  controller: ApplicationLanguageController;
}) {
  const { language, saveFailed } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const translate = useTranslation();
  return (
    <section aria-label={translate("언어 설정")}>
      <label className="setting">
        {translate("언어")}
        <select
          aria-label="언어 / Language"
          value={language}
          onChange={(event) => controller.select(event.target.value)}
        >
          <option value="ko" lang="ko">
            한국어
          </option>
          <option value="en" lang="en">
            English
          </option>
        </select>
      </label>
      {saveFailed && (
        <p role="status">
          {translate("설정을 저장하지 못했습니다. 이번 실행에만 적용합니다.")}
        </p>
      )}
    </section>
  );
}
