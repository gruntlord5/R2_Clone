import { useRouteError, Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';

export function RouteError() {
  const error = useRouteError() as Error & { statusText?: string; status?: number };
  
  const is404 = error?.status === 404;
  const errorMessage = is404 
    ? "The page you're looking for doesn't exist." 
    : error?.message || error?.statusText || 'An unexpected error occurred';

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-white dark:bg-[#1a1a1a]">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle>{is404 ? 'Page Not Found' : 'Oops! Something went wrong'}</CardTitle>
              <CardDescription>
                {is404 
                  ? "We couldn't find what you were looking for."
                  : 'The application encountered an error and couldn\'t recover automatically.'}
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

          <div className="flex gap-3">
            <Link to="/">
              <Button variant="default" className="gap-2">
                <Home className="h-4 w-4" />
                Go to Home
              </Button>
            </Link>
            <Button 
              onClick={handleRefresh}
              variant="outline"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Page
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            If this error persists, please try restarting the application.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}