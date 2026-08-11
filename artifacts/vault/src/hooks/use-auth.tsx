import * as React from 'react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { useLocation } from 'wouter';

const AuthContext = React.createContext<{
  user: any;
  isLoading: boolean;
  isError: boolean;
}>({
  user: null,
  isLoading: true,
  isError: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      retry: false,
    }
  });
  const [location, setLocation] = useLocation();

  React.useEffect(() => {
    if (!isLoading && isError && location !== '/login' && location !== '/register') {
      setLocation('/login');
    }
    if (!isLoading && !isError && user && (location === '/login' || location === '/register')) {
      setLocation('/files');
    }
  }, [isLoading, isError, user, location, setLocation]);

  return (
    <AuthContext.Provider value={{ user, isLoading, isError }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => React.useContext(AuthContext);
