import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import secureSession from '@fastify/secure-session';
import pointOfView from '@fastify/view';
import websocket from '@fastify/websocket';
import { Eta } from 'eta';
import httpProxy from 'http-proxy';
import { fileURLToPath } from 'url';
import { UserManager } from './user-manager.js';
import { seedUserWorkspace } from './seeder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRootDir = path.resolve(__dirname, '..', '..');

export function getSecretKey(rootDir: string): Buffer {
  const secretFile = path.join(rootDir, 'data', '.session_secret');
  if (fs.existsSync(secretFile)) {
    try {
      const raw = fs.readFileSync(secretFile);
      if (raw.length === 32) return raw;
      const hex = raw.toString('utf-8').trim();
      if (hex.length === 64) return Buffer.from(hex, 'hex');
    } catch {}
  }
  const secret = crypto.randomBytes(32);
  fs.ensureDirSync(path.dirname(secretFile));
  fs.writeFileSync(secretFile, secret);
  return secret;
}

export function createServer(rootDir: string = defaultRootDir): FastifyInstance {
  const app = Fastify({
    logger: false,
    trustProxy: true,
  });

  const userManager = new UserManager(rootDir);
  const secretKey = getSecretKey(rootDir);
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
    views: path.join(__dirname, 'templates'),
    cache: process.env.NODE_ENV === 'production',
  });

  app.register(pointOfView, {
    engine: {
      eta,
    },
    root: path.join(__dirname, 'templates'),
  });

  app.register(websocket);

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

    return reply.view('admin.eta', { users: userList });
  });

  // Admin APIs
  app.post('/api/admin/users/create', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { username?: string; role?: 'user' | 'admin'; password?: string };
    const username = (body.username || '').trim().toLowerCase();
    try {
      const user = userManager.createUser(username, body.role || 'user', body.password);
      return reply.send({ success: true, user });
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

  app.post('/api/admin/users/reseed', async (req, reply) => {
    if (!req.session.get('is_admin')) {
      return reply.code(403).send({ error: 'Unauthorized' });
    }
    const body = req.body as { username?: string };
    const username = body.username || '';
    try {
      const ws = userManager.getUserWorkspace(username);
      seedUserWorkspace(ws, username, rootDir);
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

    let container = userManager.getContainerForUser(targetUser);
    if (!container || !container.port) {
      container = await userManager.startUserContainer(targetUser);
    }

    const targetPort = container.port;
    if (!targetPort) {
      return reply
        .code(503)
        .type('text/html')
        .send(`<h3>VS Code container starting up for '${targetUser}'. Please refresh in a few seconds...</h3>`);
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
      target: `http://127.0.0.1:${targetPort}`,
      prependPath: false,
    });
  };

  app.all('/user/:username', handleProxy);
  app.all('/user/:username/*', handleProxy);

  // WebSocket proxy on upgrade
  app.server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const match = url.match(/^\/user\/([^/?#]+)/);
    if (!match) {
      socket.destroy();
      return;
    }

    const targetUser = match[1].toLowerCase();
    if (targetUser === 'admin') {
      socket.destroy();
      return;
    }

    const container = userManager.getContainerForUser(targetUser);
    if (!container || !container.port) {
      socket.destroy();
      return;
    }

    const targetPort = container.port;
    const prefix = `/user/${targetUser}`;
    let newUrl = url;
    if (newUrl.startsWith(prefix)) {
      newUrl = newUrl.slice(prefix.length) || '/';
    }
    req.url = newUrl;

    req.headers['x-forwarded-host'] = (req.headers.host as string) || 'localhost:8080';
    req.headers['x-forwarded-prefix'] = `/user/${targetUser}`;

    proxy.ws(req, socket, head, {
      target: `ws://127.0.0.1:${targetPort}`,
      prependPath: false,
    });
  });

  return app;
}
