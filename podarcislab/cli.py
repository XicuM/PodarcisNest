"""PodarcisLab Debug & Maintenance CLI."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

from rich.console import Console
from rich.table import Table

from podarcislab.server.user_manager import UserManager

console = Console()
root_dir = Path(__file__).resolve().parent.parent


def cmd_status(args):
    """Check service status and active containers."""
    console.print("[bold cyan]PodarcisLab Status[/bold cyan]\n")

    # Check systemd status
    res = subprocess.run(["systemctl", "is-active", "podarcislab"], capture_output=True, text=True)
    state = res.stdout.strip() if res.returncode == 0 else "inactive / not-installed"
    color = "green" if state == "active" else "yellow"
    console.print(f"Systemd Service: [{color}]{state}[/{color}]")

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
    console.print(f"[bold green]Starting PodarcisLab server on http://{args.host}:{args.port} (Foreground Debug Mode)[/bold green]")
    uvicorn.run("podarcislab.server.app:app", host=args.host, port=args.port, reload=args.reload)


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


def cmd_service(args):
    """Control systemctl service."""
    action = args.service_action
    console.print(f"Executing: systemctl {action} podarcislab...")
    res = subprocess.run(["systemctl", action, "podarcislab"])
    if res.returncode == 0:
        console.print(f"[bold green]✓ Successfully executed {action} on podarcislab.service[/bold green]")
    else:
        console.print(f"[bold red]Failed to {action} podarcislab.service (try with sudo or check journalctl)[/bold red]")


def main():
    parser = argparse.ArgumentParser(prog="podarcislab", description="PodarcisLab Multi-User Hub CLI")
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

    del_parser = user_sub.add_parser("delete", help="Delete user")
    del_parser.add_argument("username", help="Username")

    pwd_parser = user_sub.add_parser("password", help="Reset user password")
    pwd_parser.add_argument("username", help="Username")
    pwd_parser.add_argument("password", help="New password")

    # service
    svc_parser = subparsers.add_parser("service", help="Manage systemd service")
    svc_parser.add_argument("service_action", choices=["start", "stop", "restart", "status"], help="Action to perform")

    args = parser.parse_args()

    if args.command == "status":
        cmd_status(args)
    elif args.command == "run":
        cmd_run(args)
    elif args.command == "user":
        cmd_user(args)
    elif args.command == "service":
        cmd_service(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
