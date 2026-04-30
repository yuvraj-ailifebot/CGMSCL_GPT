import React, { createContext, useState, useContext } from 'react';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

const generateToken = (username) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
  };
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const signature = btoa(`${encodedHeader}.${encodedPayload}.secret`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

const isTokenValid = (tokenToCheck) => {
  try {
    if (!tokenToCheck) return false;
    const parts = tokenToCheck.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    const currentTime = Date.now() / 1000;
    if (payload.exp && payload.exp < currentTime) return false;
    return true;
  } catch (e) {
    console.error('Error validating token:', e);
    return false;
  }
};

const getInitialToken = () => {
  try {
    const storedToken = localStorage.getItem('gpt_authToken');
    if (storedToken && isTokenValid(storedToken)) return storedToken;
    if (storedToken) {
      localStorage.removeItem('gpt_authToken');
      localStorage.removeItem('gpt_user');
    }
  } catch (e) {
    console.error('Error reading token:', e);
  }
  return null;
};

const getInitialUser = () => {
  try {
    const storedToken = localStorage.getItem('gpt_authToken');
    const storedUser = localStorage.getItem('gpt_user');
    if (storedToken && storedUser && isTokenValid(storedToken)) {
      return JSON.parse(storedUser);
    }
  } catch (e) {
    console.error('Error reading user:', e);
  }
  return null;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getInitialUser);
  const [token, setToken] = useState(getInitialToken);
  const [isLoading] = useState(false);

  const loginWithOTP = (apiUser) => {
    try {
      const rawName = apiUser?.textfield || apiUser?.firstname || `user_${apiUser?.userid}`;
      // eslint-disable-next-line no-control-regex
      const safeName = rawName.replace(/[^\x20-\x7E]/g, '') || `user_${apiUser?.userid}`;
      const newToken = generateToken(safeName);

      const userData = {
        username: rawName,
        userid: apiUser?.userid,
        name: rawName,
        email: apiUser?.emailid || '',
        role: apiUser?.rolename || 'user',
        mobile: apiUser?.siMobile || '',
        designation: apiUser?.siDesig || '',
      };

      setToken(newToken);
      setUser(userData);
      localStorage.setItem('gpt_authToken', newToken);
      localStorage.setItem('gpt_user', JSON.stringify(userData));
      return { success: true };
    } catch (error) {
      console.error('OTP Login error:', error);
      return { success: false, error: error.message || 'Login failed.' };
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('gpt_authToken');
    localStorage.removeItem('gpt_user');
  };

  const getAuthHeaders = () => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  };

  const value = {
    user,
    token,
    isLoading,
    loginWithOTP,
    logout,
    isAuthenticated: !!token && isTokenValid(token),
    getAuthHeaders,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
