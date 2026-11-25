// SPDX-FileCopyrightText: Assault Consulting
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { syncShellText } from "./i18n/shell";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  // Fail loudly rather than rendering into nothing. A blank window with no
  // console message is the least debuggable state this application has.
  throw new Error("mount point #root not found in index.html");
}

// The native dialogs speak the window's language too (L-05).
syncShellText();

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
