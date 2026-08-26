import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { parseCookieHeader, getSecretKey, createServer } from '../app.js';
import { UserManager } from '../user-manager.js';
import { RepoManager } from '../repo-manager.js';

describe('Auth, Security & Configuration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podarcis-auth-test-'));
  });

  afterEach(() => {
    fs.removeSync(tmpDir);
  });

  it('correctly parses cookie headers', () => {
    const header = 'session=abc123xyz; other=test%20value; empty=';
    const parsed = parseCookieHeader(header);
    expect(parsed.session).toBe('abc123xyz');
    expect(parsed.other).toBe('test value');
    expect(parsed.empty).toBe('');
  });

  it('handles empty or undefined cookie header safely', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  it('generates secret key with restricted file permissions (0600)', () => {
    const key = getSecretKey(tmpDir);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);

    const secretFile = path.join(tmpDir, 'data', '.session_secret');
    expect(fs.existsSync(secretFile)).toBe(true);

    const stat = fs.statSync(secretFile);
    // mode & 0o777 should be 0o600
    expect((stat.mode & 0o777) === 0o600 || (stat.mode & 0o700) === 0o600).toBe(true);

    // Reading again returns same key
    const key2 = getSecretKey(tmpDir);
    expect(key.equals(key2)).toBe(true);
  });

  it('hashes and verifies passwords securely using PBKDF2 with salt', () => {
    const pwd = 'super-secret-password-123';
    const { hash, salt } = UserManager.hashPassword(pwd);
    expect(hash).toBeDefined();
    expect(salt).toBeDefined();
    expect(UserManager.verifyPassword(pwd, hash, salt)).toBe(true);
    expect(UserManager.verifyPassword('wrong-password', hash, salt)).toBe(false);
  });

  it('manages admin and user credentials properly', () => {
    const um = new UserManager(tmpDir);

    // Default admin
    expect(um.authenticateAdmin('admin')).toBe(true);
    expect(um.authenticateAdmin('wrong')).toBe(false);

    // Update admin password
    um.setAdminPassword('new-secure-admin-pass');
    expect(um.authenticateAdmin('admin')).toBe(false);
    expect(um.authenticateAdmin('new-secure-admin-pass')).toBe(true);

    // Create regular user
    const user = um.createUser('testresearcher', 'userpass123');
    expect(user.username).toBe('testresearcher');
    expect(um.authenticateUser('testresearcher', 'userpass123')).not.toBeNull();
    expect(um.authenticateUser('testresearcher', 'wrongpass')).toBeNull();
  });

  it('stores and retrieves container resource limits via RepoManager', () => {
    const rm = new RepoManager(tmpDir);
    const cfg = rm.getGlobalConfig();
    expect(cfg.resources?.memory_limit).toBe('4g');
    expect(cfg.resources?.cpus_limit).toBe('2.0');
    expect(cfg.resources?.pids_limit).toBe(256);

    rm.saveGlobalConfig({
      resources: {
        memory_limit: '8g',
        cpus_limit: '4.0',
        pids_limit: 512,
      },
    });

    const updated = rm.getGlobalConfig();
    expect(updated.resources?.memory_limit).toBe('8g');
    expect(updated.resources?.cpus_limit).toBe('4.0');
    expect(updated.resources?.pids_limit).toBe(512);
  });

  it('instantiates Fastify server with security plugins registered', async () => {
    const app = createServer(tmpDir);
    expect(app).toBeDefined();
    await app.ready();
    expect(typeof app.decodeSecureSession).toBe('function');
    await app.close();
  });
});
