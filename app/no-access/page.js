import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '../../lib/session';
import { homePathForRole } from '../../lib/perms';
import SignOutButton from '../../components/sign-out-button';

export default async function NoAccess() {
  const { role, perms } = await requireSession();
  const home = homePathForRole(role, perms);
  if (home !== '/no-access') redirect(home);
  return <main className="wrap"><div className="card"><div className="card-body">
    <h1>ยังไม่ได้รับสิทธิ์ใช้งาน</h1>
    <p>กรุณาติดต่อผู้ดูแลระบบเพื่อเปิดสิทธิ์ให้บัญชีนี้</p>
    <Link href="/">ตรวจสิทธิ์อีกครั้ง</Link><SignOutButton />
  </div></div></main>;
}
