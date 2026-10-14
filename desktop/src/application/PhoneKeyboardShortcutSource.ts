export interface PhoneKeyboardShortcutSource {
  subscribe(listener: (generation: number) => void): Promise<{
    handlesShortcuts: boolean;
    dispose(): void;
  }>;
  setFocus(generation: number, active: boolean): Promise<void>;
}
