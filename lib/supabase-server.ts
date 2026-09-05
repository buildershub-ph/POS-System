import type { NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type AuthenticatedUser = {
  id: string;
  email?: string;
  role?: "owner" | "manager" | "sales_employee" | "stock_employee" | "cashier";
};

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

function configuration() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are not configured.");
  }
  return { supabaseUrl, supabaseAnonKey };
}

export function supabaseStorageUrl(path: string) {
  return `${configuration().supabaseUrl}/storage/v1/object/${path}`;
}

export function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return request.cookies.get("bh-access-token")?.value ?? null;
}

function sitesEmail(request: NextRequest) {
  return request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() ?? null;
}

function serviceHeaders() {
  if (!supabaseServiceKey) throw new Error("Supabase service key is not configured.");
  return {
    apikey: supabaseServiceKey,
    ...(supabaseServiceKey.startsWith("eyJ") ? { authorization: `Bearer ${supabaseServiceKey}` } : {}),
    "content-type": "application/json",
  };
}

export async function supabaseAdminRest(path: string, init: RequestInit = {}) {
  const config = configuration();
  return fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(), ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

export async function authenticateRequest(request: NextRequest) {
  const email = sitesEmail(request);
  if (email && supabaseServiceKey) {
    const response = await supabaseAdminRest(`profiles?select=id,email,role,active&email=eq.${encodeURIComponent(email)}&active=eq.true&limit=1`);
    if (!response.ok) return null;
    const [profile] = (await response.json()) as Array<AuthenticatedUser & { active: boolean }>;
    return profile ? { id: profile.id, email: profile.email, role: profile.role } : null;
  }

  const token = bearerToken(request);
  if (!token) return null;
  const config = configuration();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const authUser = (await response.json()) as AuthenticatedUser;
  const profileResponse = await fetch(`${config.supabaseUrl}/rest/v1/profiles?select=id,email,role,active&id=eq.${authUser.id}&active=eq.true&limit=1`, {
    headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!profileResponse.ok) return null;
  const [profile] = (await profileResponse.json()) as Array<AuthenticatedUser & { active: boolean }>;
  return profile ? { id: profile.id, email: profile.email, role: profile.role } : null;
}

export async function supabaseStorage(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
) {
  const token = bearerToken(request);
  const config = configuration();
  const useServiceRole = Boolean(sitesEmail(request) && supabaseServiceKey);
  const key = useServiceRole ? supabaseServiceKey! : config.supabaseAnonKey;
  const authorization = useServiceRole && !key.startsWith("eyJ") ? undefined : `Bearer ${useServiceRole ? key : token ?? key}`;
  return fetch(`${config.supabaseUrl}/storage/v1/object/${path}`, {
    ...init,
    headers: {
      apikey: key,
      ...(authorization ? { authorization } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

export async function supabaseRest(
  request: NextRequest,
  path: string,
  init: RequestInit = {},
) {
  if (sitesEmail(request) && supabaseServiceKey) return supabaseAdminRest(path, init);
  const token = bearerToken(request);
  const config = configuration();
  return fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.supabaseAnonKey,
      authorization: `Bearer ${token ?? config.supabaseAnonKey}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}
