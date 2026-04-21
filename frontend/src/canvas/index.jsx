import React from "react";
import ReactDOM from "react-dom/client";
import "./canvas.css";
import { CanvasRoot } from "../pages/canvas/CanvasApp.jsx";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary label="Canvas" fullPage>
      <CanvasRoot/>
    </ErrorBoundary>
  </React.StrictMode>
);
