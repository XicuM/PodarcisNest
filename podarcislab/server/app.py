"""PodarcisLab Server - Multi-User Reverse Proxy, Orthogonal Admin Portal, and Container Gateway."""

import asyncio
import os
import sys
from pathlib import Path
from typing import Any, Dict

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import HTMLResponse, RedirectResponse, Response, JSONResponse
from starlette.routing import Route, Mount, WebSocketRoute
from starlette.templating import Jinja2Templates
from starlette.websockets import WebSocket, WebSocketDisconnect

import httpx
import websockets

from podarcislab.server.user_manager import UserManager
from podarcislab.server.seeder import seed_user_workspace

root_dir = Path(__file__).resolve().parent.parent.parent
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
user_manager = UserManager(root_dir)


async def route_home(request):
    """Main portal landing page."""
    if request.session.get("is_admin"):
        return RedirectResponse(url="/admin")
    
    users_registry = user_manager.get_users_registry()
    containers = user_manager.list_containers()
    container_map = {c.get("username"): c for c in containers}

    user_list = []
    for uname, udata in users_registry.items():
        if uname == "admin":
            continue
        c_info = container_map.get(uname, {})
        user_list.append({
            "username": uname,
            "role": udata.get("role", "user"),
            "status": c_info.get("status", "Stopped"),
            "port": c_info.get("port", "—"),
        })

    # Render landing page or redirect to admin login if no users
    return templates.TemplateResponse(request=request, name="login.html", context={
        "users": user_list,
        "error": request.query_params.get("error"),
    })


async def route_admin_login_get(request):
    """Admin Login Page."""
    if request.session.get("is_admin"):
        return RedirectResponse(url="/admin")
    error = request.query_params.get("error")
    users_registry = user_manager.get_users_registry()
    user_list = [
        {"username": uname} for uname in users_registry if uname != "admin"
    ]
    return templates.TemplateResponse(request=request, name="login.html", context={"error": error, "users": user_list})


async def route_admin_login_post(request):
    """Process Admin Login."""
    form = await request.form()
    password = str(form.get("password", ""))

    if not password:
        return templates.TemplateResponse(request=request, name="login.html", context={"error": "Admin password is required."})

    if not user_manager.authenticate_admin(password):
        return templates.TemplateResponse(request=request, name="login.html", context={"error": "Invalid admin password."})

    request.session["is_admin"] = True
    return RedirectResponse(url="/admin", status_code=303)


async def route_admin_logout(request):
    """Admin Logout."""
    request.session.clear()
    return RedirectResponse(url="/login")


async def route_admin_get(request):
    """Admin Dashboard."""
    if not request.session.get("is_admin"):
        return RedirectResponse(url="/login?error=Admin+access+required")

    users_registry = user_manager.get_users_registry()
    containers = user_manager.list_containers()
    container_map = {c.get("username"): c for c in containers}

    user_list = []
    for uname, udata in users_registry.items():
        if uname == "admin":
            continue
        c_info = container_map.get(uname, {})
        user_list.append({
            "username": uname,
            "role": udata.get("role", "user"),
            "status": c_info.get("status", "Stopped"),
            "port": c_info.get("port", "—"),
            "created_at": udata.get("created_at", "—"),
            "password": udata.get("password", "—"),
        })

    return templates.TemplateResponse(request=request, name="admin.html", context={"users": user_list})


async def route_admin_create_user(request):
    if not request.session.get("is_admin"):
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    data = await request.json()
    username = data.get("username", "").strip().lower()
    role = data.get("role", "user")
    password = data.get("password") or None

    try:
        user_info = user_manager.create_user(username, role=role, password=password)
        return JSONResponse({"success": True, "user": user_info})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def route_admin_delete_user(request):
    if not request.session.get("is_admin"):
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    data = await request.json()
    username = data.get("username", "")

    try:
        user_manager.delete_user(username)
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def route_admin_restart_container(request):
    if not request.session.get("is_admin"):
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    data = await request.json()
    username = data.get("username", "")

    try:
        res = user_manager.start_user_container(username)
        return JSONResponse({"success": True, "container": res})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def route_admin_reseed_workspace(request):
    if not request.session.get("is_admin"):
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    data = await request.json()
    username = data.get("username", "")

    try:
        ws = user_manager.get_user_workspace(username)
        seed_user_workspace(ws, username, root_dir)
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def route_user_proxy(request):
    """HTTP Reverse Proxy forwarding directly to VS Code Web (code-server)."""
    target_user = request.path_params.get("username")
    subpath = request.path_params.get("path", "")

    if target_user == "admin":
        return RedirectResponse(url="/admin")

    container = user_manager.get_container_for_user(target_user)
    if not container or not container.get("port"):
        container = user_manager.start_user_container(target_user)

    target_port = container.get("port")
    if not target_port:
        return HTMLResponse(
            f"<h3>VS Code container starting up for '{target_user}'. Please refresh in a few seconds...</h3>",
            status_code=503,
        )

    target_url = f"http://127.0.0.1:{target_port}/{subpath}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    headers = dict(request.headers)
    headers.pop("host", None)
    headers.pop("accept-encoding", None)
    headers.pop("content-length", None)
    headers["x-forwarded-host"] = request.headers.get("host", "localhost:8080")
    headers["x-forwarded-proto"] = request.url.scheme
    headers["x-forwarded-prefix"] = f"/user/{target_user}"
    if request.client:
        headers["x-forwarded-for"] = request.client.host

    async with httpx.AsyncClient() as client:
        try:
            req_content = await request.body()
            proxy_res = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=req_content,
                follow_redirects=False,
                timeout=120.0,
            )
            hop_by_hop = {
                "connection", "keep-alive", "proxy-authenticate",
                "proxy-authorization", "te", "trailers", "transfer-encoding",
                "upgrade", "content-encoding", "content-length"
            }
            response_headers = {
                k: v for k, v in proxy_res.headers.items()
                if k.lower() not in hop_by_hop
            }
            response_headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response_headers["Pragma"] = "no-cache"
            response_headers["Expires"] = "0"
            return Response(
                content=proxy_res.content,
                status_code=proxy_res.status_code,
                headers=response_headers,
            )
        except httpx.RequestError as e:
            return HTMLResponse(
                f"<h3>VS Code Web proxy connecting to '{target_user}'...</h3>"
                f"<p>The container on port {target_port} is initializing. Please reload.</p>"
                f"<small>{str(e)}</small>",
                status_code=502,
            )


async def route_user_ws_proxy(websocket: WebSocket):
    """WebSocket Proxy forwarding directly to VS Code Web (code-server)."""
    target_user = websocket.path_params.get("username")
    subpath = websocket.path_params.get("path", "")

    if target_user == "admin":
        await websocket.close(code=1008)
        return

    container = user_manager.get_container_for_user(target_user)
    if not container or not container.get("port"):
        container = user_manager.start_user_container(target_user)

    target_port = container.get("port")
    if not target_port:
        await websocket.close(code=1011)
        return

    target_ws_url = f"ws://127.0.0.1:{target_port}/{subpath}"
    if websocket.url.query:
        target_ws_url += f"?{websocket.url.query}"

    ws_headers = {}
    if "cookie" in websocket.headers:
        ws_headers["Cookie"] = websocket.headers["cookie"]
    if "origin" in websocket.headers:
        ws_headers["Origin"] = websocket.headers["origin"]
    if "user-agent" in websocket.headers:
        ws_headers["User-Agent"] = websocket.headers["user-agent"]
    ws_headers["X-Forwarded-Host"] = websocket.headers.get("host", "localhost:8080")
    ws_headers["X-Forwarded-Proto"] = websocket.url.scheme
    ws_headers["X-Forwarded-Prefix"] = f"/user/{target_user}"

    subprotocols = None
    if "sec-websocket-protocol" in websocket.headers:
        subprotocols = [s.strip() for s in websocket.headers["sec-websocket-protocol"].split(",") if s.strip()]

    try:
        kwargs = {"additional_headers": ws_headers, "max_size": None}
        if subprotocols:
            kwargs["subprotocols"] = subprotocols

        target_ws = await websockets.connect(target_ws_url, **kwargs)
    except Exception:
        await websocket.close(code=1011)
        return

    selected_subprotocol = target_ws.subprotocol
    await websocket.accept(subprotocol=selected_subprotocol)

    try:
        async def forward_client_to_target():
            try:
                while True:
                    msg = await websocket.receive()
                    if "text" in msg and msg["text"] is not None:
                        await target_ws.send(msg["text"])
                    elif "bytes" in msg and msg["bytes"] is not None:
                        await target_ws.send(msg["bytes"])
            except (WebSocketDisconnect, asyncio.CancelledError):
                pass

        async def forward_target_to_client():
            try:
                async for msg in target_ws:
                    if isinstance(msg, str):
                        await websocket.send_text(msg)
                    else:
                        await websocket.send_bytes(msg)
            except (WebSocketDisconnect, asyncio.CancelledError):
                pass

        await asyncio.gather(forward_client_to_target(), forward_target_to_client())
    except Exception:
        pass
    finally:
        try:
            await target_ws.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


routes = [
    Route("/", route_home),
    Route("/login", route_admin_login_get, methods=["GET"]),
    Route("/login", route_admin_login_post, methods=["POST"]),
    Route("/admin/login", route_admin_login_get, methods=["GET"]),
    Route("/admin/login", route_admin_login_post, methods=["POST"]),
    Route("/logout", route_admin_logout),
    Route("/admin/logout", route_admin_logout),
    Route("/admin", route_admin_get, methods=["GET"]),
    Route("/api/admin/users/create", route_admin_create_user, methods=["POST"]),
    Route("/api/admin/users/delete", route_admin_delete_user, methods=["POST"]),
    Route("/api/admin/users/reseed", route_admin_reseed_workspace, methods=["POST"]),
    Route("/api/admin/containers/restart", route_admin_restart_container, methods=["POST"]),
    Route("/user/{username}/{path:path}", route_user_proxy, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]),
    WebSocketRoute("/user/{username}/{path:path}", route_user_ws_proxy),
]

secret_key = os.environ.get("PODARCISLAB_SECRET_KEY", "podarcislab-secret-key-change-in-production")
middleware = [
    Middleware(SessionMiddleware, secret_key=secret_key, session_cookie="podarcislab_session"),
]

app = Starlette(debug=True, routes=routes, middleware=middleware)

