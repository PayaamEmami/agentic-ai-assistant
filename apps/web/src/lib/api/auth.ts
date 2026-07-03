import { request, requestPublic } from './client';

export interface AuthPayload {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  };
}

export const authApi = {
  login(email: string, password: string) {
    return requestPublic<AuthPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  me() {
    return request<{ user: { id: string; email: string; displayName: string } }>('/api/auth/me');
  },
  devLogin(email: string, displayName: string) {
    return requestPublic<AuthPayload>('/api/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email, displayName }),
    });
  },
};
