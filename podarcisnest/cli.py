"""PodarcisNest Debug & Maintenance CLI."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.table import Table

from podarcisnest.server.user_manager import UserManager
from podarcisnest.server.seeder import seed_user_workspace

console = Console()
root_dir = Path(__file__).resolve().parent.parent


def cmd_status(args):
    """Check service status and active containers."""
    console.print("[bold cyan]🦎 PodarcisNest Status[/bold cyan]\n")

    # Check systemd status
    import shutil
    if shutil.which("systemctl"):
        res = subprocess.run(["systemctl", "is-active", "podarcisnest"], capture_output=True, text=True)
        state = res.stdout.strip() if res.returncode == 0 else "inactive / not-installed"
        color = "green" if state == "active" else "yellow"
        console.print(f"Systemd Service: [{color}]{state}[/{color}]")
    else:
        console.print("Systemd Service: [dim]N/A (Non-Linux or non-systemd system)[/dim]")

    # Check user containers
    um = UserManager(root_dir)
    containers = um.list_containers()

    table = Table(title="Managed User Containers")
    table.add_column("Username", style="bold")
    table.add_column("Container Name")
    table.add_column("Port")
    table.add_column("Status")

    if not containers:
        console.print("[dim]No running user containers found.[/dim]")
    else:
        for c in containers:
            table.add_row(
                c.get("username", "—"),
                c.get("name", "—"),
                str(c.get("port", "—")),
                c.get("status", "—"),
            )
        console.print(table)


def cmd_run(args):
    """Run server in foreground for debugging."""
    import uvicorn
    console.print(f"[bold green]Starting PodarcisNest server on http://{args.host}:{args.port} (Foreground Debug Mode)[/bold green]")
    uvicorn.run("podarcisnest.server.app:app", host=args.host, port=args.port, reload=args.reload)


def cmd_user(args):
    """Manage users from CLI."""
    um = UserManager(root_dir)
    action = args.user_action

    if action == "list":
        reg = um.get_users_registry()
        table = Table(title="Registered Users")
        table.add_column("Username", style="bold")
        table.add_column("Role")
        table.add_column("Created At")
        table.add_column("Workspace")

        for uname, udata in reg.items():
            table.add_row(
                uname,
                udata.get("role", "user"),
                udata.get("created_at", "—"),
                udata.get("workspace_path", f"./data/users/{uname}/workspace"),
            )
        console.print(table)

    elif action == "add":
        try:
            info = um.create_user(args.username, role=args.role, password=args.password)
            console.print(f"[bold green]✓ User '{args.username}' created successfully.[/bold green]")
            if getattr(args, "run", False):
                res = um.start_user_container(args.username)
                if "Up" in res.get("status", ""):
                    console.print(f"[bold green]✓ Container for user '{args.username}' started on port {res.get('port')}.[/bold green]")
                else:
                    console.print(f"[yellow]Container status: {res.get('status')} (Port: {res.get('port')})[/yellow]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")

    elif action == "delete":
        try:
            if um.delete_user(args.username):
                console.print(f"[bold green]✓ User '{args.username}' deleted.[/bold green]")
            else:
                console.print(f"[yellow]User '{args.username}' not found.[/yellow]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")

    elif action == "password":
        try:
            um.set_user_password(args.username, args.password)
            console.print(f"[bold green]✓ Password updated for user '{args.username}'.[/bold green]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")

    elif action == "start":
        try:
            res = um.start_user_container(args.username)
            if "Up" in res.get("status", ""):
                console.print(f"[bold green]✓ Container for user '{args.username}' started on port {res.get('port')}.[/bold green]")
            else:
                console.print(f"[yellow]Container status: {res.get('status')} (Port: {res.get('port')})[/yellow]")
                if res.get("error"):
                    console.print(f"[bold red]Error:[/bold red] {res.get('error')}")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")

    elif action == "restart":
        try:
            um.stop_user_container(args.username)
            res = um.start_user_container(args.username)
            if "Up" in res.get("status", ""):
                console.print(f"[bold green]✓ Container for user '{args.username}' restarted on port {res.get('port')}.[/bold green]")
            else:
                console.print(f"[yellow]Container status: {res.get('status')}[/yellow]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")

    elif action == "stop":
        try:
            if um.stop_user_container(args.username):
                console.print(f"[bold green]✓ Container for user '{args.username}' stopped.[/bold green]")
            else:
                console.print(f"[yellow]Could not stop container for user '{args.username}'.[/yellow]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")

    elif action == "start-all":
        reg = um.get_users_registry()
        for uname in reg:
            res = um.start_user_container(uname)
            console.print(f"User '{uname}': [green]{res.get('status')}[/green] (Port: {res.get('port')})")

    elif action == "stop-all":
        reg = um.get_users_registry()
        for uname in reg:
            um.stop_user_container(uname)
            console.print(f"User '{uname}': [yellow]Stopped[/yellow]")

    elif action == "seed":
        try:
            ws = um.get_user_workspace(args.username)
            seed_user_workspace(ws, args.username, root_dir)
            console.print(f"[bold green]✓ Seeded Podarcis workspace for user '{args.username}'.[/bold green]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")


def cmd_sync_templates(args):
    """Sync authoritative Podarcis templates from git repository into data/templates/podarcis."""
    target_dir = root_dir / "data" / "templates" / "podarcis"
    repo_url = args.repo_url
    branch = args.branch

    console.print(f"[cyan]Syncing Podarcis template assets from {repo_url} ({branch})...[/cyan]")
    target_dir.parent.mkdir(parents=True, exist_ok=True)

    if (target_dir / ".git").exists():
        res = subprocess.run(["git", "-C", str(target_dir), "pull", "origin", branch], capture_output=True, text=True)
        if res.returncode == 0:
            console.print(f"[bold green]✓ Successfully updated templates in {target_dir}[/bold green]")
        else:
            console.print(f"[bold red]Failed to update templates:[/bold red] {res.stderr}")
    else:
        res = subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", branch, repo_url, str(target_dir)],
            capture_output=True,
            text=True,
        )
        if res.returncode == 0:
            console.print(f"[bold green]✓ Successfully cloned templates to {target_dir}[/bold green]")
        else:
            console.print(f"[bold red]Failed to clone templates:[/bold red] {res.stderr}")


def cmd_service(args):
    """Control systemctl service for server or slack daemon."""
    action = args.service_action
    target = "podarcisnest-slack" if getattr(args, "slack", False) else "podarcisnest"
    
    console.print(f"Executing: systemctl {action} {target}...")
    res = subprocess.run(["systemctl", action, target])
    if res.returncode == 0:
        console.print(f"[bold green]✓ Successfully executed {action} on {target}.service[/bold green]")
    else:
        console.print(f"[bold red]Failed to {action} {target}.service (try with sudo, systemctl --user, or check journalctl -u {target})[/bold red]")


def cmd_slack(args):
    """Manage and start the Podarcis Slack agent."""
    from podarcisnest.slack.config import SlackConfig
    from podarcisnest.slack.bot import PodarcisSlackBot
    from podarcisnest.slack.agent import PodarcisResearchAgent
    from podarcisnest.slack.knowledge import ScopedKnowledgeBase

    action = args.slack_action
    cfg = SlackConfig.load(root_dir)

    if action == "status":
        console.print("[bold cyan]🦎 PodarcisNest Slack Agent Status[/bold cyan]\n")
        table = Table()
        table.add_column("Setting", style="bold")
        table.add_column("Value")

        table.add_row("Bot Token (SLACK_BOT_TOKEN)", "[green]Configured[/green]" if cfg.slack_bot_token else "[red]Missing[/red]")
        table.add_row("App Token (SLACK_APP_TOKEN)", "[green]Configured[/green]" if cfg.slack_app_token else "[red]Missing[/red]")
        table.add_row("LLM Provider", f"[cyan]{cfg.llm_provider}[/cyan]")
        table.add_row("LLM Base URL", f"[cyan]{cfg.llm_base_url or 'Default'}[/cyan]")
        table.add_row("LLM API Key", "[green]Configured[/green]" if cfg.llm_api_key else "[dim]Optional / Local[/dim]")
        table.add_row("LLM Model", f"[cyan]{cfg.llm_model}[/cyan]")

        kb = ScopedKnowledgeBase(root_dir)
        recent = kb.get_recent_wiki_updates(days=7)
        table.add_row("Shared Wiki Updates (Last 7d)", f"[bold]{len(recent)}[/bold] note(s)")

        console.print(table)

        if not cfg.is_configured():
            console.print("\n[yellow]⚠️ Slack agent is missing configuration. Use 'podarcisnest slack config' or set env vars.[/yellow]")
        else:
            console.print("\n[green]✓ Ready to connect via 'podarcisnest slack start'[/green]")

    elif action == "config":
        if args.bot_token:
            cfg.slack_bot_token = args.bot_token
        if args.app_token:
            cfg.slack_app_token = args.app_token
        if args.provider:
            cfg.llm_provider = args.provider
        if args.base_url:
            cfg.llm_base_url = args.base_url
        if args.api_key:
            cfg.llm_api_key = args.api_key
        if args.model:
            cfg.llm_model = args.model

        cfg.save(root_dir)
        console.print("[bold green]✓ Slack agent configuration updated and saved to data/slack_config.json[/bold green]")

    elif action == "query":
        console.print(f"[bold cyan]Querying Podarcis research agent:[/bold cyan] {args.prompt}\n")
        agent = PodarcisResearchAgent(root_dir, cfg)
        response = agent.process_message(user_query=args.prompt, user_name="terminal-operator")
        console.print("[bold green]Response:[/bold green]")
        console.print(response)

    elif action == "start":
        console.print("[bold green]Starting Podarcis Slack Agent in Socket Mode...[/bold green]")
        try:
            bot = PodarcisSlackBot(root_dir, cfg)
            bot.start()
        except KeyboardInterrupt:
            console.print("\n[yellow]Slack bot stopped by operator.[/yellow]")
        except Exception as e:
            console.print(f"[bold red]Failed to start Slack bot:[/bold red] {e}")


def main():
    parser = argparse.ArgumentParser(prog="podarcisnest", description="Multi-User LLM Wiki Server Infrastructure")
    subparsers = parser.add_subparsers(dest="command")

    # status
    subparsers.add_parser("status", help="Inspect service and container status")

    # run (debug mode)
    run_parser = subparsers.add_parser("run", help="Run server in foreground for debugging")
    run_parser.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    run_parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")
    run_parser.add_argument("--reload", action="store_true", help="Enable live auto-reload")

    # user
    user_parser = subparsers.add_parser("user", help="User provisioning commands")
    user_sub = user_parser.add_subparsers(dest="user_action")
    user_sub.add_parser("list", help="List all users")

    add_parser = user_sub.add_parser("add", help="Add user")
    add_parser.add_argument("username", help="Username")
    add_parser.add_argument("--password", "-p", help="Password")
    add_parser.add_argument("--role", default="user", choices=["user", "admin"], help="User role")
    add_parser.add_argument("--run", "-r", action="store_true", help="Immediately start user container upon creation")

    del_parser = user_sub.add_parser("delete", help="Delete user")
    del_parser.add_argument("username", help="Username")

    pwd_parser = user_sub.add_parser("password", help="Reset user password")
    pwd_parser.add_argument("username", help="Username")
    pwd_parser.add_argument("password", help="New password")

    start_parser = user_sub.add_parser("start", help="Start user container")
    start_parser.add_argument("username", help="Username")

    restart_parser = user_sub.add_parser("restart", help="Restart user container")
    restart_parser.add_argument("username", help="Username")

    stop_parser = user_sub.add_parser("stop", help="Stop user container")
    stop_parser.add_argument("username", help="Username")

    seed_parser = user_sub.add_parser("seed", help="Seed or re-initialize Podarcis .agents and OKF layout for a user")
    seed_parser.add_argument("username", help="Username")

    user_sub.add_parser("start-all", help="Start all registered user containers")
    user_sub.add_parser("stop-all", help="Stop all running user containers")

    # sync-templates
    tmpl_parser = subparsers.add_parser("sync-templates", help="Sync authoritative Podarcis templates from git repository")
    tmpl_parser.add_argument(
        "--repo-url",
        default="https://github.com/XicuM/Podarcis.git",
        help="Git repository URL (default: https://github.com/XicuM/Podarcis.git)",
    )
    tmpl_parser.add_argument(
        "--branch",
        default="master",
        help="Git branch to sync (default: master)",
    )

    # slack
    slack_parser = subparsers.add_parser("slack", help="Manage and run the Podarcis Slack agent")
    slack_sub = slack_parser.add_subparsers(dest="slack_action")
    slack_sub.add_parser("status", help="Show Slack bot configuration and knowledge status")
    slack_sub.add_parser("start", help="Start the Slack bot in Socket Mode")

    cfg_parser = slack_sub.add_parser("config", help="Configure Slack tokens and LLM API keys")
    cfg_parser.add_argument("--bot-token", help="Slack Bot User OAuth Token (xoxb-...)")
    cfg_parser.add_argument("--app-token", help="Slack App Token for Socket Mode (xapp-...)")
    cfg_parser.add_argument("--provider", choices=["opencode", "openai", "anthropic"], help="LLM Provider (default: opencode)")
    cfg_parser.add_argument("--base-url", help="OpenCode / OpenAI-compatible Base URL (e.g. http://localhost:8000/v1)")
    cfg_parser.add_argument("--api-key", help="LLM API Key (Optional for local OpenCode)")
    cfg_parser.add_argument("--model", help="LLM Model Name (e.g. opencode, deepseek-coder, etc.)")

    q_parser = slack_sub.add_parser("query", help="Test a research query against the knowledge base from CLI")
    q_parser.add_argument("prompt", help="Question or prompt to test (e.g. 'summarize last 7 days')")

    # service
    svc_parser = subparsers.add_parser("service", help="Manage systemd services (server or slack daemon)")
    svc_parser.add_argument("service_action", choices=["start", "stop", "restart", "status", "enable", "disable"], help="Action to perform")
    svc_parser.add_argument("--slack", action="store_true", help="Target podarcisnest-slack.service instead of podarcisnest.service")

    args = parser.parse_args()

    if args.command == "status":
        cmd_status(args)
    elif args.command == "run":
        cmd_run(args)
    elif args.command == "user":
        cmd_user(args)
    elif args.command == "sync-templates":
        cmd_sync_templates(args)
    elif args.command == "slack":
        cmd_slack(args)
    elif args.command == "service":
        cmd_service(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
