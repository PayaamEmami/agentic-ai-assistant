import { z } from 'zod';

export const AuthCredentialsRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});
export type AuthCredentialsRequest = z.infer<typeof AuthCredentialsRequest>;

export const AuthUserDto = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});
export type AuthUserDto = z.infer<typeof AuthUserDto>;

export const AuthResponse = z.object({
  token: z.string(),
  user: AuthUserDto,
});
export type AuthResponse = z.infer<typeof AuthResponse>;
