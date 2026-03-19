import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold text-warm-text mb-2">Something went wrong</h2>
            <p className="text-sm text-warm-text-secondary mb-4">
              An unexpected error occurred while rendering this page.
            </p>
            <p className="text-xs text-warm-text-secondary font-mono bg-warm-sidebar rounded-btn p-3 mb-4 text-left break-all">
              {this.state.error?.message}
            </p>
            <button
              className="px-4 py-2 text-sm bg-brand text-white rounded-btn hover:bg-brand/90 transition-colors"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
