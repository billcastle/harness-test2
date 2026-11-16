// Static checks of the deployment files. They cannot prove the stack runs (that needs Docker), but they stop the
// security-relevant settings from drifting: nothing but Caddy is published, the database network is isolated,
// the proxy trust matches the network, and every variable the stack needs is documented.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');
const compose = read('compose.yaml');

/** The text of one service, from its "  name:" line to the next service (compose files here are plain 2-space YAML). */
function service(name: string): string {
  const m = new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)+)`, 'm').exec(compose);
  if (!m) throw new Error(`service ${name} not found`);
  return m[1]!;
}
const serviceNames = [...compose.matchAll(/^  (\w+):\n(?=    )/gm)].map((m) => m[1]!).filter((n) => ['caddy', 'app', 'db', 'backup'].includes(n));

describe('compose.yaml', () => {
  it('has the four services', () => expect(serviceNames.sort()).toEqual(['app', 'backup', 'caddy', 'db']));

  it('publishes ports only for Caddy: the app and the database are not reachable from outside', () => {
    expect(service('caddy')).toMatch(/ports:\n\s+- "80:80"\n\s+- "443:443"/);
    for (const name of ['app', 'db', 'backup']) expect(service(name), name).not.toMatch(/^\s+ports:/m);
    expect(service('app')).toMatch(/expose: \["3000"\]/);
  });

  it('keeps the database off the edge network, and the data network internal', () => {
    expect(service('db')).toMatch(/networks: \[data\]/);
    expect(service('backup')).toMatch(/networks: \[data, edge\]/); // it must reach both the database and the internet
    expect(service('caddy')).toMatch(/networks: \[edge\]/);
    expect(service('app')).toMatch(/networks: \[edge, data\]/);
    expect(compose).toMatch(/data:\n\s+internal: true/);
    expect(compose).not.toMatch(/edge:\n\s+internal: true/); // Caddy needs the internet for certificates, backup for the bucket
  });

  it('trusts X-Forwarded-For only from the edge network subnet', () => {
    const subnet = /subnet: (\S+) \}/.exec(compose)![1];
    expect(service('app')).toContain(`TRUST_PROXY: ${subnet}`);
    expect(subnet).toBe('172.28.0.0/24');
  });

  it('the API only accepts changes from the https site, and the app starts after a healthy database', () => {
    expect(service('app')).toContain('ALLOWED_ORIGIN: https://${DOMAIN');
    expect(service('app')).toMatch(/db: \{ condition: service_healthy \}/);
    expect(service('caddy')).toMatch(/app: \{ condition: service_healthy \}/);
  });

  it('refuses to start without the required secrets', () => {
    expect(compose).toContain('${POSTGRES_PASSWORD:?');
    expect(compose).toContain('${DOMAIN:?');
  });

  it('the app container is read-only with a tmpfs, and persistent data lives in named volumes', () => {
    expect(service('app')).toMatch(/read_only: true/);
    expect(service('db')).toMatch(/dbdata:\/var\/lib\/postgresql\/data/);
    expect(compose).toMatch(/volumes:\n\s+dbdata:/);
  });

  it('every build file it points at exists', () => {
    for (const f of ['deploy/app.Dockerfile', 'deploy/caddy.Dockerfile', 'deploy/backup/Dockerfile', 'deploy/Caddyfile', 'deploy/backup/backup.sh', 'deploy/backup/restore-check.sh', 'deploy/backup/loop.sh']) {
      expect(existsSync(path.join(root, f)), f).toBe(true);
    }
  });
});

describe('Caddyfile', () => {
  const caddy = read('deploy/Caddyfile');
  it('sets the security headers', () => {
    expect(caddy).toContain('Strict-Transport-Security');
    expect(caddy).toContain('X-Content-Type-Options "nosniff"');
    expect(caddy).toContain('Referrer-Policy');
    expect(caddy).toContain("frame-ancestors 'none'");
  });
  it('caps request bodies at 10 MB and proxies only /api to the app', () => {
    expect(caddy).toMatch(/request_body \{\s+max_size 10MB/);
    expect(caddy).toMatch(/handle \/api\/\* \{[\s\S]*reverse_proxy app:3000/);
    expect(caddy.match(/reverse_proxy/g)).toHaveLength(1);
  });
  it('serves the single-page app, falling back to index.html', () => expect(caddy).toContain('try_files {path} /index.html'));
});

describe('secrets and configuration', () => {
  it('.env is git-ignored and .env.example holds no secret values', () => {
    expect(read('.gitignore').split('\n')).toContain('.env');
    const example = read('.env.example');
    for (const key of ['POSTGRES_PASSWORD', 'RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY', 'RCLONE_CONFIG_SECURE_PASSWORD', 'RCLONE_CONFIG_SECURE_PASSWORD2']) {
      expect(example, key).toMatch(new RegExp(`^${key}=$`, 'm'));
    }
  });
  it('every ${VARIABLE} the compose file reads is documented in .env.example', () => {
    const example = read('.env.example');
    for (const [, name] of compose.matchAll(/\$\{(\w+)/g)) expect(example, name).toMatch(new RegExp(`^${name}=`, 'm'));
  });
});

describe('backup scripts', () => {
  const backup = read('deploy/backup/backup.sh');
  it('fail loudly: set -e, refuse an empty dump, report failure to the dead-man switch', () => {
    expect(backup).toContain('set -eu');
    expect(backup).toMatch(/-gt 1000/);
    expect(backup).toContain('notify /fail');
  });
  it('upload through the (encrypted) rclone remote and never write the dump anywhere but /tmp', () => {
    expect(backup).toContain('rclone copyto');
    expect(backup).toContain('/tmp/expenses-');
    expect(read('.env.example')).toContain('RCLONE_CONFIG_SECURE_TYPE=crypt');
  });
  it('the restore check restores into a scratch database and cleans it up', () => {
    const r = read('deploy/backup/restore-check.sh');
    expect(r).toContain('create database restore_check');
    expect(r).toContain('drop database if exists restore_check');
  });
});
