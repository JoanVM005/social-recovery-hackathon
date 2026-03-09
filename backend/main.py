from fastapi import FastAPI, WebSocket

app = FastAPI()

active_connections: list[WebSocket] = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)

    try:
        while True:
            data = await websocket.receive_json()

            if data["type"] == "guardian_selected":
                user_id = data["user_id"]

                for connection in active_connections:
                    await connection.send_json({"type": "guardian_request", "value": user_id})

    except Exception:
        active_connections.remove(websocket)
    