import logging

from fastapi import FastAPI, WebSocket

logging.basicConfig(level=logging.INFO)

app = FastAPI()

logger = logging.getLogger(__name__)

active_connections: list[WebSocket] = []

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)

    try:
        while True:
            data = await websocket.receive_json()
            logger.info(f"Received message: {data}")

            if data["type"] == "guardian_selected":
                logger.info(f"Received guardian_selected event with user_id: {data['user_id']}")
                user_id = data["user_id"]
                username = data.get("username", "Unknown")

                for connection in active_connections:
                    await connection.send_json({"type": "guardian_request", "value": user_id, "username": username})

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        active_connections.remove(websocket)
    