/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GRAFANA_URL?: string
  /** Set at `vite build` time (CI sha, VITE_BUILD_ID, or ISO timestamp). */
  readonly VITE_BUILD_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
