import "@/assets/globals.css";
import "@/lib/i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import { ApiProvider } from "@/api";
import { createBrowserApi, connectWebSocket } from "./api";
import { BootstrapApp } from "@/bootstrap-app";

const api = createBrowserApi();
connectWebSocket();

// Shim window.* globals so shared components (written for Electron preload)
// work in the browser without changing every file.
Object.assign(window, {
  appInfo: api.appInfo,
  db: api.db,
  dialog: api.dialog,
  folder: api.folder,
  image: api.image,
  category: api.category,
  nai: api.nai,
  promptBuilder: api.promptBuilder,
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ApiProvider value={api}>
      <BootstrapApp />
    </ApiProvider>
  </React.StrictMode>,
);
