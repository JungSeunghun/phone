import {
  validApplicationLanguage,
  type ApplicationLanguage,
} from "../domain/ApplicationLanguage";
export interface ApplicationLanguageStorage {
  load(): unknown;
  save(language: ApplicationLanguage): void;
}
export class ApplicationLanguageController {
  private snapshot: { language: ApplicationLanguage; saveFailed: boolean } = {
    language: "ko",
    saveFailed: false,
  };
  private listeners = new Set<() => void>();
  constructor(private storage?: ApplicationLanguageStorage) {
    try {
      const saved = storage?.load();
      if (validApplicationLanguage(saved)) this.snapshot.language = saved;
    } catch {
      /* Missing or corrupt preferences retain Korean. */
    }
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  select(value: unknown): void {
    if (!validApplicationLanguage(value) || value === this.snapshot.language)
      return;
    let saveFailed = false;
    try {
      this.storage?.save(value);
    } catch {
      saveFailed = true;
    }
    this.snapshot = { language: value, saveFailed };
    this.listeners.forEach((listener) => listener());
  }
}
