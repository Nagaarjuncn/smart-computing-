// --- Dynamic WebSocket Connection ---
const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const host = window.location.host;
const WS_URL = window.location.origin.startsWith("http")
    ? `${protocol}//${host}/ws`
    : "ws://localhost:8000/ws";

// --- DOM Elements ---
const airCursorEl = document.getElementById("air-cursor");
const cursorLabelEl = document.getElementById("cursor-label");
const cursorStatusHint = document.getElementById("cursor-status-hint");

// --- Gallery Management ---
const slides = document.querySelectorAll(".slide");
const dotsEl = document.getElementById("dots");
let currentSlideIndex = 0;

if (dotsEl) {
    slides.forEach((_, i) => {
        const dot = document.createElement("i");
        dot.title = `Slide ${i + 1}`;
        dot.setAttribute("role", "button");
        dot.setAttribute("tabindex", "0");
        dot.addEventListener("click", () => showSlide(i));
        dotsEl.appendChild(dot);
    });
}
const dots = dotsEl ? dotsEl.querySelectorAll("i") : [];

function showSlide(n) {
    if (!slides.length) return;
    currentSlideIndex = ((n % slides.length) + slides.length) % slides.length;
    slides.forEach(s => s.style.setProperty("--i", currentSlideIndex));
    dots.forEach((d, i) => d.classList.toggle("on", i === currentSlideIndex));
}
showSlide(0);

// Allow clicking directly on slides to advance
slides.forEach(slide => {
    slide.addEventListener("click", () => {
        showSlide(currentSlideIndex + 1);
        announce("SWIPE_LEFT");
    });
});

// --- Weather Service ---
let weatherData = {
    tempC: 24,
    condition: "Partly Cloudy",
    city: "San Francisco",
    humidity: "62%",
    wind: "14 km/h",
    forecast: [
        { day: "Tue", c: [27, 20] },
        { day: "Wed", c: [25, 19] },
        { day: "Thu", c: [22, 17] },
        { day: "Fri", c: [24, 18] },
    ]
};
let useCelsius = true;

const toFahrenheit = c => Math.round((c * 9) / 5 + 32);
const formatTemp = c => (useCelsius ? Math.round(c) : toFahrenheit(c));

function renderWeather() {
    const tempEl = document.getElementById("temp");
    const degEl = document.getElementById("deg");
    const condEl = document.getElementById("condition");
    const cityEl = document.getElementById("city-name");
    const forecastEl = document.getElementById("forecast");
    const humidityEl = document.getElementById("humidity");
    const windEl = document.getElementById("wind");

    if (tempEl) tempEl.textContent = formatTemp(weatherData.tempC);
    if (degEl) degEl.textContent = useCelsius ? "°C" : "°F";
    if (condEl) condEl.textContent = weatherData.condition;
    if (cityEl) cityEl.textContent = weatherData.city;
    if (humidityEl) humidityEl.textContent = weatherData.humidity;
    if (windEl) windEl.textContent = weatherData.wind;

    if (forecastEl && weatherData.forecast) {
        forecastEl.innerHTML = weatherData.forecast
            .map(f => `
                <li>
                    <span class="day">${f.day}</span>
                    <span class="hi">${formatTemp(f.c[0])}°</span>
                    <span class="lo">${formatTemp(f.c[1])}°</span>
                </li>
            `)
            .join("");
    }
}
renderWeather();

// Fetch live weather data from backend API if available
async function fetchWeatherApi() {
    try {
        const res = await fetch("/api/weather");
        if (res.ok) {
            const data = await res.json();
            weatherData.city = data.city || weatherData.city;
            weatherData.condition = data.condition || weatherData.condition;
            weatherData.tempC = data.temp_c ?? weatherData.tempC;
            weatherData.humidity = data.humidity || weatherData.humidity;
            weatherData.wind = data.wind || weatherData.wind;
            if (Array.isArray(data.forecast)) {
                weatherData.forecast = data.forecast;
            }
            renderWeather();
        }
    } catch (_) {
        // Fallback to initial local demo data
    }
}
fetchWeatherApi();

// --- Clock & Date ---
const clockEl = document.getElementById("clock");
const dateLabelEl = document.getElementById("date-label");

function updateTime() {
    const now = new Date();
    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (dateLabelEl) {
        dateLabelEl.textContent = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    }
}
updateTime();
setInterval(updateTime, 1000);

// --- Gesture Announcer & Visual Feedback ---
const gestureAnnouncerEl = document.getElementById("gesture-announcer");
const gestureTextEl = document.getElementById("gesture");
const gestureIconEl = document.getElementById("gesture-icon");
const statusPillEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");

const gestureMetadata = {
    SWIPE_LEFT: { label: "Next Photo (Swipe Left)", icon: "👉" },
    SWIPE_RIGHT: { label: "Previous Photo (Swipe Right)", icon: "👈" },
    CLICK: { label: "Air Click / Pinch", icon: "👌" },
    CURSOR_MOVE: { label: "Air Cursor Active", icon: "👆" }
};

function announce(gestureKey) {
    const meta = gestureMetadata[gestureKey] || { label: gestureKey, icon: "✨" };
    if (gestureTextEl) gestureTextEl.textContent = meta.label;
    if (gestureIconEl) gestureIconEl.textContent = meta.icon;

    if (gestureAnnouncerEl) {
        gestureAnnouncerEl.classList.remove("flash");
        void gestureAnnouncerEl.offsetWidth; // force DOM reflow
        gestureAnnouncerEl.classList.add("flash");
        setTimeout(() => gestureAnnouncerEl.classList.remove("flash"), 600);
    }
}

// Click ripple animation at specific coordinates
function createCursorRipple(x, y) {
    const ripple = document.createElement("div");
    ripple.className = "ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    document.body.appendChild(ripple);

    const cleanup = () => {
        if (ripple.parentNode) ripple.remove();
    };
    ripple.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, 750);
}

// Toggle temperature unit action
function triggerUnitToggle() {
    const unitBtn = document.getElementById("unit");
    if (unitBtn) {
        unitBtn.classList.remove("pressed");
        void unitBtn.offsetWidth;
        unitBtn.classList.add("pressed");
    }
    useCelsius = !useCelsius;
    renderWeather();
}

// Allow mouse click on temperature unit button
document.getElementById("unit")?.addEventListener("click", () => {
    triggerUnitToggle();
    announce("CLICK");
});

// Gesture Execution Logic
function handleGesture(msg) {
    if (!msg) return;
    const cleanMsg = msg.trim().toUpperCase();

    if (cleanMsg.startsWith("MOVE:")) {
        // Desktop Python engine cursor coordinates (MOVE:x,y in 0-1000 range)
        const parts = cleanMsg.substring(5).split(",");
        if (parts.length === 2) {
            const rx = parseFloat(parts[0]);
            const ry = parseFloat(parts[1]);
            if (!isNaN(rx) && !isNaN(ry)) {
                targetCursorX = (rx / 1000) * window.innerWidth;
                targetCursorY = (ry / 1000) * window.innerHeight;
                if (airCursorEl) airCursorEl.classList.remove("hidden");
                isHandPresent = true;
                lastHandSeenTime = Date.now();
            }
        }
        return;
    }

    switch (cleanMsg) {
        case "SWIPE_RIGHT":
            showSlide(currentSlideIndex - 1);
            break;
        case "SWIPE_LEFT":
            showSlide(currentSlideIndex + 1);
            break;
        case "CLICK":
            performAirClick(currentCursorX, currentCursorY);
            break;
        default:
            return;
    }
    announce(cleanMsg);
}

// Central dispatcher: executes gesture locally and relays to WebSocket
function dispatchGesture(action) {
    handleGesture(action);
    if (socket && socket.readyState === WebSocket.OPEN) {
        try {
            socket.send(action);
        } catch (_) { }
    }
}

// --- WebSocket Auto-Sync ---
let socket = null;
let reconnectTimer = null;

function connectWebSocket() {
    if (socket) {
        try { socket.close(); } catch (_) { }
    }

    try {
        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            if (statusPillEl) statusPillEl.dataset.state = "on";
            if (statusTextEl) statusTextEl.textContent = "Live Cloud Sync";
            const badge = document.getElementById("server-badge");
            if (badge) badge.textContent = "Connected to Server";
        };

        socket.onmessage = (event) => {
            handleGesture(String(event.data).trim());
        };

        socket.onclose = () => {
            if (statusPillEl) statusPillEl.dataset.state = "off";
            if (statusTextEl) statusTextEl.textContent = "Offline Mode";
            const badge = document.getElementById("server-badge");
            if (badge) badge.textContent = "Local Standalone Mode";

            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectWebSocket, 3000);
        };

        socket.onerror = () => {
            // Handled cleanly via onclose
        };
    } catch (_) {
        if (statusPillEl) statusPillEl.dataset.state = "off";
        if (statusTextEl) statusTextEl.textContent = "Standalone";
    }
}
connectWebSocket();

// Keyboard Fallback for Testing / Accessibility
window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") dispatchGesture("SWIPE_LEFT");
    if (e.key === "ArrowLeft") dispatchGesture("SWIPE_RIGHT");
    if (e.key === " ") {
        e.preventDefault();
        performAirClick(currentCursorX, currentCursorY);
        dispatchGesture("CLICK");
    }
});

// ============================================================
// TOUCHLESS AIR CURSOR PHYSICS & INTERACTION ENGINE
// ============================================================
let currentCursorX = window.innerWidth / 2;
let currentCursorY = window.innerHeight / 2;
let targetCursorX = currentCursorX;
let targetCursorY = currentCursorY;
let isHandPresent = false;
let lastHandSeenTime = 0;
const LERP_FACTOR = 0.36; // Butter-smooth exponential moving average

// Perform a real DOM click at the air cursor's coordinates
function performAirClick(x, y) {
    createCursorRipple(x, y);

    // Hide cursor temporarily to inspect underlying element
    if (airCursorEl) airCursorEl.style.display = "none";
    const hitElement = document.elementFromPoint(x, y);
    if (airCursorEl) airCursorEl.style.display = "";

    if (hitElement) {
        const clickable = hitElement.closest("button, .slide, .dots i, a, [role='button']");
        if (clickable) {
            clickable.click();
            announce("CLICK");
            return;
        }
        hitElement.click();
    }
    // Default fallback action: toggle temperature unit
    triggerUnitToggle();
    announce("CLICK");
}

// Continuous 60fps render loop for cursor position and hover states
function updateAirCursorLoop() {
    if (isHandPresent || (Date.now() - lastHandSeenTime < 1500)) {
        currentCursorX += (targetCursorX - currentCursorX) * LERP_FACTOR;
        currentCursorY += (targetCursorY - currentCursorY) * LERP_FACTOR;

        if (airCursorEl) {
            airCursorEl.style.setProperty("--cursor-x", `${currentCursorX}px`);
            airCursorEl.style.setProperty("--cursor-y", `${currentCursorY}px`);

            // Check what element is currently under the air cursor
            airCursorEl.style.pointerEvents = "none";
            const hit = document.elementFromPoint(currentCursorX, currentCursorY);
            const clickable = hit ? hit.closest("button, .slide, .dots i, a, [role='button']") : null;

            if (clickable) {
                airCursorEl.classList.add("hovering");
                let label = clickable.getAttribute("title") || clickable.getAttribute("aria-label");
                if (!label) {
                    if (clickable.classList.contains("temp-toggle-btn")) label = "Toggle °C/°F";
                    else if (clickable.classList.contains("slide")) label = "Next Photo";
                    else if (clickable.tagName === "I") label = "Select Slide";
                    else if (clickable.classList.contains("cam-btn")) label = "Toggle Cam";
                    else label = "Click Element";
                }
                if (cursorLabelEl) cursorLabelEl.textContent = label;
            } else {
                airCursorEl.classList.remove("hovering");
            }
        }
    } else {
        if (airCursorEl && !airCursorEl.classList.contains("hidden")) {
            airCursorEl.classList.add("hidden");
            airCursorEl.classList.remove("hovering");
            airCursorEl.classList.remove("pinching");
        }
    }

    requestAnimationFrame(updateAirCursorLoop);
}
requestAnimationFrame(updateAirCursorLoop);

// ============================================================
// IN-BROWSER TOUCHLESS COMPUTER VISION (MediaPipe Hands)
// ============================================================
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("output-canvas");
const canvasCtx = canvasEl ? canvasEl.getContext("2d") : null;
const camToggleBtn = document.getElementById("cam-toggle-btn");
const camBtnText = document.getElementById("cam-btn-text");
const camPlaceholder = document.getElementById("cam-placeholder");
const cameraHud = document.getElementById("camera-hud");
const fpsLabel = document.getElementById("fps-label");

let cameraInstance = null;
let handsInstance = null;
let isCameraActive = false;

// Pinch and Swipe State Tracking
let wasPinching = false;
let swipePoints = [];
let lastSwipeTimestamp = 0;
const PINCH_DISTANCE_THRESHOLD = 0.065;
const SWIPE_DIST_THRESHOLD = 0.13;
const SWIPE_WINDOW_MS = 380;

function processHandLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 9) return;

    isHandPresent = true;
    lastHandSeenTime = Date.now();
    if (airCursorEl) airCursorEl.classList.remove("hidden");

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const now = Date.now();

    // 1. Air Cursor Mapping (Index finger tip coordinates)
    // Video is mirrored horizontally: mirroredX = 1.0 - indexTip.x
    const mirroredX = 1.0 - indexTip.x;
    const rawY = indexTip.y;

    // Boundary calibration with margins for comfortable reach
    const PAD_X = 0.12;
    const PAD_Y = 0.15;
    const normX = Math.max(0, Math.min(1, (mirroredX - PAD_X) / (1 - 2 * PAD_X)));
    const normY = Math.max(0, Math.min(1, (rawY - PAD_Y) / (1 - 2 * PAD_Y)));

    targetCursorX = normX * window.innerWidth;
    targetCursorY = normY * window.innerHeight;

    // 2. Pinch Detection (Clicking with thumb & index tip)
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const pinchDist = Math.hypot(dx, dy);
    const isPinching = pinchDist < PINCH_DISTANCE_THRESHOLD;

    if (airCursorEl) {
        if (isPinching) {
            airCursorEl.classList.add("pinching");
        } else {
            airCursorEl.classList.remove("pinching");
        }
    }

    if (isPinching && !wasPinching) {
        // Trigger air click at current cursor location!
        performAirClick(currentCursorX, currentCursorY);
        dispatchGesture("CLICK");
    }
    wasPinching = isPinching;

    // 3. Horizontal Air Swipe Detection
    if (now - lastSwipeTimestamp < 650) {
        swipePoints = [];
        return;
    }

    swipePoints.push({ x: mirroredX, time: now });
    swipePoints = swipePoints.filter(p => now - p.time <= SWIPE_WINDOW_MS);

    if (swipePoints.length >= 3) {
        const startPoint = swipePoints[0];
        const currentPoint = swipePoints[swipePoints.length - 1];
        const deltaX = currentPoint.x - startPoint.x;
        const deltaTime = (currentPoint.time - startPoint.time) / 1000;

        if (deltaTime > 0.05) {
            const velocity = Math.abs(deltaX) / deltaTime;
            if (Math.abs(deltaX) >= SWIPE_DIST_THRESHOLD && velocity > 0.35) {
                lastSwipeTimestamp = now;
                swipePoints = [];
                // Hand moving right in mirrored view -> SWIPE_RIGHT
                if (deltaX > 0) {
                    dispatchGesture("SWIPE_RIGHT");
                } else {
                    dispatchGesture("SWIPE_LEFT");
                }
            }
        }
    }
}

// Draw cybernetic skeleton mesh on overlay canvas
function drawHandMesh(landmarks) {
    if (!canvasCtx || !canvasEl) return;
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    if (landmarks) {
        // Draw connection lines
        canvasCtx.strokeStyle = "rgba(56, 189, 248, 0.65)";
        canvasCtx.lineWidth = 2.5;

        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8],       // Index
            [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
            [9, 13], [13, 14], [14, 15], [15, 16],// Ring
            [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
            [0, 17]
        ];

        connections.forEach(([p1, p2]) => {
            const pt1 = landmarks[p1];
            const pt2 = landmarks[p2];
            canvasCtx.beginPath();
            canvasCtx.moveTo(pt1.x * canvasEl.width, pt1.y * canvasEl.height);
            canvasCtx.lineTo(pt2.x * canvasEl.width, pt2.y * canvasEl.height);
            canvasCtx.stroke();
        });

        // Draw key landmark nodes
        landmarks.forEach((pt, index) => {
            canvasCtx.beginPath();
            const isTip = (index === 4 || index === 8);
            canvasCtx.arc(pt.x * canvasEl.width, pt.y * canvasEl.height, isTip ? 6 : 3.5, 0, 2 * Math.PI);
            canvasCtx.fillStyle = isTip ? "#34d399" : "#38bdf8";
            canvasCtx.shadowColor = isTip ? "#34d399" : "#38bdf8";
            canvasCtx.shadowBlur = isTip ? 12 : 6;
            canvasCtx.fill();
        });
    }
    canvasCtx.restore();
}

async function startCameraSensor() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera API is not supported in this browser. You can still use the keyboard shortcuts (←, →, Space).");
        return;
    }

    if (typeof Hands === "undefined" || typeof Camera === "undefined") {
        console.warn("MediaPipe library is loading from CDN. Please wait a moment...");
        if (camBtnText) camBtnText.textContent = "Loading AI Vision...";
        setTimeout(startCameraSensor, 1000);
        return;
    }

    try {
        if (!handsInstance) {
            handsInstance = new Hands({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });

            handsInstance.setOptions({
                maxNumHands: 1,
                modelComplexity: 1,
                minDetectionConfidence: 0.65,
                minTrackingConfidence: 0.65
            });

            handsInstance.onResults((results) => {
                if (canvasEl && videoEl) {
                    canvasEl.width = videoEl.videoWidth || 320;
                    canvasEl.height = videoEl.videoHeight || 180;
                }

                if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                    const landmarks = results.multiHandLandmarks[0];
                    processHandLandmarks(landmarks);
                    drawHandMesh(landmarks);
                    if (fpsLabel) fpsLabel.textContent = "CURSOR ACTIVE";
                    if (cursorStatusHint) cursorStatusHint.textContent = "Point & Pinch";
                } else {
                    isHandPresent = false;
                    wasPinching = false;
                    swipePoints = [];
                    drawHandMesh(null);
                    if (fpsLabel) fpsLabel.textContent = "FINDING HAND";
                }
            });
        }

        cameraInstance = new Camera(videoEl, {
            onFrame: async () => {
                if (isCameraActive && handsInstance) {
                    await handsInstance.send({ image: videoEl });
                }
            },
            width: 480,
            height: 270
        });

        await cameraInstance.start();
        isCameraActive = true;

        if (videoEl) videoEl.style.display = "block";
        if (canvasEl) canvasEl.style.display = "block";
        if (camPlaceholder) camPlaceholder.style.display = "none";
        if (camToggleBtn) camToggleBtn.classList.add("active");
        if (camBtnText) camBtnText.textContent = "Disable Camera";
        if (cameraHud) cameraHud.classList.add("live");
        if (fpsLabel) fpsLabel.textContent = "INITIALIZING";

        announce("CLICK");
        if (gestureTextEl) gestureTextEl.textContent = "Air Cursor Live";
    } catch (err) {
        console.error("Camera access failed:", err);
        alert("Camera permission denied or camera not available. You can still test with Arrow Keys & Space.");
        stopCameraSensor();
    }
}

function stopCameraSensor() {
    isCameraActive = false;
    isHandPresent = false;
    if (airCursorEl) airCursorEl.classList.add("hidden");

    if (cameraInstance) {
        try { cameraInstance.stop(); } catch (_) { }
    }

    if (videoEl && videoEl.srcObject) {
        const stream = videoEl.srcObject;
        stream.getTracks().forEach(track => track.stop());
        videoEl.srcObject = null;
    }

    if (videoEl) videoEl.style.display = "none";
    if (canvasEl) canvasEl.style.display = "none";
    if (camPlaceholder) camPlaceholder.style.display = "flex";
    if (camToggleBtn) camToggleBtn.classList.remove("active");
    if (camBtnText) camBtnText.textContent = "Enable Camera";
    if (cameraHud) cameraHud.classList.remove("live");
    if (fpsLabel) fpsLabel.textContent = "STANDBY";
    if (cursorStatusHint) cursorStatusHint.textContent = "Offline";
}

camToggleBtn?.addEventListener("click", () => {
    if (isCameraActive) {
        stopCameraSensor();
    } else {
        startCameraSensor();
    }
});
