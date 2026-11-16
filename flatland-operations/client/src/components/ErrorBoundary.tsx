import { Component, type ReactNode } from "react";

/** Catches unexpected rendering errors so users see a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[ui] unexpected error", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth-page">
        <div className="card auth-card">
          <div className="card-body stack">
            <h1 style={{ fontSize: 20 }}>Something went wrong on this screen</h1>
            <p className="muted">Your saved data is safe. Reload the page to continue. If this keeps happening, tell your manager what you were doing.</p>
            <button className="btn primary lg" onClick={() => window.location.assign("/")}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
