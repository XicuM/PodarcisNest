import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { spawnSync } from 'child_process';
import { UserRecord, AdminRecord, ContainerInfo } from '../types.js';
import { seedUserWorkspace } from './seeder.js';

const USER_NAME_REGEX = /^[a-zA-Z0-9_-]{3,32}$/;

export class UserManager {
  public rootDir: string;
  public dataDir: string;
  public adminFile: string;
  public registryFile: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.dataDir = path.join(this.rootDir, 'data', 'users');
    this.adminFile = path.join(this.rootDir, 'data', 'admin.json');
    this.registryFile = path.join(this.dataDir, 'users.json');

    fs.ensureDirSync(this.dataDir);
    this.initAdmin();
    this.initRegistry();
  }

  private atomicWriteJson(filePath: string, data: unknown): void {
    fs.ensureDirSync(path.dirname(filePath));
    const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      throw err;
    }
  }

  public static hashPassword(password: string, salt?: string): { hash: string; salt: string } {
    const activeSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, activeSalt, 100000, 32, 'sha256').toString('hex');
    return { hash, salt: activeSalt };
  }

  public static verifyPassword(password: string, storedHash: string, salt: string): boolean {
    const { hash } = UserManager.hashPassword(password, salt);
    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
    } catch {
      return false;
    }
  }

  private initAdmin(): void {
    if (!fs.existsSync(this.adminFile)) {
      const { hash, salt } = UserManager.hashPassword('admin');
      const adminData: AdminRecord = {
        role: 'admin',
        password_hash: hash,
        password_salt: salt,
        created_at: '2026-08-01T00:00:00Z',
      };
      this.atomicWriteJson(this.adminFile, adminData);
    }
  }

  public authenticateAdmin(password: string): boolean {
    try {
      if (fs.existsSync(this.adminFile)) {
        const adminData: AdminRecord = fs.readJsonSync(this.adminFile);
        if (adminData.password_hash && adminData.password_salt) {
          return UserManager.verifyPassword(password, adminData.password_hash, adminData.password_salt);
        }
      }
    } catch {}
    return false;
  }

  public setAdminPassword(password: string): void {
    const { hash, salt } = UserManager.hashPassword(password);
    const adminData: AdminRecord = {
      role: 'admin',
      password_hash: hash,
      password_salt: salt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.atomicWriteJson(this.adminFile, adminData);
  }

  private initRegistry(): void {
    if (!fs.existsSync(this.registryFile)) {
      this.atomicWriteJson(this.registryFile, {});
    } else {
      const reg = this.getUsersRegistry();
      if ('admin' in reg) {
        delete reg['admin'];
        this.saveUsersRegistry(reg);
      }
    }
  }

  public getUsersRegistry(): Record<string, UserRecord> {
    try {
      if (fs.existsSync(this.registryFile)) {
        return fs.readJsonSync(this.registryFile);
      }
    } catch {}
    return {};
  }

  public saveUsersRegistry(registry: Record<string, UserRecord>): void {
    this.atomicWriteJson(this.registryFile, registry);
  }

  public getUserWorkspace(username: string): string {
    if (!USER_NAME_REGEX.test(username) || username === 'admin') {
      throw new Error(`Invalid username: ${username}`);
    }
    const ws = path.join(this.dataDir, username, 'workspace');
    fs.ensureDirSync(ws);
    return ws;
  }

  public listContainers(): ContainerInfo[] {
    try {
      const res = spawnSync('docker', [
        'ps',
        '-a',
        '--filter',
        'label=podarcisnest.user',
        '--format',
        '{{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Labels}}',
      ], {
        encoding: 'utf-8',
        timeout: 10000,
      });

      const containers: ContainerInfo[] = [];
      if (res.status === 0 && res.stdout && res.stdout.trim()) {
        const lines = res.stdout.trim().split('\n');
        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length >= 4) {
            const [name, status, ports, labelsStr] = parts;
            let user: string | undefined;
            let targetPort: string | undefined;

            for (const label of labelsStr.split(',')) {
              if (label.startsWith('podarcisnest.user=')) {
                user = label.split('=', 2)[1];
              } else if (label.startsWith('podarcisnest.port=')) {
                targetPort = label.split('=', 2)[1];
              }
            }

            if (user) {
              containers.push({
                name,
                status,
                ports,
                username: user,
                port: targetPort,
              });
            }
          }
        }
      }
      return containers;
    } catch {
      return [];
    }
  }

  public getContainerForUser(username: string): ContainerInfo | null {
    for (const container of this.listContainers()) {
      if (container.username === username) {
        return container;
      }
    }
    return null;
  }

  public setUserPassword(username: string, password: string): void {
    const registry = this.getUsersRegistry();
    if (!registry[username]) {
      throw new Error(`User '${username}' does not exist.`);
    }
    const { hash, salt } = UserManager.hashPassword(password);
    registry[username].password_hash = hash;
    registry[username].password_salt = salt;
    this.saveUsersRegistry(registry);
  }

  public authenticateUser(username: string, password: string): UserRecord | null {
    const registry = this.getUsersRegistry();
    const userInfo = registry[username];
    if (!userInfo) {
      return null;
    }

    if (!userInfo.password_hash || !userInfo.password_salt) {
      this.setUserPassword(username, password);
      return this.getUsersRegistry()[username] || null;
    }

    if (UserManager.verifyPassword(password, userInfo.password_hash, userInfo.password_salt)) {
      return userInfo;
    }
    return null;
  }

  public createUser(username: string, role: 'user' | 'admin' = 'user', password?: string): UserRecord {
    if (username === 'admin') {
      throw new Error("Cannot create a user named 'admin'. Admin is a dedicated management role.");
    }
    if (!USER_NAME_REGEX.test(username)) {
      throw new Error('Invalid username. Must be 3-32 alphanumeric characters, hyphens, or underscores.');
    }

    const registry = this.getUsersRegistry();
    if (registry[username]) {
      throw new Error(`User '${username}' already exists.`);
    }

    const workspaceDir = this.getUserWorkspace(username);
    seedUserWorkspace(workspaceDir, username, this.rootDir);

    const userPwd = password || `${username}123`;
    const { hash, salt } = UserManager.hashPassword(userPwd);

    const userInfo: UserRecord = {
      username,
      role,
      created_at: new Date().toISOString(),
      workspace_path: workspaceDir,
      password_hash: hash,
      password_salt: salt,
    };

    registry[username] = userInfo;
    this.saveUsersRegistry(registry);
    return userInfo;
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(true));
      });
    });
  }

  public async allocateFreePort(): Promise<number> {
    const usedPorts = new Set<number>();
    for (const c of this.listContainers()) {
      if (c.port) {
        const p = parseInt(c.port, 10);
        if (!isNaN(p)) usedPorts.add(p);
      }
    }

    let port = 9001;
    while (true) {
      if (!usedPorts.has(port)) {
        const available = await this.isPortAvailable(port);
        if (available) return port;
      }
      port += 1;
    }
  }

  public ensureImageExists(): boolean {
    try {
      const inspectRes = spawnSync('docker', ['image', 'inspect', 'podarcisnest-user:latest'], {
        stdio: 'pipe',
        timeout: 10000,
      });
      if (inspectRes.status === 0) return true;

      const dockerfile = path.join(this.rootDir, 'Dockerfile');
      if (fs.existsSync(dockerfile)) {
        const buildRes = spawnSync('docker', ['build', '-t', 'podarcisnest-user:latest', this.rootDir], {
          stdio: 'pipe',
          timeout: 300000,
        });
        return buildRes.status === 0;
      }
    } catch {}
    return false;
  }

  public async startUserContainer(username: string): Promise<ContainerInfo> {
    if (username === 'admin') {
      throw new Error("Cannot start a container for 'admin'. Admin is a management role.");
    }
    if (!USER_NAME_REGEX.test(username)) {
      throw new Error(`Invalid username: '${username}'`);
    }

    let registry = this.getUsersRegistry();
    if (!registry[username]) {
      this.createUser(username);
      registry = this.getUsersRegistry();
    }

    const workspaceDir = this.getUserWorkspace(username);
    if (!fs.existsSync(path.join(workspaceDir, 'AGENTS.md')) || !fs.existsSync(path.join(workspaceDir, '.agents'))) {
      seedUserWorkspace(workspaceDir, username, this.rootDir);
    }

    const existing = this.getContainerForUser(username);
    if (existing && existing.status && existing.status.includes('Up')) {
      return existing;
    }

    this.ensureImageExists();

    const containerName = `podarcisnest-user-${username}`;
    const sharedWiki = path.join(this.rootDir, 'data', 'shared', 'wiki');
    const sharedSources = path.join(this.rootDir, 'data', 'shared', 'sources');
    fs.ensureDirSync(sharedWiki);
    fs.ensureDirSync(sharedSources);

    const port = await this.allocateFreePort();

    spawnSync('docker', ['rm', '-f', containerName], { stdio: 'pipe', timeout: 15000 });

    const cmd = [
      'run',
      '-d',
      '--name',
      containerName,
      '--label',
      `podarcisnest.user=${username}`,
      '--label',
      `podarcisnest.port=${port}`,
      '--memory',
      '4g',
      '--cpus',
      '2.0',
      '--pids-limit',
      '256',
      '-v',
      `${workspaceDir}:/home/coder/workspace`,
      '-v',
      `${sharedWiki}:/home/coder/workspace/shared/wiki`,
      '-v',
      `${sharedSources}:/home/coder/workspace/shared/sources`,
      '-e',
      `PODARCIS_USER=${username}`,
      '-p',
      `127.0.0.1:${port}:8000`,
      '--restart',
      'unless-stopped',
      'podarcisnest-user:latest',
      'code-server',
      '--bind-addr',
      '0.0.0.0:8000',
      '--auth',
      'none',
      '/home/coder/workspace',
    ];

    const res = spawnSync('docker', cmd, { encoding: 'utf-8', timeout: 30000 });
    if (res.status !== 0) {
      return {
        name: containerName,
        username,
        status: 'Virtual Mode (Build podarcisnest-user:latest image for live Docker run)',
        port: String(port),
        error: (res.stderr || '').trim(),
      };
    }

    return {
      name: containerName,
      username,
      status: 'Up (running)',
      port: String(port),
    };
  }

  public stopUserContainer(username: string): boolean {
    const containerName = `podarcisnest-user-${username}`;
    const res = spawnSync('docker', ['rm', '-f', containerName], { stdio: 'pipe', timeout: 15000 });
    return res.status === 0;
  }

  public deleteUser(username: string): boolean {
    if (username === 'admin') {
      throw new Error('Cannot delete admin user.');
    }
    this.stopUserContainer(username);

    const userDir = path.join(this.dataDir, username);
    if (fs.existsSync(userDir)) {
      fs.removeSync(userDir);
    }

    const registry = this.getUsersRegistry();
    if (registry[username]) {
      delete registry[username];
      this.saveUsersRegistry(registry);
      return true;
    }
    return false;
  }
}
