import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Avoid crashing the whole app on WebGL / loader errors.
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="w-full h-full flex items-center justify-center rounded-2xl bg-gradient-to-br from-destructive/5 to-background">
            <div className="px-6 py-4 text-center">
              <p className="text-sm font-medium text-foreground">3D渲染异常，已自动降级</p>
              <p className="mt-1 text-xs text-muted-foreground">请刷新页面或稍后重试</p>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
