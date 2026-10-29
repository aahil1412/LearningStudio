import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./studio-fonts.css";
import "katex/dist/katex.min.css";
import "./styles.css";
import "./accessibility.css";
import "./v21.css";
import "./studio-redesign.css";
import "./learning-studio.css";
class RecoveryBoundary extends React.Component<
  React.PropsWithChildren,
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message.replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 500)
          : "The workspace view could not be displayed.",
    };
  }
  render() {
    return this.state.error ? (
      <main className="workspace-recovery" role="alert">
        <h1>Reopen your saved workspace</h1>
        <p>
          A view could not be displayed. Your SQLite library remains on this
          device.
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Reopen workspace
        </button>
        <details>
          <summary>Technical details</summary>
          <pre>{this.state.error}</pre>
        </details>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RecoveryBoundary>
      <App />
    </RecoveryBoundary>
  </React.StrictMode>,
);
