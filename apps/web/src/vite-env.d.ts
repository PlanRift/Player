/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NAVIDROME_URL?: string;
  readonly VITE_NAVIDROME_USER?: string;
  readonly VITE_NAVIDROME_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
