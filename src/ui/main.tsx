import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

try {
  const theme = localStorage.getItem("ccdesk-theme");
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const size = localStorage.getItem("ccdesk-text-size");
  if (size === "smaller" || size === "larger") document.documentElement.dataset.textSize = size;
} catch {
  // Storage blocked: follow the system theme, at the default text size.
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
