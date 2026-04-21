import React from "react";
import ReactDOM from "react-dom/client";
import "./canvas.css";
import { CanvasRoot } from "../pages/canvas/CanvasApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CanvasRoot/>
  </React.StrictMode>
);
