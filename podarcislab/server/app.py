"""PodarcisLab Server - Multi-User Reverse Proxy, Auth, and Container Gateway."""

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
from starlette.websockets import WebSocket

import httpx

from podarcislab.server.user_manager import UserManager

root_dir = Path(__file__).resolve().parent.parent.parent
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
user_manager = UserManager(root_dir)


async def route_home(request):
    user = request.session.get("user")
    if user:
        if user == "admin":
            return RedirectResponse(url="/admin")
        return RedirectResponse(url=f"/user/{user}/")
    return RedirectResponse(url="/login")


async def route_login_get(request):
    error = request.query_params.get("error")
    return templates.TemplateResponse("login.html", {"request": request, "error": error})


async def route_login_post(request):
    form = await request.form()
    username = str(form.get("username", "")).strip().lower()
    password = str(form.get("password", ""))

    if not username or not password:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Username and password are required."})

    user_info = user_manager.authenticate_user(username, password)
    if not user_info:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Invalid username or password."})

    user_manager.start_user_container(username)

    request.session["user"] = username
    if user_info.get("role") == "admin":
        return RedirectResponse(url="/admin", status_code=303)
    return RedirectResponse(url=f"/user/{username}/", status_code=303)


async def route_logout(request):
    request.session.clear()
    return RedirectResponse(url="/login")


async def route_admin_get(request):
    user = request.session.get("user")
    if user != "admin":
        return RedirectResponse(url="/login?error=Admin+access+required")

    users_registry = user_manager.get_users_registry()
    containers = user_manager.list_containers()
    container_map = {c.get("username"): c for c in containers}

    user_list = []
    for uname, udata in users_registry.items():
        c_info = container_map.get(uname, {})
        user_list.append({
            "username": uname,
            "role": udata.get("role", "user"),
            "status": c_info.get("status", "Stopped"),
            "port": c_info.get("port", "—"),
            "created_at": udata.get("created_at", "—"),
        })

    return templates.TemplateResponse("admin.html", {
        "request": request,
        "users": user_list,
    })


async def route_admin_create_user(request):
    user = request.session.get("user")
    if user != "admin":
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
    user = request.session.get("user")
    if user != "admin":
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    data = await request.json()
    username = data.get("username", "")

    try:
        user_manager.delete_user(username)
        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def route_admin_restart_container(request):
    user = request.session.get("user")
    if user != "admin":
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    data = await request.json()
    username = data.get("username", "")

    try:
        res = user_manager.start_user_container(username)
        return JSONResponse({"success": True, "container": res})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def route_user_proxy(request):
    session_user = request.session.get("user")
    target_user = request.path_params.get("username")
    subpath = request.path_params.get("path", "")

    if not session_user:
        return RedirectResponse(url="/login")

    if session_user != "admin" and session_user != target_user:
        return Response("Forbidden: Access restricted to assigned user workspace.", status_code=403)

    container = user_manager.get_container_for_user(target_user)
    if not container or not container.get("port"):
        container = user_manager.start_user_container(target_user)

    target_port = container.get("port")
    if not target_port:
        return HTMLResponse(f"<h3>Container starting up or unavailable for {target_user}. Please refresh in a moment.</h3>", status_code=503)

    target_url = f"http://127.0.0.1:{target_port}/{subpath}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    headers = dict(request.headers)
    headers.pop("host", None)

    async with httpx.AsyncClient() as client:
        try:
            req_content = await request.body()
            proxy_res = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=req_content,
                follow_redirects=False,
                timeout=60.0,
            )
            return Response(
                content=proxy_res.content,
                status_code=proxy_res.status_code,
                headers=dict(proxy_res.headers),
            )
        except httpx.RequestError as e:
            return HTMLResponse(
                f"<h3>Workspace proxy error for user '{target_user}': {str(e)}</h3>"
                f"<p>The target container on port {target_port} may still be booting. Try reloading.</p>",
                status_code=502,
            )


routes = [
    Route("/", route_home),
    Route("/login", route_login_get, methods=["GET"]),
    Route("/login", route_login_post, methods=["POST"]),
    Route("/logout", route_logout),
    Route("/admin", route_admin_get, methods=["GET"]),
    Route("/api/admin/users/create", route_admin_create_user, methods=["POST"]),
    Route("/api/admin/users/delete", route_admin_delete_user, methods=["POST"]),
    Route("/api/admin/containers/restart", route_admin_restart_container, methods=["POST"]),
    Route("/user/{username}/{path:path}", route_user_proxy, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]),
]

secret_key = os.environ.get("PODARCISLAB_SECRET_KEY", "podarcislab-secret-key-change-in-production")
middleware = [
    Middleware(SessionMiddleware, secret_key=secret_key, session_cookie="podarcislab_session"),
]

app = Starlette(debug=True, routes=routes, middleware=middleware)
