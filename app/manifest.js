import { APP_NAME } from '../lib/brand';

export default function manifest() {
  return {
    name: `${APP_NAME} — สะสมแต้ม`,
    short_name: 'สะสมแต้ม',
    description: `ระบบสะสมแต้ม ${APP_NAME} สำหรับพนักงานหน้าร้าน`,
    start_url: '/loyalty',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f7f3ee',
    theme_color: '#3d2b1f',
    lang: 'th',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
