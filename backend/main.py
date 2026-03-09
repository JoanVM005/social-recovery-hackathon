import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Mock user database ──────────────────────────────────────────────────────
# Mirrors DEMO_PARTY_IDS and FRIENDS in the frontend.
# party_id values must match the IDs returned by registerParty() on Sepolia
# (owner registers first → ID 1; guardians register in order → IDs 2-7).
MOCK_USERS: dict[str, dict] = {
    "Alex":   {"party_id": 2, "role": "guardian"},
    "Maria":  {"party_id": 3, "role": "guardian"},
    "Sam":    {"party_id": 4, "role": "guardian"},
    "Jordan": {"party_id": 5, "role": "guardian"},
    "Casey":  {"party_id": 6, "role": "guardian"},
    "Riley":  {"party_id": 7, "role": "guardian"},
}

# ── Connection tracking ─────────────────────────────────────────────────────
# All open sockets.
active_connections: list[WebSocket] = []
# username → WebSocket — lets us route to a specific user by name.
username_connections: dict[str, WebSocket] = {}
# All users who have ever identified on this server instance (incl. non-mock).
# Persists across disconnects so offline users still appear in the list.
dynamic_users: dict[str, dict] = {}
# user_id (UUID from frontend) → WebSocket — lets us route guardian_response
# back to the exact owner window that started the backup flow.
requester_connections: dict[str, WebSocket] = {}
# Reverse lookups used for cleanup on disconnect.
connection_usernames: dict[WebSocket, str] = {}
connection_requester_ids: dict[WebSocket, str] = {}


def _remove_connection(ws: WebSocket) -> None:
    """Remove a socket from every tracking structure."""
    try:
        active_connections.remove(ws)
    except ValueError:
        pass

    username = connection_usernames.pop(ws, None)
    if username and username_connections.get(username) is ws:
        del username_connections[username]

    user_id = connection_requester_ids.pop(ws, None)
    if user_id and requester_connections.get(user_id) is ws:
        del requester_connections[user_id]


# ── HTTP endpoints ──────────────────────────────────────────────────────────

@app.get("/users")
async def list_users():
    """Return all known users (mock + anyone who has ever connected)."""
    merged: dict[str, dict] = {}
    for name, info in MOCK_USERS.items():
        merged[name] = {
            "username": name,
            "party_id": info["party_id"],
            "role": info["role"],
            "online": name in username_connections,
        }
    for name, info in dynamic_users.items():
        if name not in merged:
            merged[name] = {
                "username": name,
                "party_id": info.get("party_id"),
                "role": info.get("role", "user"),
                "online": name in username_connections,
            }
    return {"users": list(merged.values())}


# ── WebSocket endpoint ──────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            logger.info(f"[WS] {msg_type}: {data}")

            # ── identify ─────────────────────────────────────────────────
            # Client announces who it is so the server can route messages to it.
            if msg_type == "identify":
                username = (data.get("username") or "").strip()
                if not username:
                    continue

                # Deregister any previous identity on this socket.
                old = connection_usernames.get(websocket)
                if old and username_connections.get(old) is websocket:
                    del username_connections[old]

                connection_usernames[websocket] = username
                username_connections[username] = websocket

                # Register in dynamic_users if not already tracked.
                if username not in MOCK_USERS and username not in dynamic_users:
                    dynamic_users[username] = {"party_id": None, "role": "user"}

                user_info = MOCK_USERS.get(username)
                await websocket.send_json({
                    "type": "identified",
                    "username": username,
                    "party_id": user_info["party_id"] if user_info else None,
                    "known": user_info is not None,
                })
                logger.info(
                    f"[WS] '{username}' identified "
                    f"(party_id={user_info['party_id'] if user_info else 'unknown'})"
                )

            # ── guardian_selected ─────────────────────────────────────────
            # Owner announces which guardians they picked. Route guardian_request
            # only to those guardian connections; fall back to broadcasting to
            # any unidentified connection (may be a guardian who hasn't identified).
            elif msg_type == "guardian_selected":
                user_id = data["user_id"]
                username = data.get("username", "Unknown")
                selected_names: list[str] = data.get("selected_names", [])

                # Remember this socket as the requester so responses can come back.
                requester_connections[user_id] = websocket
                connection_requester_ids[websocket] = user_id

                payload = {
                    "type": "guardian_request",
                    "value": user_id,
                    "username": username,
                    "selected_names": selected_names,
                }

                routed: set[WebSocket] = set()
                for name in selected_names:
                    target = username_connections.get(name)
                    if target and target is not websocket:
                        await target.send_json(payload)
                        routed.add(target)
                        logger.info(f"[WS] Routed guardian_request → '{name}'")

                # Also send to unidentified connections (backwards-compatible
                # with clients that don't send identify).
                for conn in active_connections:
                    if conn is not websocket and conn not in routed and conn not in connection_usernames:
                        await conn.send_json(payload)

            # ── set_party_id ──────────────────────────────────────────────
            # Client reports their on-chain party ID after querying the contract.
            # Stored so /users can serve it to other clients.
            elif msg_type == "set_party_id":
                pid = data.get("party_id")
                uname = connection_usernames.get(websocket)
                if uname and pid is not None:
                    if uname in dynamic_users:
                        dynamic_users[uname]["party_id"] = int(pid)
                    elif uname not in MOCK_USERS:
                        dynamic_users[uname] = {"party_id": int(pid), "role": "user"}
                    logger.info(f"[WS] '{uname}' set party_id={pid}")

            # ── guardian_response ─────────────────────────────────────────
            # Guardian replied with their secret. Route only to the owner
            # window that made the request.
            elif msg_type == "guardian_response":
                requester_id = data.get("requester_id")
                target = requester_connections.get(requester_id) if requester_id else None

                if target and target in active_connections:
                    await target.send_json(data)
                    logger.info(f"[WS] Routed guardian_response → requester '{requester_id}'")
                else:
                    # Fall back to broadcast (old behaviour / requester not tracked).
                    for conn in active_connections:
                        await conn.send_json(data)

    except WebSocketDisconnect:
        logger.info(
            f"[WS] '{connection_usernames.get(websocket, 'unknown')}' disconnected"
        )
    except Exception as e:
        logger.error(f"[WS] Error: {e}")
    finally:
        _remove_connection(websocket)
