/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO?: string;
  readonly VITE_TERMINAL_COLORS?: string;
  readonly VITE_MATERIAL_OVERVIEW?: string;
  readonly VITE_CHROMATIC_MAP?: string;
  readonly VITE_HISTORY_PREVIEW?: string;
  readonly VITE_BASE?: string;
  /** Absolute URL of the published demo (e.g. https://jhsiehm.github.io/Tradesimple-intel/); share links use it when set. */
  readonly VITE_PUBLIC_URL?: string;
}
