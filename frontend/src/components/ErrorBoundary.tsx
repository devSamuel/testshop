import { Button, Container } from "@mantine/core";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./ErrorState";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Container size="sm" py="xl">
          <ErrorState title="This page crashed" error={this.state.error} />
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
        </Container>
      );
    }
    return this.props.children;
  }
}
