import { z } from "zod";
export const loginInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});
export const signupInput = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10, "A senha deve ter ao menos 10 caracteres.").max(256),
});
export interface AuthStatus {
  transport?: "cookie";
  configured: boolean;
  googleConfigured: boolean;
  environment: "isolated-test";
}
export interface AuthSession {
  ticket: string;
  expiresAt: number;
}
