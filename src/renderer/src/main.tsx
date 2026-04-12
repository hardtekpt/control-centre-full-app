import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tailwind.css";
import "./styles/base.scss";
import "./styles/tokens.scss";
import "./styles/components.scss";

// Apply theme immediately before React renders to prevent FOUC.
// Reads the value persisted by the theme effect in store.ts; falls back to
// the system preference so the first paint is always correct.
(function applyInitialTheme() {
  const saved = localStorage.getItem("cc-theme-dark");
  const isDark = saved !== null ? saved === "1" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
})();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
