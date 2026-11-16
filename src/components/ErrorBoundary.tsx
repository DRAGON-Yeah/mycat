import { Component, type ErrorInfo, type ReactNode } from "react";
import { writeLog } from "../features/connections/sessionApi";

type Props = { children: ReactNode };
type State = { error: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void writeLog(
      "ERROR",
      `ui_crash: ${error.message} | ${info.componentStack ?? ""}`,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h1>界面异常</h1>
          <p>{this.state.error}</p>
          <p>详情已写入本地日志。可尝试刷新或重启应用。</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
