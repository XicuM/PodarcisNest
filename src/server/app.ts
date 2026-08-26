import path from 'path';
import crypto from 'crypto';
import net from 'net';
import fs from 'fs-extra';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import secureSession from '@fastify/secure-session';
import pointOfView from '@fastify/view';
import { Eta } from 'eta';
import httpProxy from 'http-proxy';
import { fileURLToPath } from 'url';
import { UserManager } from './user-manager.js';
import { RepoManager } from './repo-manager.js';
import { seedUserWorkspace } from './seeder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '..', '..');

export function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 8000): Promise<boolean> {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const tryConnect = () => {
      if (Date.now() - startTime >= timeoutMs) {
        return resolve(false);
      }
      const sock = net.createConnection({ port, host });
      sock.setTimeout(1000);
      sock.on('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        setTimeout(tryConnect, 200);
      });
      sock.on('timeout', () => {
        sock.destroy();
        setTimeout(tryConnect, 200);
      });
    };
    tryConnect();
  });
}

export function findTemplatesDir(rootDir: string): string {
  const candidates = [
    path.join(rootDir, 'src', 'server', 'templates'),
    path.join(rootDir, 'dist', 'server', 'templates'),
    path.join(rootDir, 'dist', 'cli', 'templates'),
    path.join(rootDir, 'dist', 'templates'),
    path.join(rootDir, 'templates'),
    path.join(__dirname, 'templates'),
    path.join(__dirname, '..', 'src', 'server', 'templates'),
    path.join(__dirname, '..', 'server', 'templates'),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand) && (fs.existsSync(path.join(cand, 'login.eta')) || fs.existsSync(path.join(cand, 'login.html')))) {
      return cand;
    }
  }
  return path.join(rootDir, 'src', 'server', 'templates');
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    try {
      cookies[key] = decodeURIComponent(val);
    } catch {
      cookies[key] = val;
    }
  }
  return cookies;
}

export function getSecretKey(rootDir: string): Buffer {
  const secretFile = path.join(rootDir, 'data', '.session_secret');
  if (fs.existsSync(secretFile)) {
    try {
      fs.chmodSync(secretFile, 0o600);
      const raw = fs.readFileSync(secretFile);
      if (raw.length === 32) return raw;
      const hex = raw.toString('utf-8').trim();
      if (hex.length === 64) return Buffer.from(hex, 'hex');
    } catch {}
  }
  const secret = crypto.randomBytes(32);
  fs.ensureDirSync(path.dirname(secretFile));
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

export function createServer(rootDir: string = defaultRootDir): FastifyInstance {
  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  const userManager = new UserManager(rootDir);
  const repoManager = new RepoManager(rootDir);
  const secretKey = getSecretKey(rootDir);
  const templatesDir = findTemplatesDir(rootDir);
  const proxy = httpProxy.createProxyServer({
    ws: true,
    xfwd: true,
  });

  proxy.on('error', (err, req, res) => {
    if ('writeHead' in res && typeof res.writeHead === 'function') {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h3>VS Code Web proxy connection error</h3><p>${err.message}</p>`);
    }
  });

  // Plugins
  app.register(formbody);
  app.register(cookie);
  app.register(secureSession, {
    key: secretKey,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  });

  const eta = new Eta({
    views: templatesDir,
    cache: process.env.NODE_ENV === 'production',
  });

  app.register(pointOfView, {
    engine: {
      eta,
    },
    root: templatesDir,
  });

  // Helper: check auth
  function isAuthenticatedForUser(req: FastifyRequest, targetUser: string): boolean {
    const session = req.session;
    if (!session) return false;
    if (session.get('is_admin')) return true;
    if (session.get('authenticated_user') === targetUser) return true;
    return false;
  }

  // Routes
  app.get('/', async (req, reply) => {
    if (req.session.get('is_admin')) {
      return reply.redirect('/admin');
    }
    const currentUser = req.session.get('authenticated_user');
    if (currentUser) {
      return reply.redirect(`/user/${currentUser}/`);
    }

    const usersRegistry = userManager.getUsersRegistry();
    const containers = userManager.listContainers();
    const containerMap = new Map(containers.map((c) => [c.username, c]));

    const userList = Object.entries(usersRegistry)
      .filter(([uname]) => uname !== 'admin')
      .map(([uname, udata]) => {
        const cInfo = containerMap.get(uname);
        return {
          username: uname,
          role: udata.role || 'user',
          status: cInfo?.status || 'Stopped',
          port: cInfo?.port || '—',
        };
      });

    return reply.view('login.eta', {
      users: userList,
      error: (req.query as Record<string, string>)?.error,
    });
  });

  app.get('/login', async (req, reply) => {
    if (req.session.get('is_admin')) {
      return reply.redirect('/admin');
    }
    const currentUser = req.session.get('authenticated_user');
    if (currentUser) {
      return reply.redirect(`/user/${currentUser}/`);
    }

    const usersRegistry = userManager.getUsersRegistry();
    const userList = Object.keys(usersRegistry)
      .filter((uname) => uname !== 'admin')
      .map((uname) => ({ username: uname }));

    return reply.view('login.eta', {
      error: (req.query as Record<string, string>)?.error,
      users: userList,
    });
  });

  app.post('/login/user', async (req, reply) => {
    const body = req.body as Record<string, string>;
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';

    if (!username || !password) {
      return reply.view('login.eta', { error: 'Username and password required.' });
    }

    const userInfo = userManager.authenticateUser(username, password);
    if (!userInfo) {
      return reply.view('login.eta', { error: 'Invalid username or password.' });
    }

    req.session.set('authenticated_user', username);
    req.session.set('is_admin', false);
    return reply.redirect(`/user/${username}/`);
  });

  app.post('/login/admin', async (req, reply) => {
    const body = req.body as Record<string, string>;
    const password = body.password || '';

    if (!password) {
      return reply.view('login.eta', { error: 'Admin password is required.' });
    }

    const isValid = userManager.authenticateAdmin(password);
    if (!isValid) {
      return reply.view('login.eta', { error: 'Invalid admin password.' });
    }

    req.session.set('is_admin', true);
    req.session.set('authenticated_user', 'admin');
    return reply.redirect('/admin');
  });

  app.get('/admin/login', async (req, reply) => reply.redirect('/login'));
  app.post('/admin/login', async (req, reply) => reply.redirect('/login'));

  app.get('/logout', async (req, reply) => {
    req.session.delete();
    return reply.redirect('/login');
  });

  app.get('/admin/logout', async (req, reply) => {
    req.session.delete();
    return reply.redirect('/login');
  });

  app.get('/admin', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.redirect('/login?error=Admin+access+required');
    }

    const usersRegistry = userManager.getUsersRegistry();
    const containers = userManager.listContainers();
    const containerMap = new Map(containers.map((c) => [c.username, c]));

    const userList = Object.entries(usersRegistry)
      .filter(([uname]) => uname !== 'admin')
      .map(([uname, udata]) => {
        const cInfo = containerMap.get(uname);
        return {
          username: uname,
          role: udata.role || 'user',
          status: cInfo?.status || 'Stopped',
          port: cInfo?.port || '—',
          created_at: udata.created_at || '—',
        };
      });

    const globalConfig = repoManager.getGlobalConfig();
    const wikiRepo = repoManager.getRepoInfo('wiki');
    const sourcesRepo = repoManager.getRepoInfo('sources');

    return reply.view('admin.eta', {
      users: userList,
      config: globalConfig,
      wikiRepo,
      sourcesRepo,
    });
  });

  // Admin APIs: Configuration & Repositories
  app.get('/api/admin/config', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const config = repoManager.getGlobalConfig();
    const wiki = repoManager.getRepoInfo('wiki');
    const sources = repoManager.getRepoInfo('sources');
    return reply.send({ success: true, config, wiki, sources });
  });

  app.post('/api/admin/config', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as any;
    try {
      const updated = repoManager.saveGlobalConfig(body);
      if (body.cline) {
        userManager.syncAllUserClineSettings();
      }
      return reply.send({ success: true, config: updated });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/admin/repos/sync', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { repo: 'wiki' | 'sources'; remote_url?: string };
    if (!body.repo || !['wiki', 'sources'].includes(body.repo)) {
      return reply.code(400).send({ error: "Invalid repository type. Must be 'wiki' or 'sources'." });
    }
    try {
      const res = repoManager.syncRepo(body.repo, body.remote_url);
      return reply.send({ success: res.success, message: res.message });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/admin/repos/branch', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { repo: 'wiki' | 'sources'; branch: string };
    if (!body.repo || !body.branch) {
      return reply.code(400).send({ error: 'repo and branch parameters required.' });
    }
    try {
      const res = repoManager.switchBranch(body.repo, body.branch);
      return reply.send({ success: res.success, message: res.message });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Admin APIs: User Management
  app.post('/api/admin/users/create', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as {
      username?: string;
      password?: string;
      sources_backend?: 'local' | 'gdrive';
    };
    const username = (body.username || '').trim().toLowerCase();
    try {
      const globalCfg = repoManager.getGlobalConfig();
      const sourcesBackend = body.sources_backend || (globalCfg.sources_backend as 'local' | 'gdrive') || 'local';
      const user = userManager.createUser(username, body.password, sourcesBackend);
      return reply.send({ success: true, user });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/admin/users/seed', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { username?: string };
    const username = (body.username || '').trim().toLowerCase();
    try {
      const ws = userManager.getUserWorkspace(username);
      const globalCfg = repoManager.getGlobalConfig();
      const sourcesBackend = (globalCfg.sources_backend as 'local' | 'gdrive') || 'local';
      seedUserWorkspace(ws, username, rootDir, sourcesBackend);
      return reply.send({ success: true, message: `Workspace for '${username}' re-seeded successfully.` });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/admin/users/delete', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { username?: string };
    const username = body.username || '';
    try {
      userManager.deleteUser(username);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.post('/api/admin/containers/restart', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { username?: string };
    const username = body.username || '';
    try {
      const res = await userManager.startUserContainer(username);
      return reply.send({ success: true, container: res });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Reverse Proxy Handler
  const handleProxy = async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { username?: string; '*': string };
    const targetUser = (params.username || '').trim().toLowerCase();

    if (targetUser === 'admin') {
      return reply.redirect('/admin');
    }

    if (!isAuthenticatedForUser(req, targetUser)) {
      return reply.redirect(`/login?error=Please+log+in+to+access+workspace+'${targetUser}'`);
    }

    // Ensure trailing slash for root user path to avoid relative redirect loops
    const rawUrl = req.raw.url || '/';
    if (!rawUrl.endsWith('/') && (rawUrl === `/user/${targetUser}` || rawUrl.startsWith(`/user/${targetUser}?`))) {
      const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
      return reply.status(302).redirect(`/user/${targetUser}/${query}`);
    }

    let container = userManager.getContainerForUser(targetUser);
    if (!container || !container.port) {
      container = await userManager.startUserContainer(targetUser);
    }

    const portNum = container.port ? parseInt(container.port, 10) : null;
    if (!portNum) {
      return reply
        .code(503)
        .type('text/html')
        .send(`<h3>VS Code container starting up for '${targetUser}'. Please refresh in a few seconds...</h3>`);
    }

    // Wait for the container's code-server process to accept TCP connections (up to 8s)
    const isReady = await waitForPort(portNum, '127.0.0.1', 8000);
    if (!isReady) {
      return reply
        .code(503)
        .type('text/html')
        .send(`<h3>VS Code container for '${targetUser}' is initializing...</h3><p>Please wait a moment while the server starts.</p><script>setTimeout(()=>location.reload(), 2000)</script>`);
    }

    // Rewrite path to remove /user/:username prefix before proxying to code-server root
    const prefix = `/user/${targetUser}`;
    let url = req.raw.url || '/';
    if (url.startsWith(prefix)) {
      url = url.slice(prefix.length) || '/';
    }
    req.raw.url = url;

    // Headers
    req.raw.headers['x-forwarded-host'] = (req.headers.host as string) || 'localhost:8080';
    req.raw.headers['x-forwarded-proto'] = req.protocol;
    req.raw.headers['x-forwarded-prefix'] = `/user/${targetUser}`;

    reply.hijack();
    proxy.web(req.raw, reply.raw, {
      target: `http://127.0.0.1:${portNum}`,
      changeOrigin: true,
      autoRewrite: true,
      prependPath: false,
    });
  };

  app.all('/user/:username', handleProxy);
  app.all('/user/:username/*', handleProxy);

  // WebSocket proxy on upgrade with secure session authentication
  app.server.on('upgrade', async (req, socket, head) => {
    const url = req.url || '';
    const match = url.match(/^\/user\/([^/?#]+)(.*)/);
    if (!match) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const targetUser = match[1].toLowerCase();
    if (targetUser === 'admin') {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // Validate and authenticate session cookie
    const cookies = parseCookieHeader(req.headers.cookie);
    const sessionCookie = cookies['session'];
    if (!sessionCookie) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const session = app.decodeSecureSession(sessionCookie);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const authUser = session.get('authenticated_user');
    const isAdmin = session.get('is_admin');
    if (!isAdmin && authUser !== targetUser) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    let container = userManager.getContainerForUser(targetUser);
    if (!container || !container.port) {
      container = await userManager.startUserContainer(targetUser);
    }

    const portNum = container.port ? parseInt(container.port, 10) : null;
    if (!portNum || isNaN(portNum)) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const isReady = await waitForPort(portNum, '127.0.0.1', 4000);
    if (!isReady) {
      socket.write('HTTP/1.1 504 Gateway Timeout\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const subpath = match[2] || '/';
    req.url = subpath;

    req.headers['x-forwarded-host'] = (req.headers.host as string) || 'localhost:8080';
    req.headers['x-forwarded-prefix'] = `/user/${targetUser}`;
    req.headers['x-forwarded-proto'] = 'http';

    proxy.ws(req, socket, head, {
      target: `ws://127.0.0.1:${portNum}`,
      changeOrigin: false,
      prependPath: false,
    });
  });

  return app;
}
