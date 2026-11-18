// Run after npm run build with a loopback Supabase fixture configured.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  const fixture = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(fixture.hostname),
    'Runtime smoke checks require a loopback Supabase fixture');

  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));

  const standalone = path.resolve('.next/standalone');
  fs.cpSync('public', path.join(standalone, 'public'), { recursive: true });
  fs.cpSync('.next/static', path.join(standalone, '.next/static'), { recursive: true });
  const server = spawn(process.execPath, [path.join(standalone, 'server.js')], {
    cwd: standalone,
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let logs = '';
  let spawnError;
  server.on('error', (error) => { spawnError = error; });
  const collect = (chunk) => { logs = (logs + chunk.toString()).slice(-12000); };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);
  const base = `http://127.0.0.1:${port}`;
  const request = (url, options = {}) => fetch(base + url, {
    redirect: 'manual', signal: AbortSignal.timeout(5000), ...options,
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (spawnError) throw spawnError;
      assert.equal(server.exitCode, null, `Server exited during startup\n${logs}`);
      try {
        ready = (await request('/login')).status === 200;
      } catch {
        // The server may still be binding its listener.
      }
      if (ready) break;
      await delay(500);
    }
    assert.ok(ready, `Server did not become ready\n${logs}`);
    let checks = 0;
    const pass = (name) => { checks += 1; console.log(`PASS ${name}`); };
    const login = await request('/login');
    const html = await login.text();
    assert.equal(login.status, 200);
    assert.match(html, /name="username"/);
    assert.match(html, /name="password"/);
    assert.match(html, /width=device-width/);
    pass('production login form and mobile viewport');

    const protectedPaths = ['/', '/dashboard', '/sales', '/expenses', '/expenses/bakery',
      '/opex', '/reports', '/analytics', '/loyalty', '/loyalty/history', '/loyalty/analytics',
      '/admin', '/admin/loyalty', '/admin/audit', '/admin/documents', '/settings',
      '/export?month=10%2F2026'];
    for (const route of protectedPaths) {
      const response = await request(route);
      assert.equal(response.status, 307, route);
      assert.equal(new URL(response.headers.get('location'), base).pathname, '/login', route);
      pass(`anonymous redirect ${route}`);
    }

    const forgedRole = await request('/admin/audit', { headers: { Cookie: 'mm69_role=admin' } });
    assert.equal(forgedRole.status, 307);
    assert.equal(new URL(forgedRole.headers.get('location'), base).pathname, '/login');
    pass('role cookie alone does not authenticate');

    const asset = html.match(/src="([^" ]*\/_next\/static\/[^" ]+\.js)"/);
    assert.ok(asset, 'Login must include a JavaScript asset');
    const staticResponse = await request(asset[1]);
    assert.equal(staticResponse.status, 200);
    assert.match(staticResponse.headers.get('content-type'), /javascript/);
    pass('standalone JavaScript assets bypass auth proxy');
    const icon = await request('/icons/icon-192.png');
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /image\/png/);
    pass('standalone public icons bypass auth proxy');
    console.log(`Runtime checks passed: ${checks}`);
  } catch (error) {
    console.error(logs);
    throw error;
  } finally {
    if (server.pid && server.exitCode === null) {
      const exited = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      await exited;
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
