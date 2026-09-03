import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import os from 'os';
import { spawnSync } from 'child_process';
import { UserRecord, AdminRecord, ContainerInfo } from '../types.js';
import { seedUserWorkspace } from './seeder.js';
import { RepoManager } from './repo-manager.js';

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
    const ws = path.join(this.dataDir, username);
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

  public createUser(
    username: string,
    password?: string,
    sourcesBackend: 'local' | 'gdrive' = 'local'
  ): UserRecord {
    if (username === 'admin') {
      throw new Error("Cannot create a user named 'admin'. Admin is a dedicated server management role.");
    }
    if (!USER_NAME_REGEX.test(username)) {
      throw new Error('Invalid username. Must be 3-32 alphanumeric characters, hyphens, or underscores.');
    }

    const registry = this.getUsersRegistry();
    if (registry[username]) {
      throw new Error(`User '${username}' already exists.`);
    }

    const workspaceDir = this.getUserWorkspace(username);
    seedUserWorkspace(workspaceDir, username, this.rootDir, sourcesBackend);

    const userPwd = password || `${username}123`;
    const { hash, salt } = UserManager.hashPassword(userPwd);

    const userInfo: UserRecord = {
      username,
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

    const repoManager = new RepoManager(this.rootDir);
    const globalCfg = repoManager.getGlobalConfig();
    const memoryLimit = globalCfg.resources?.memory_limit || process.env.PODARCIS_CONTAINER_MEMORY || '4g';
    const cpuLimit = globalCfg.resources?.cpus_limit || process.env.PODARCIS_CONTAINER_CPUS || '2.0';
    const pidsLimit = String(globalCfg.resources?.pids_limit || process.env.PODARCIS_CONTAINER_PIDS || 256);

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
      memoryLimit,
      '--cpus',
      cpuLimit,
      '--pids-limit',
      pidsLimit,
      '-v',
      `${workspaceDir}:/home/coder/${username}`,
      '-v',
      `${sharedWiki}:/home/coder/${username}/wiki`,
      '-v',
      `${sharedSources}:/home/coder/${username}/sources`,
      '-e',
      `PODARCIS_USER=${username}`,
    ];

    if (globalCfg.cline?.base_url) {
      cmd.push('-e', `OPENAI_BASE_URL=${globalCfg.cline.base_url}`);
      cmd.push('-e', `OPENAI_API_BASE=${globalCfg.cline.base_url}`);
      cmd.push('-e', `CLINE_BASE_URL=${globalCfg.cline.base_url}`);
    }
    if (globalCfg.cline?.api_key) {
      cmd.push('-e', `OPENAI_API_KEY=${globalCfg.cline.api_key}`);
      cmd.push('-e', `CLINE_API_KEY=${globalCfg.cline.api_key}`);
    }
    if (globalCfg.cline?.model_id) {
      cmd.push('-e', `OPENAI_MODEL=${globalCfg.cline.model_id}`);
      cmd.push('-e', `CLINE_MODEL=${globalCfg.cline.model_id}`);
    }

    // Auto-install Herdr Companion extension: mount local vsix if available on host
    // Supports both extensions/herdr-companion.vsix in repo and ~/Projects/herdr-vscode builds
    // Legacy herdr-vscode vsix is also checked for backward compat
    const herdrMounts: Array<{ host: string; container: string }> = [];
    const herdrCandidates: Array<{ host: string; container: string }> = [
      { host: path.join(this.rootDir, 'extensions', 'herdr-companion-0.3.0.vsix'), container: '/tmp/herdr-companion.vsix' },
      { host: path.join(this.rootDir, 'extensions', 'herdr-companion-0.2.0.vsix'), container: '/tmp/herdr-companion.vsix' },
      { host: path.join(this.rootDir, 'extensions', 'herdr-companion.vsix'), container: '/tmp/herdr-companion.vsix' },
      { host: path.join(os.homedir(), 'Projects', 'herdr-companion', 'herdr-companion-0.3.0.vsix'), container: '/tmp/herdr-companion.vsix' },
      { host: path.join(os.homedir(), 'Projects', 'herdr-vscode', 'herdr-companion-0.2.0.vsix'), container: '/tmp/herdr-companion.vsix' },
      // Legacy fallback: herdr-vscode
      { host: path.join(this.rootDir, 'extensions', 'herdr-vscode-0.2.0.vsix'), container: '/tmp/herdr-companion.vsix' },
      { host: path.join(os.homedir(), 'Projects', 'herdr-vscode', 'herdr-vscode-0.2.0.vsix'), container: '/tmp/herdr-companion.vsix' },
    ];
    for (const cand of herdrCandidates) {
      if (fs.existsSync(cand.host)) {
        herdrMounts.push(cand);
        break;
      }
    }
    for (const m of herdrMounts) {
      cmd.push('-v', `${m.host}:${m.container}:ro`);
    }

    // Provision custom Herdr settings (old host session/config) for each user container.
    // The Herdr Companion extension defaults to session 'vscode' and reads
    // ~/.config/herdr/sessions/vscode/config.toml (via HERDR_CONFIG_PATH),
    // falling back to ~/.config/herdr/config.toml. Without these, containers
    // boot with herdr defaults (catppuccin-latte) instead of the custom
    // tmux-mirrored keys/theme, collapsed sidebar, mobile_width_threshold=0, etc.
    // Source priority: live host session config > host base config > repo canonical.
    const herdrConfigSource =
      [
        path.join(os.homedir(), '.config', 'herdr', 'sessions', 'vscode', 'config.toml'),
        path.join(os.homedir(), '.config', 'herdr', 'config.toml'),
        path.join(this.rootDir, 'config', 'herdr', 'config.toml'),
      ].find((p) => fs.existsSync(p)) || null;
    if (herdrConfigSource) {
      cmd.push('-v', `${herdrConfigSource}:/home/coder/.config/herdr/config.toml:ro`);
      cmd.push('-v', `${herdrConfigSource}:/home/coder/.config/herdr/sessions/vscode/config.toml:ro`);
    }

    // Herdr vsix mount is used at runtime; if no vsix, extension is already baked in Dockerfile.
    // If a vsix is mounted, install it before launching code-server. This requires overriding
    // the image's default ENTRYPOINT (/usr/bin/entrypoint.sh -> code-server "$@") which would
    // otherwise interpret "bash -c" as code-server args and fail with "Unknown option -c".
    const hasHerdrVsix = herdrMounts.some(m => m.container === '/tmp/herdr-companion.vsix');

    if (hasHerdrVsix) {
      const installCmd = 'code-server --install-extension /tmp/herdr-companion.vsix || true';

      cmd.push(
        '--entrypoint', 'bash',
        '-p', `127.0.0.1:${port}:8000`,
        '--restart', 'unless-stopped',
        'podarcisnest-user:latest',
        '-c',
        `eval "$(fixuid -q)" && ${installCmd} && exec dumb-init /usr/bin/code-server --bind-addr 0.0.0.0:8000 --auth none /home/coder/${username}`
      );
    } else {
      cmd.push(
        '-p', `127.0.0.1:${port}:8000`,
        '--restart', 'unless-stopped',
        'podarcisnest-user:latest',
        'code-server',
        '--bind-addr', '0.0.0.0:8000',
        '--auth', 'none',
        `/home/coder/${username}`
      );
    }

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

    // Seed herdr config into the running container (covers images built before
    // the config was baked in, and guarantees per-user provisioning even if
    // file mounts were skipped). Non-fatal: mounts/Dockerfile already cover
    // future restarts.
    try {
      this.provisionHerdrConfig(containerName);
    } catch {}

    return {
      name: containerName,
      username,
      status: 'Up (running)',
      port: String(port),
    };
  }

  private resolveHerdrConfigSource(): string | null {
    const candidates = [
      path.join(os.homedir(), '.config', 'herdr', 'sessions', 'vscode', 'config.toml'),
      path.join(os.homedir(), '.config', 'herdr', 'config.toml'),
      path.join(this.rootDir, 'config', 'herdr', 'config.toml'),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {}
    }
    return null;
  }

  public provisionHerdrConfig(containerName: string): boolean {
    const src = this.resolveHerdrConfigSource();
    if (!src) return false;
    try {
      spawnSync('docker', ['exec', '--user', 'coder', containerName, 'mkdir', '-p', '/home/coder/.config/herdr/sessions/vscode'], {
        stdio: 'pipe',
        timeout: 10000,
      });
      const cpBase = spawnSync('docker', ['cp', src, `${containerName}:/home/coder/.config/herdr/config.toml`], {
        stdio: 'pipe',
        timeout: 15000,
      });
      const cpSession = spawnSync('docker', ['cp', src, `${containerName}:/home/coder/.config/herdr/sessions/vscode/config.toml`], {
        stdio: 'pipe',
        timeout: 15000,
      });
      if (cpBase.status !== 0 || cpSession.status !== 0) return false;
      spawnSync('docker', ['exec', '--user', 'coder', containerName, 'chown', 'coder:coder', '/home/coder/.config/herdr/config.toml', '/home/coder/.config/herdr/sessions/vscode/config.toml'], {
        stdio: 'pipe',
        timeout: 10000,
      });
      // Restart session servers so the new config takes effect on next attach.
      // Non-fatal if no server is running yet.
      spawnSync('docker', ['exec', '--user', 'coder', containerName, 'pkill', '-f', 'herdr.*--session'], {
        stdio: 'pipe',
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  }

  public syncAllUserHerdrConfigs(): Record<string, boolean> {
    const results: Record<string, boolean> = {};
    for (const c of this.listContainers()) {
      if (!c.name) continue;
      try {
        results[c.username || c.name] = this.provisionHerdrConfig(c.name);
      } catch {
        results[c.username || c.name] = false;
      }
    }
    return results;
  }

  public syncAllUserClineSettings(): void {
    const registry = this.getUsersRegistry();
    for (const username of Object.keys(registry)) {
      try {
        const ws = this.getUserWorkspace(username);
        seedUserWorkspace(ws, username, this.rootDir);
      } catch {}
    }
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
