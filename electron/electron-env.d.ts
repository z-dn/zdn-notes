/// <reference types="vite-electron-plugin/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    ELECTRON_RENDERER_URL?: string
  }
}
