import os
import asyncio
from typing import Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(
    title="Touchless Smart Computing Interface",
    description="Full-stack gesture-controlled smart computing mirror interface",
    version="2.0.0"
)

# Enable CORS for cross-origin or local dev testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket connections
connected_clients: Set[WebSocket] = set()
connection_lock = asyncio.Lock()


async def broadcast(message: str, sender: WebSocket = None):
    """Broadcast a message to all connected WebSocket clients except the sender (if specified)."""
    async with connection_lock:
        clients = list(connected_clients)

    disconnected = []
    for client in clients:
        if client == sender:
            continue
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)

    if disconnected:
        async with connection_lock:
            for client in disconnected:
                connected_clients.discard(client)


@app.get("/health")
async def health_check():
    """Health check endpoint used by Render and uptime monitors."""
    return {
        "status": "healthy",
        "service": "Touchless Smart Computing Interface",
        "version": "2.0.0",
        "active_websocket_clients": len(connected_clients)
    }


@app.get("/api/weather")
async def get_weather():
    """Returns weather information and forecast data."""
    return {
        "city": "San Francisco",
        "condition": "Partly Cloudy",
        "temp_c": 24,
        "humidity": "62%",
        "wind": "14 km/h",
        "forecast": [
            {"day": "Tue", "c": [27, 20], "condition": "Sunny"},
            {"day": "Wed", "c": [25, 19], "condition": "Partly Cloudy"},
            {"day": "Thu", "c": [22, 17], "condition": "Cloudy"},
            {"day": "Fri", "c": [24, 18], "condition": "Mild Breeze"},
        ]
    }


@app.post("/api/gesture")
async def trigger_gesture(gesture: dict):
    """Allows external triggers (e.g. desktop python script or webhooks) to send gestures."""
    action = gesture.get("action", "").strip().upper()
    valid_gestures = {"CLICK", "SWIPE_LEFT", "SWIPE_RIGHT"}
    if action not in valid_gestures:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid gesture '{action}'. Must be one of {valid_gestures}"}
        )

    await broadcast(action)
    return {"status": "dispatched", "gesture": action}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    async with connection_lock:
        connected_clients.add(websocket)
    client_host = websocket.client.host if websocket.client else "unknown"
    print(f"WebSocket client connected from {client_host}. Total: {len(connected_clients)}")

    try:
        while True:
            # Listen for messages from this client (e.g. in-browser gesture detection or desktop engine)
            data = await websocket.receive_text()
            data = data.strip()
            if data:
                # Broadcast the gesture to all other displays
                await broadcast(data, sender=websocket)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        async with connection_lock:
            connected_clients.discard(websocket)
        print(f"WebSocket client disconnected. Total: {len(connected_clients)}")


# Mount static files from frontend directory or repository root
frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
if not os.path.exists(os.path.join(frontend_dir, "index.html")):
    frontend_dir = os.path.dirname(__file__)

if os.path.exists(os.path.join(frontend_dir, "index.html")):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    @app.get("/")
    def index():
        return HTMLResponse("<h1>index.html not found</h1>", status_code=404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting server on 0.0.0.0:{port}...")
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
