/// <reference types="vite/client" />

import type { ArctisBridgeApi } from "@shared/ipc";

declare global {
  interface Window {
    arctisBridge: ArctisBridgeApi;
    api: ArctisBridgeApi;
  }
}

export {};
