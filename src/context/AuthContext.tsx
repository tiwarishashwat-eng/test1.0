import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, LoginRequest, RegisterRequest } from '../shared/types.js';
import { apiClient } from '../services/apiClient.js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (creds: LoginRequest) => Promise<{ success: boolean; error?: string }>;
  register: (payload: RegisterRequest) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(apiClient.getToken());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = async () => {
    const activeToken = apiClient.getToken();
    if (!activeToken) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await apiClient.getCurrentUser();
      if (res.success && res.user) {
        setUser(res.user);
        setToken(activeToken);
      } else {
        setUser(null);
        setToken(null);
        apiClient.setToken(null);
      }
    } catch (err) {
      console.warn('[AuthContext] Session restore failed:', err);
      setUser(null);
      setToken(null);
      apiClient.setToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (creds: LoginRequest) => {
    try {
      const res = await apiClient.login(creds);
      if (res.success && res.user && res.token) {
        setUser(res.user);
        setToken(res.token);
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to authenticate' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Login request failed' };
    }
  };

  const register = async (payload: RegisterRequest) => {
    try {
      const res = await apiClient.register(payload);
      if (res.success && res.user && res.token) {
        setUser(res.user);
        setToken(res.token);
        return { success: true };
      }
      return { success: false, error: res.error || 'Failed to register' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Registration request failed' };
    }
  };

  const logout = async () => {
    await apiClient.logout();
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        register,
        logout,
        refreshUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
