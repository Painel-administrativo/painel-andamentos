import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Same-origin cookies only. No API key or Supabase token is sent to JavaScript.
export const API_BASE = "";
export async function checkResponse(res: Response) {
  if (res.status === 401) window.dispatchEvent(new Event("auth-expired"));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.erro || body.message || `Falha na solicitação (${res.status}).`);
  }
}
export async function apiRequest(method: string, url: string, data?: unknown): Promise<Response> {
  const isWrite = method !== "GET" && method !== "HEAD";
  const res = await fetch(`${API_BASE}${url}`, {
    method, credentials: "same-origin", cache: "no-store",
    headers: isWrite ? { "Content-Type": "application/json" } : undefined,
    body: isWrite ? JSON.stringify(data ?? {}) : undefined,
  });
  await checkResponse(res);
  return res;
}
type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401 }) => async ({ queryKey, signal }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      credentials: "same-origin", cache: "no-store", signal,
    });
    if (res.status === 401 && on401 === "returnNull") return null;
    await checkResponse(res);
    return res.json();
  };
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { queryFn: getQueryFn({ on401: "throw" }), refetchInterval: false,
      refetchOnWindowFocus: false, staleTime: Infinity, retry: false },
    mutations: { retry: false },
  },
});
