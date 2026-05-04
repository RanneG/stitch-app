/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STITCH_RAG_USE_PROXY?: string;
  readonly VITE_STITCH_RAG_BRIDGE_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
