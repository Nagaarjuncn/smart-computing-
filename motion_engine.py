import cv2
import mediapipe as mp
import math
import asyncio
import websockets
import threading
import time
import queue
from collections import deque


WEBSOCKET_HOST = "localhost"
WEBSOCKET_PORT = 8765

PINCH_THRESHOLD = 0.05
SWIPE_DISTANCE_THRESHOLD = 0.15
SWIPE_TIME_THRESHOLD = 0.4
SMOOTHING = 0.25

message_queue = queue.Queue()
connected_clients = set()
running = True

mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
)


def calculate_distance(point1, point2):
    return math.sqrt(
        (point1.x - point2.x) ** 2 +
        (point1.y - point2.y) ** 2 +
        (point1.z - point2.z) ** 2
    )


def clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


class GestureDetector:

    def __init__(self):
        self.history = deque()
        self.previous_pinch = False
        self.smoothed_x = 0.5
        self.smoothed_y = 0.5
        self.last_swipe_time = 0

    def reset(self):
        self.history.clear()
        self.previous_pinch = False

    def calculate_cursor(self, index_tip):
        raw_x = clamp(index_tip.x, 0, 1)
        raw_y = clamp(index_tip.y, 0, 1)

        self.smoothed_x = (
            self.smoothed_x * (1 - SMOOTHING)
            + raw_x * SMOOTHING
        )
        self.smoothed_y = (
            self.smoothed_y * (1 - SMOOTHING)
            + raw_y * SMOOTHING
        )

        screen_x = int(self.smoothed_x * 1000)
        screen_y = int(self.smoothed_y * 1000)

        return screen_x, screen_y

    def detect_pinch(self, thumb_tip, index_tip):
        distance = calculate_distance(thumb_tip, index_tip)
        pinch_detected = distance < PINCH_THRESHOLD

        click = pinch_detected and not self.previous_pinch
        self.previous_pinch = pinch_detected
        return click

    def detect_swipe(self, index_tip):
        current_x = index_tip.x
        current_time = time.time()

        if current_time - self.last_swipe_time < 0.6:
            self.history.clear()
            return None

        self.history.append((current_x, current_time))

        # Discard tracking points older than the time window
        while self.history and (current_time - self.history[0][1] > SWIPE_TIME_THRESHOLD):
            self.history.popleft()

        if len(self.history) < 3:
            return None

        start_x, start_time = self.history[0]
        delta_x = current_x - start_x
        delta_time = current_time - start_time

        if delta_time <= 0:
            return None

        velocity = abs(delta_x) / delta_time

        if (
            abs(delta_x) >= SWIPE_DISTANCE_THRESHOLD
            and delta_time <= SWIPE_TIME_THRESHOLD
            and velocity > 0.4
        ):
            self.last_swipe_time = current_time
            self.history.clear()

            if delta_x > 0:
                return "SWIPE_RIGHT"
            return "SWIPE_LEFT"

        return None


def send_message(message):
    message_queue.put(message)


async def broadcast_message(message):
    if not connected_clients:
        return

    disconnected_clients = set()
    for client in list(connected_clients):
        try:
            await client.send(message)
        except Exception:
            disconnected_clients.add(client)

    for client in disconnected_clients:
        connected_clients.discard(client)


async def websocket_handler(websocket):
    print("Frontend connected.")
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print("Frontend disconnected.")


async def message_dispatcher():
    while running:
        while not message_queue.empty():
            try:
                msg = message_queue.get_nowait()
                await broadcast_message(msg)
            except queue.Empty:
                break
        await asyncio.sleep(0.01)


async def websocket_server():
    print(
        f"WebSocket server running at "
        f"ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}"
    )
    async with websockets.serve(
        websocket_handler,
        WEBSOCKET_HOST,
        WEBSOCKET_PORT
    ):
        await message_dispatcher()


def start_websocket_server():
    asyncio.run(websocket_server())


def motion_engine():
    global running

    detector = GestureDetector()
    camera = cv2.VideoCapture(0)

    if not camera.isOpened():
        print("ERROR: Could not open webcam.")
        return

    print("Webcam started.")
    print("Starting gesture detection...")

    while running:
        success, frame = camera.read()
        if not success:
            print("ERROR: Could not read webcam frame.")
            break

        frame = cv2.flip(frame, 1)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)

        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                mp_drawing.draw_landmarks(
                    frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS
                )

                thumb_tip = hand_landmarks.landmark[4]
                index_tip = hand_landmarks.landmark[8]

                cursor_x, cursor_y = detector.calculate_cursor(index_tip)

                click_detected = detector.detect_pinch(thumb_tip, index_tip)
                if click_detected:
                    send_message("CLICK")
                    cv2.putText(
                        frame,
                        "CLICK",
                        (50, 80),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1,
                        (0, 255, 0),
                        3
                    )

                swipe = detector.detect_swipe(index_tip)
                if swipe:
                    send_message(swipe)
                    cv2.putText(
                        frame,
                        swipe,
                        (50, 130),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        1,
                        (255, 0, 0),
                        3
                    )

                h, w, _ = frame.shape
                index_x = int(index_tip.x * w)
                index_y = int(index_tip.y * h)

                cv2.circle(
                    frame,
                    (index_x, index_y),
                    10,
                    (0, 255, 255),
                    -1
                )
        else:
            detector.reset()

        cv2.putText(
            frame,
            "Touchless Gesture Control",
            (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (255, 255, 255),
            2
        )

        cv2.imshow("Motion Engine", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            running = False

    camera.release()
    cv2.destroyAllWindows()
    hands.close()
    print("Motion engine stopped.")


def main():
    print("=" * 60)
    print(" TOUCHLESS GESTURE CONTROL SMART COMPUTER INTERFACE")
    print("=" * 60)

    websocket_thread = threading.Thread(
        target=start_websocket_server,
        daemon=True
    )
    websocket_thread.start()

    time.sleep(0.5)
    motion_engine()


if __name__ == "__main__":
    main()