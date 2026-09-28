import cv2
import mediapipe as mp
import math
import asyncio
import websockets
import threading
import time
import queue
import sys
import ctypes
from collections import deque


WEBSOCKET_HOST = "localhost"
WEBSOCKET_PORT = 8765

PINCH_THRESHOLD = 0.055
SWIPE_DISTANCE_THRESHOLD = 0.15
SWIPE_TIME_THRESHOLD = 0.4
SMOOTHING = 0.40

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


class SystemMouseController:
    """Controls the ACTUAL hardware/operating system mouse cursor on the user's PC."""

    def __init__(self):
        self.is_windows = sys.platform.startswith("win")
        if self.is_windows:
            self.user32 = ctypes.windll.user32
            # Handle DPI awareness so cursor coordinates match true display resolution
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(2)
            except Exception:
                try:
                    self.user32.SetProcessDPIAware()
                except Exception:
                    pass

            self.screen_w = self.user32.GetSystemMetrics(0)
            self.screen_h = self.user32.GetSystemMetrics(1)
        else:
            self.user32 = None
            self.screen_w = 1920
            self.screen_h = 1080

        print(f"System Display Resolution: {self.screen_w} x {self.screen_h}")

        self.smooth_x = float(self.screen_w // 2)
        self.smooth_y = float(self.screen_h // 2)
        self.lerp = SMOOTHING

        # Active boundary margins for comfortable reaching of all 4 corners
        self.pad_x = 0.16
        self.pad_y = 0.18

    def move_cursor(self, raw_norm_x, raw_norm_y):
        """Maps camera normalized coords (0.0 to 1.0) to screen pixels and moves real OS cursor."""
        norm_x = clamp((raw_norm_x - self.pad_x) / (1.0 - 2.0 * self.pad_x), 0.0, 1.0)
        norm_y = clamp((raw_norm_y - self.pad_y) / (1.0 - 2.0 * self.pad_y), 0.0, 1.0)

        target_x = norm_x * self.screen_w
        target_y = norm_y * self.screen_h

        # Exponential moving average for jitter-free glide
        self.smooth_x += (target_x - self.smooth_x) * self.lerp
        self.smooth_y += (target_y - self.smooth_y) * self.lerp

        target_ix = int(self.smooth_x)
        target_iy = int(self.smooth_y)

        if self.is_windows and self.user32:
            self.user32.SetCursorPos(target_ix, target_iy)

        return target_ix, target_iy

    def click(self):
        """Fires an actual physical mouse left-click on the operating system."""
        if self.is_windows and self.user32:
            # MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004
            self.user32.mouse_event(0x0002, 0, 0, 0, 0)
            self.user32.mouse_event(0x0004, 0, 0, 0, 0)


class GestureDetector:

    def __init__(self):
        self.history = deque()
        self.previous_pinch = False
        self.last_swipe_time = 0

    def reset(self):
        self.history.clear()
        self.previous_pinch = False

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
    print("Frontend client connected to Motion Engine WebSocket.")
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print("Frontend client disconnected.")


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
        f"Motion Engine WebSocket server active at "
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

    mouse_controller = SystemMouseController()
    detector = GestureDetector()
    camera = cv2.VideoCapture(0)

    if not camera.isOpened():
        print("ERROR: Could not access webcam. Make sure another application is not using it.")
        return

    print("=" * 60)
    print(" ACTUAL SYSTEM MOUSE CURSOR MOTION CONTROLLER ACTIVE")
    print(" Point with index finger to move real Windows mouse cursor")
    print(" Pinch thumb + index finger to click")
    print(" Press 'q' or 'Esc' in webcam window to quit")
    print("=" * 60)

    while running:
        success, frame = camera.read()
        if not success:
            print("ERROR: Could not read webcam frame.")
            break

        frame = cv2.flip(frame, 1)
        h, w, _ = frame.shape
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = hands.process(rgb_frame)

        status_text = "Tracking hand..."
        status_color = (0, 255, 255)

        if results.multi_hand_landmarks:
            for hand_landmarks in results.multi_hand_landmarks:
                mp_drawing.draw_landmarks(
                    frame,
                    hand_landmarks,
                    mp_hands.HAND_CONNECTIONS
                )

                thumb_tip = hand_landmarks.landmark[4]
                index_tip = hand_landmarks.landmark[8]

                # Move the ACTUAL Windows OS Mouse Cursor!
                # Since frame is flipped, index_tip.x goes 0.0 (left) to 1.0 (right)
                cursor_px, cursor_py = mouse_controller.move_cursor(index_tip.x, index_tip.y)
                send_message(f"MOVE:{cursor_px},{cursor_py}")

                # Pinch-to-click on the actual operating system!
                click_detected = detector.detect_pinch(thumb_tip, index_tip)
                if click_detected:
                    mouse_controller.click()
                    send_message("CLICK")
                    status_text = "SYSTEM CLICK!"
                    status_color = (0, 255, 0)
                    cv2.circle(frame, (int(index_tip.x * w), int(index_tip.y * h)), 25, (0, 255, 0), 4)

                swipe = detector.detect_swipe(index_tip)
                if swipe:
                    send_message(swipe)
                    status_text = f"SWIPE: {swipe}"
                    status_color = (255, 120, 0)

                # Draw index finger tracking beacon
                ix = int(index_tip.x * w)
                iy = int(index_tip.y * h)
                cv2.circle(frame, (ix, iy), 8, (0, 255, 255), -1)
                cv2.putText(
                    frame,
                    f"OS Mouse: ({cursor_px}, {cursor_py})",
                    (ix + 15, iy - 10),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (255, 255, 255),
                    1
                )
        else:
            detector.reset()
            status_text = "Searching for hand in view..."
            status_color = (120, 120, 120)

        # Draw HUD info
        cv2.putText(
            frame,
            "Touchless System Mouse Controller",
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            (255, 255, 255),
            2
        )
        cv2.putText(
            frame,
            status_text,
            (20, 70),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            status_color,
            2
        )
        cv2.putText(
            frame,
            "Press 'q' or 'Esc' to exit",
            (20, h - 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (180, 180, 180),
            1
        )

        cv2.imshow("System Cursor Motion Controller", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord("q") or key == 27:
            running = False

    camera.release()
    cv2.destroyAllWindows()
    hands.close()
    print("Motion engine stopped.")


def main():
    websocket_thread = threading.Thread(
        target=start_websocket_server,
        daemon=True
    )
    websocket_thread.start()

    time.sleep(0.5)
    motion_engine()


if __name__ == "__main__":
    main()