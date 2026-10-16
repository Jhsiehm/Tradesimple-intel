import { Component, type ErrorInfo, type ReactNode } from "react";
import { needsPageReload } from "./loadFailure";
import "./boundary.css";

type Props = {
  /** What failed, shown as "<name> failed". */
  name: string;
  /** Changing this clears a caught error, e.g. when the user switches section. */
  resetKey?: string;
  children: ReactNode;
};

type State = { error: Error | null; key?: string };

/** Keeps one broken stage (MapLibre, a lazy board) from blanking the whole terminal. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { key: props.resetKey, error: null } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const reload = needsPageReload(error);
    return (
      <div className="boundary" role="alert">
        <p>
          <strong>{this.props.name} failed</strong>
          <span title={error.message}>
            {reload
              ? "This view's files could not load. Reload the app to fetch a fresh copy."
              : error.message || String(error)}
          </span>
          <button
            className="ghost"
            onClick={() => (reload ? window.location.reload() : this.setState({ error: null }))}
          >
            {reload ? "Reload app" : "Retry"}
          </button>
        </p>
      </div>
    );
  }
}
