import type { ApplicationLanguageStorage } from "../application/ApplicationLanguageController";
import type { ApplicationLanguage } from "../domain/ApplicationLanguage";
export class BrowserApplicationLanguageStorage implements ApplicationLanguageStorage {
  static readonly key = "phoneMirror.applicationLanguage.v1";
  load(): unknown {
    return localStorage.getItem(BrowserApplicationLanguageStorage.key);
  }
  save(language: ApplicationLanguage): void {
    localStorage.setItem(BrowserApplicationLanguageStorage.key, language);
  }
}
