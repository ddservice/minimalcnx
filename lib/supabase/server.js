import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';

// Supabase client สำหรับ Server Component / Server Action / Route Handler
// อ่าน session จาก cookie ฝั่งเซิร์ฟเวอร์ — โค้ดนี้ไม่ถูกส่งไป browser
//
// ห่อด้วย cache() ของ React → หนึ่ง client ต่อหนึ่ง request แทนที่จะสร้างใหม่ทุกครั้งที่มีใครเรียก
// (หน้าเดียวเรียกผ่าน requireSession + helper อื่นๆ ได้หลายรอบ) cache() มีขอบเขตแค่ภายใน
// request เดียวและถูกทิ้งเมื่อจบ request จึงไม่มีทางที่ client ที่ถือ cookie ของคนหนึ่ง
// จะข้ามไปอีกคน — ต่างจากการเก็บไว้ที่ตัวแปร module ซึ่งจะรั่วข้าม user ทันที
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // ถูกเรียกจาก Server Component — set cookie ไม่ได้ ไม่เป็นไร
            // middleware จะ refresh session ให้แทน
          }
        },
      },
    }
  );
});
