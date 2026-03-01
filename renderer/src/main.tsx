import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/base.scss";
import "./styles/tokens.scss";
import "./styles/components.scss";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
