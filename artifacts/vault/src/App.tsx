import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect
} from 'wouter';

import { ThemeProvider } from '@/components/theme-provider';
import { AuthProvider } from '@/hooks/use-auth';
import { Shell } from '@/components/layout';

import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import FilesPage from '@/pages/files';
import AdminPage from '@/pages/admin';
import SettingsPage from '@/pages/settings';
import SharePreviewPage from '@/pages/share-preview';

// If any authenticated query returns 401, the session is gone (e.g. server
// restarted and wiped the in-memory session store). Clear all cached data and
// redirect to login so the user can re-authenticate.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error: any) => {
      const status = error?.status ?? error?.response?.status;
      // If any authenticated query sees a 401 while NOT on the login page,
      // the session has expired — redirect so the user can log back in.
      // Do NOT clear the cache here: clearing causes mounted queries to
      // immediately re-fetch, which returns another 401 → infinite loop.
      if (status === 401 && !window.location.pathname.endsWith('/login')) {
        window.location.replace('/login');
      }
    },
  }),
});

function AuthenticatedRouter() {
  return (
    <RoutedErrorBoundary>
      <Shell>
        <Switch>
          <Route path="/" component={() => <Redirect to="/files" />} />
          <Route path="/login" component={LoginPage} />
          <Route path="/register" component={RegisterPage} />
          <Route path="/files" component={FilesPage} />
          <Route path="/admin" component={AdminPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </Shell>
    </RoutedErrorBoundary>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/share/:token" component={SharePreviewPage} />
      <Route>
        <AuthProvider>
          <AuthenticatedRouter />
        </AuthProvider>
      </Route>
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;