import { updateSession } from './lib/supabase/middleware';

export async function proxy(request) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // ทุก path ยกเว้น static asset
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
