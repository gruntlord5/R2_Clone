import React, { Component, ReactNode, ErrorInfo } from 'react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  resetKeys?: Array<string | number>;
  onReset?: () => void;
  isolate?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorCount: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState(prevState => ({
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));
  }

  componentDidUpdate(prevProps: Props) {
    const { resetKeys } = this.props;
    const { hasError } = this.state;
    
    if (hasError && prevProps.resetKeys !== resetKeys) {
      this.resetError();
    }
  }

  resetError = () => {
    const { onReset } = this.props;
    
    if (onReset) {
      onReset();
    }
    
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  handleGoHome = () => {
    window.location.hash = '#/';
    this.resetError();
  };

  render() {
    const { hasError, error, errorInfo, errorCount } = this.state;
    const { children, fallback, isolate } = this.props;

    if (hasError && error) {
      if (fallback) {
        return <>{fallback}</>;
      }

      const errorMessage = error.message || 'An unexpected error occurred';
      const stackTrace = errorInfo?.componentStack || error.stack || '';
      
      const isProductionBuild = !stackTrace.includes('node_modules');

      return (
        <div className={`${isolate ? '' : 'min-h-screen'} flex items-center justify-center p-4`}>
          <Card className="max-w-2xl w-full">
            <CardHeader>
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div>
                  <CardTitle>Oops! Something went wrong</CardTitle>
                  <CardDescription>
                    {errorCount > 1 && `This error has occurred ${errorCount} times. `}
                    The application encountered an error and couldn't recover automatically.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-destructive/10 rounded-lg">
                <p className="font-mono text-sm text-destructive">
                  {errorMessage}
                </p>
              </div>
              
              {!isProductionBuild && stackTrace && (
                <details className="cursor-pointer">
                  <summary className="text-sm text-muted-foreground hover:text-foreground">
                    Show technical details
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-auto max-h-64">
                    {stackTrace}
                  </pre>
                </details>
              )}

              <div className="flex gap-3">
                <Button 
                  onClick={this.resetError}
                  className="gap-2"
                  variant="default"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
                {!isolate && (
                  <Button 
                    onClick={this.handleGoHome}
                    variant="outline"
                    className="gap-2"
                  >
                    <Home className="h-4 w-4" />
                    Go to Home
                  </Button>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                If this error persists, please try restarting the application or contact support.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return children;
  }
}