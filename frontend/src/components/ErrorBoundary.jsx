import { Component } from "react";

/**
 * ErrorBoundary — catches render/lifecycle errors in any child subtree.
 *
 * Usage (page-level, keeps sidebar alive):
 *   <ErrorBoundary label="Dashboard">
 *     <Dashboard />
 *   </ErrorBoundary>
 *
 * Usage (app-level, last-resort catch-all):
 *   <ErrorBoundary label="App" fullPage>
 *     <App />
 *   </ErrorBoundary>
 *
 * Props
 *   label    — friendly name shown in the error card (default: "This section")
 *   fullPage — when true, the fallback fills the whole viewport instead of
 *              fitting inside the main-content column
 *   children — the subtree to protect
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Log to console so it's still visible in DevTools
    console.error("[ErrorBoundary] Uncaught error:", error, info?.componentStack);
  }

  reset() {
    this.setState({ hasError: false, error: null, info: null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { label = "This section", fullPage } = this.props;
    const message = this.state.error?.message || String(this.state.error);

    const containerStyle = fullPage
      ? {
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: "100vh", background: "#0d0f1a", padding: 24,
        }
      : {
          display: "flex", alignItems: "center", justifyContent: "center",
          minHeight: 320, padding: 24,
        };

    return (
      <div style={containerStyle}>
        <div style={{
          background: "#13152a",
          border: "1px solid #7f1d1d",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 520,
          width: "100%",
          boxShadow: "0 4px 24px #0007",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 22 }}>💥</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fca5a5" }}>
              {label} crashed
            </span>
          </div>

          {/* Error message */}
          <div style={{
            background: "#0d0f1a", borderRadius: 8, padding: "10px 14px",
            fontFamily: "monospace", fontSize: 12, color: "#f87171",
            marginBottom: 18, wordBreak: "break-word", lineHeight: 1.6,
            maxHeight: 120, overflowY: "auto",
            border: "1px solid #7f1d1d44",
          }}>
            {message}
          </div>

          {/* Help text */}
          <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
            An unexpected error occurred. You can try resetting this section, or
            reload the page to start fresh. If the error keeps happening, check
            the browser console for more details.
          </p>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={this.reset}
              style={{
                padding: "8px 16px", borderRadius: 7, border: "none",
                background: "#6d28d9", color: "#fff", fontSize: 13,
                fontWeight: 600, cursor: "pointer",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "#7c3aed"}
              onMouseLeave={e => e.currentTarget.style.background = "#6d28d9"}
            >
              🔄 Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "8px 16px", borderRadius: 7,
                border: "1px solid #374151", background: "#1e2130",
                color: "#94a3b8", fontSize: 13, cursor: "pointer",
              }}
              onMouseEnter={e => e.currentTarget.style.color = "#e2e8f0"}
              onMouseLeave={e => e.currentTarget.style.color = "#94a3b8"}
            >
              ↺ Reload page
            </button>
          </div>

          {/* Stack trace toggle */}
          {this.state.info?.componentStack && (
            <details style={{ marginTop: 18 }}>
              <summary style={{
                color: "#475569", fontSize: 11, cursor: "pointer",
                userSelect: "none", fontFamily: "monospace",
              }}>
                Component stack
              </summary>
              <pre style={{
                marginTop: 8, padding: "8px 10px",
                background: "#0d0f1a", borderRadius: 6,
                fontSize: 10, color: "#475569", lineHeight: 1.5,
                overflowX: "auto", maxHeight: 160, overflowY: "auto",
                border: "1px solid #1e293b",
              }}>
                {this.state.info.componentStack}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
