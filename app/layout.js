import { Prompt } from 'next/font/google';
import './globals.css';
import { APP_NAME } from '../lib/brand';
// Icons: tree-shaken via components/icon.js (@tabler/icons-react) — ไม่โหลด webfont ทั้งชุด

// Prompt รองรับทั้งไทย+อังกฤษในฟอนต์เดียว — โหลดผ่าน next/font (self-host อัตโนมัติ ไม่ยิง
// request ไป Google Fonts ตอน runtime, ไม่มี layout shift) แล้วส่งเป็น CSS variable ให้ globals.css ใช้
const prompt = Prompt({
  subsets: ['thai', 'latin'],
  // ลดน้ำหนักฟอนต์เหลือที่ใช้จริง — เดิม 4 ไฟล์ทำให้ first load หนักโดยไม่จำเป็น
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-prompt',
});

export const metadata = {
  title: APP_NAME,
  description: 'ระบบจัดการร้านและสะสมแต้ม',
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'สะสมแต้ม',
  },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

// สำคัญ: การกำหนด viewport export เองจะ "แทนที่" ค่าเริ่มต้นของ Next.js ทั้งหมด
// (ไม่ merge) — ถ้าลืมใส่ width/initialScale, iOS Safari จะถือว่าไม่มี viewport
// meta tag ที่ถูกต้อง แล้วย่อทั้งหน้าให้เหมือนเดสก์ท็อป (~980px) แทนที่จะเป็นมือถือจริง
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3d2b1f',
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" className={prompt.variable}>
      <body>{children}</body>
    </html>
  );
}
