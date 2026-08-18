import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import path from 'path';
import fs from 'fs-extra';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { UserManager } from '../server/user-manager.js';
import { seedUserWorkspace, syncTemplates } from '../server/seeder.js';
import { createServer } from '../server/app.js';
import { SlackConfig } from '../slack/config.js';
import { ScopedKnowledgeBase } from '../slack/knowledge.js';
import { PodarcisResearchAgent } from '../slack/agent.js';
import { PodarcisSlackBot } from '../slack/bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const program = new Command();
program
  .name('podarcisnest')
  .description('🦎 PodarcisNest — Multi-User LLM Wiki Server Infrastructure')
  .version('1.0.0');

// Status Command
program
  .command('status')
  .description('Inspect service and container status')
  .action(() => {
    console.log(chalk.bold.cyan('🦎 PodarcisNest Status\n'));

    // Check systemd
    const sysCheck = spawnSync('which', ['systemctl'], { stdio: 'pipe' });
    if (sysCheck.status === 0) {
      const res = spawnSync('systemctl', ['is-active', 'podarcisnest'], { encoding: 'utf-8' });
      const state = res.status === 0 ? res.stdout.trim() : 'inactive / not-installed';
      const color = state === 'active' ? chalk.green : chalk.yellow;
      console.log(`Systemd Service: ${color(state)}`);
    } else {
      console.log(`Systemd Service: ${chalk.dim('N/A (Non-Linux or non-systemd system)')}`);
    }

    const um = new UserManager(rootDir);
    const containers = um.listContainers();

    const table = new Table({
      head: [chalk.bold('Username'), chalk.bold('Container Name'), chalk.bold('Port'), chalk.bold('Status')],
    });

    if (containers.length === 0) {
      console.log(chalk.dim('\nNo running user containers found.'));
    } else {
      for (const c of containers) {
        table.push([c.username || '—', c.name || '—', c.port || '—', c.status || '—']);
      }
      console.log('\n' + chalk.bold('Managed User Containers'));
      console.log(table.toString());
    }
  });

// Run Command
program
  .command('run')
  .description('Run server in foreground')
  .option('--host <host>', 'Bind host', '0.0.0.0')
  .option('--port <port>', 'Bind port', '8080')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const host = opts.host;
    console.log(chalk.bold.green(`Starting PodarcisNest server on http://${host}:${port}`));
    const app = createServer(rootDir);
    try {
      await app.listen({ host, port });
    } catch (err: any) {
      console.error(chalk.bold.red('Server start failed:'), err.message);
      process.exit(1);
    }
  });

// User Commands
const userCmd = program.command('user').description('User provisioning commands');

userCmd
  .command('list')
  .description('List all registered users')
  .action(() => {
    const um = new UserManager(rootDir);
    const reg = um.getUsersRegistry();

    const table = new Table({
      head: [chalk.bold('Username'), chalk.bold('Role'), chalk.bold('Created At'), chalk.bold('Workspace')],
    });

    for (const [uname, udata] of Object.entries(reg)) {
      table.push([
        uname,
        udata.role || 'user',
        udata.created_at || '—',
        udata.workspace_path || `./data/users/${uname}/workspace`,
      ]);
    }

    console.log(chalk.bold('Registered Users'));
    console.log(table.toString());
  });

userCmd
  .command('add <username>')
  .description('Add a new researcher user (automatically initializes Podarcis workspace)')
  .option('-p, --password <password>', 'User password')
  .option('--role <role>', 'User role', 'user')
  .option('--sources-backend <backend>', 'Sources backend (local or gdrive)', 'local')
  .option('-r, --run', 'Start user container immediately')
  .action(async (username, opts) => {
    const um = new UserManager(rootDir);
    try {
      um.createUser(username, opts.role, opts.password, opts.sourcesBackend as 'local' | 'gdrive');
      console.log(chalk.bold.green(`✓ User '${username}' created and Podarcis workspace initialized.`));
      if (opts.run) {
        const res = await um.startUserContainer(username);
        if (res.status && res.status.includes('Up')) {
          console.log(chalk.bold.green(`✓ Container for user '${username}' started on port ${res.port}.`));
        } else {
          console.log(chalk.yellow(`Container status: ${res.status} (Port: ${res.port})`));
        }
      }
    } catch (err: any) {
      console.error(chalk.bold.red('Error:'), err.message);
    }
  });

userCmd
  .command('delete <username>')
  .description('Delete user and workspace')
  .action((username) => {
    const um = new UserManager(rootDir);
    try {
      if (um.deleteUser(username)) {
        console.log(chalk.bold.green(`✓ User '${username}' deleted.`));
      } else {
        console.log(chalk.yellow(`User '${username}' not found.`));
      }
    } catch (err: any) {
      console.error(chalk.bold.red('Error:'), err.message);
    }
  });

userCmd
  .command('password <username> <password>')
  .description('Reset user password')
  .action((username, password) => {
    const um = new UserManager(rootDir);
    try {
      um.setUserPassword(username, password);
      console.log(chalk.bold.green(`✓ Password updated for user '${username}'.`));
    } catch (err: any) {
      console.error(chalk.bold.red('Error:'), err.message);
    }
  });

userCmd
  .command('start <username>')
  .description('Start user container')
  .action(async (username) => {
    const um = new UserManager(rootDir);
    try {
      const res = await um.startUserContainer(username);
      if (res.status && res.status.includes('Up')) {
        console.log(chalk.bold.green(`✓ Container for user '${username}' started on port ${res.port}.`));
      } else {
        console.log(chalk.yellow(`Container status: ${res.status} (Port: ${res.port})`));
        if (res.error) console.log(chalk.bold.red('Error:'), res.error);
      }
    } catch (err: any) {
      console.error(chalk.bold.red('Error:'), err.message);
    }
  });

userCmd
  .command('restart <username>')
  .description('Restart user container')
  .action(async (username) => {
    const um = new UserManager(rootDir);
    try {
      um.stopUserContainer(username);
      const res = await um.startUserContainer(username);
      if (res.status && res.status.includes('Up')) {
        console.log(chalk.bold.green(`✓ Container for user '${username}' restarted on port ${res.port}.`));
      } else {
        console.log(chalk.yellow(`Container status: ${res.status}`));
      }
    } catch (err: any) {
      console.error(chalk.bold.red('Error:'), err.message);
    }
  });

userCmd
  .command('stop <username>')
  .description('Stop user container')
  .action((username) => {
    const um = new UserManager(rootDir);
    try {
      if (um.stopUserContainer(username)) {
        console.log(chalk.bold.green(`✓ Container for user '${username}' stopped.`));
      } else {
        console.log(chalk.yellow(`Could not stop container for user '${username}'.`));
      }
    } catch (err: any) {
      console.error(chalk.bold.red('Error:'), err.message);
    }
  });

userCmd
  .command('start-all')
  .description('Start all registered user containers')
  .action(async () => {
    const um = new UserManager(rootDir);
    const reg = um.getUsersRegistry();
    for (const uname of Object.keys(reg)) {
      const res = await um.startUserContainer(uname);
      console.log(`User '${uname}': ${chalk.green(res.status)} (Port: ${res.port})`);
    }
  });

userCmd
  .command('stop-all')
  .description('Stop all running user containers')
  .action(() => {
    const um = new UserManager(rootDir);
    const reg = um.getUsersRegistry();
    for (const uname of Object.keys(reg)) {
      um.stopUserContainer(uname);
      console.log(`User '${uname}': ${chalk.yellow('Stopped')}`);
    }
  });

// Sync Templates
program
  .command('sync-templates')
  .description('Sync authoritative Podarcis templates from local repository or git')
  .option('--repo-url <url>', 'Git repository URL', 'https://github.com/XicuM/Podarcis.git')
  .option('--branch <branch>', 'Git branch to sync', 'master')
  .action((opts) => {
    const targetDir = path.join(rootDir, 'data', 'templates', 'podarcis');
    console.log(chalk.cyan(`Syncing Podarcis template assets to ${targetDir}...`));
    const ok = syncTemplates(rootDir);
    if (ok) {
      console.log(chalk.bold.green(`✓ Successfully synchronized templates in ${targetDir}`));
    } else {
      console.error(chalk.bold.red(`Failed to sync templates.`));
    }
  });

// Service command
program
  .command('service <action>')
  .description('Manage systemd services (start, stop, restart, status, enable, disable, uninstall)')
  .option('--slack', 'Target podarcisnest-slack.service instead of podarcisnest.service')
  .action((action, opts) => {
    if (action === 'uninstall') {
      const uninstallScript = path.join(rootDir, 'uninstall.sh');
      if (fs.existsSync(uninstallScript)) {
        spawnSync(uninstallScript, [], { stdio: 'inherit' });
        return;
      }
    }
    const target = opts.slack ? 'podarcisnest-slack' : 'podarcisnest';
    console.log(`Executing: systemctl ${action} ${target}...`);
    const res = spawnSync('systemctl', [action, target], { stdio: 'inherit' });
    if (res.status === 0) {
      console.log(chalk.bold.green(`✓ Successfully executed ${action} on ${target}.service`));
    } else {
      console.log(chalk.bold.red(`Failed to ${action} ${target}.service (try with sudo or check journalctl -u ${target})`));
    }
  });

// Slack Command
const slackCmd = program.command('slack').description('Manage and run the Podarcis Slack agent');

slackCmd
  .command('status')
  .description('Show Slack bot configuration and knowledge status')
  .action(() => {
    console.log(chalk.bold.cyan('🦎 PodarcisNest Slack Agent Status\n'));
    const cfg = SlackConfig.load(rootDir);

    const table = new Table({ head: [chalk.bold('Setting'), chalk.bold('Value')] });
    table.push([
      'Bot Token (SLACK_BOT_TOKEN)',
      cfg.slack_bot_token ? chalk.green('Configured') : chalk.red('Missing'),
    ]);
    table.push([
      'App Token (SLACK_APP_TOKEN)',
      cfg.slack_app_token ? chalk.green('Configured') : chalk.red('Missing'),
    ]);
    table.push(['LLM Provider', chalk.cyan(cfg.llm_provider)]);
    table.push(['LLM Base URL', chalk.cyan(cfg.llm_base_url || 'Default')]);
    table.push(['LLM API Key', cfg.llm_api_key ? chalk.green('Configured') : chalk.dim('Optional / Local')]);
    table.push(['LLM Model', chalk.cyan(cfg.llm_model || '—')]);

    const kb = new ScopedKnowledgeBase(rootDir);
    const recent = kb.getRecentWikiUpdates(7);
    table.push(['Shared Wiki Updates (Last 7d)', chalk.bold(`${recent.length} note(s)`)]);

    console.log(table.toString());

    if (!cfg.isConfigured()) {
      console.log(chalk.yellow('\n⚠️ Slack agent is missing configuration. Use "podarcisnest slack config" or set env vars.'));
    } else {
      console.log(chalk.green('\n✓ Ready to connect via "podarcisnest slack start"'));
    }
  });

slackCmd
  .command('config')
  .description('Configure Slack tokens and LLM API keys')
  .option('--bot-token <token>', 'Slack Bot User OAuth Token (xoxb-...)')
  .option('--app-token <token>', 'Slack App Token for Socket Mode (xapp-...)')
  .option('--provider <provider>', 'LLM Provider (opencode, openai, anthropic)')
  .option('--base-url <url>', 'OpenCode / OpenAI-compatible Base URL')
  .option('--api-key <key>', 'LLM API Key')
  .option('--model <model>', 'LLM Model Name')
  .action((opts) => {
    const cfg = SlackConfig.load(rootDir);
    if (opts.botToken) cfg.slack_bot_token = opts.botToken;
    if (opts.appToken) cfg.slack_app_token = opts.appToken;
    if (opts.provider) cfg.llm_provider = opts.provider;
    if (opts.baseUrl) cfg.llm_base_url = opts.baseUrl;
    if (opts.apiKey) cfg.llm_api_key = opts.apiKey;
    if (opts.model) cfg.llm_model = opts.model;

    cfg.save(rootDir);
    console.log(chalk.bold.green('✓ Slack agent configuration updated and saved to data/slack_config.json'));
  });

slackCmd
  .command('query <prompt>')
  .description('Test a research query against the knowledge base from CLI')
  .action(async (prompt) => {
    console.log(chalk.bold.cyan('Querying Podarcis research agent:'), prompt, '\n');
    const cfg = SlackConfig.load(rootDir);
    const agent = new PodarcisResearchAgent(rootDir, cfg);
    const res = await agent.processMessage(prompt, 'terminal-operator');
    console.log(chalk.bold.green('Response:'));
    console.log(res);
  });

slackCmd
  .command('start')
  .description('Start the Slack bot in Socket Mode')
  .action(async () => {
    console.log(chalk.bold.green('Starting Podarcis Slack Agent in Socket Mode...'));
    const cfg = SlackConfig.load(rootDir);
    const bot = new PodarcisSlackBot(rootDir, cfg);
    try {
      await bot.start();
    } catch (err: any) {
      console.error(chalk.bold.red('Failed to start Slack bot:'), err.message);
      process.exit(1);
    }
  });

export function main(): void {
  program.parse(process.argv);
}

if (process.argv[1] && process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js')) {
  main();
}
