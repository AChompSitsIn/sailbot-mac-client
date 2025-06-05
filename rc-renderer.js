const { ipcRenderer } = require("electron");

// Control state
let rudderAngle = 0.0; // -45 to 45 degrees
let sailAngle = 0.0; // 0 to 90 degrees
let windDirection = 0.0; // 0 to 360 degrees

// Key press state
const keysPressed = {
  w: false,
  a: false,
  s: false,
  d: false,
  p: false,
};

// Command queue state
let rudderCommandQueued = false;
let sailCommandQueued = false;
let lastSentTime = 0;
let sendInterval = null;
let countdownInterval = null;

// Control parameters
const RUDDER_STEP = 2.0; // degrees per key press update
const SAIL_STEP = 2.0; // degrees per key press update
const UPDATE_RATE = 50; // milliseconds between angle updates when key is held
let SEND_INTERVAL = 2000; // milliseconds between sending commands (can be changed by user)

// Angle constraints
const RUDDER_MIN = -20; // degrees
const RUDDER_MAX = 20; // degrees
const SAIL_MIN = 0; // degrees
const SAIL_MAX = 88; // degrees

// DOM elements
const keyElements = {
  w: document.getElementById("key-w"),
  a: document.getElementById("key-a"),
  s: document.getElementById("key-s"),
  d: document.getElementById("key-d"),
  p: document.getElementById("key-p"),
};

const rudderAngleDisplay = document.getElementById("rudder-angle");
const sailAngleDisplay = document.getElementById("sail-angle");
const rudderBar = document.getElementById("rudder-bar");
const sailBar = document.getElementById("sail-bar");
const connectionStatus = document.getElementById("connection-status");
const queueStatus = document.getElementById("queue-status");
const queueIndicator = document.getElementById("queue-indicator");
const sendTimer = document.getElementById("send-timer");
const lastSentDisplay = document.getElementById("last-sent");
const canvas = document.getElementById("boat-canvas");
const ctx = canvas.getContext("2d");
const windAngleDisplay = document.getElementById("wind-angle");
const sendIntervalInput = document.getElementById("send-interval-input");

// Update angle displays
function updateAngleDisplays() {
  // Update text displays
  rudderAngleDisplay.textContent = `${rudderAngle.toFixed(1)}°`;
  sailAngleDisplay.textContent = `${sailAngle.toFixed(1)}°`;

  // Update rudder bar (centered at 0, scaled to -20 to +20 range)
  const rudderPercent = (rudderAngle / 20) * 50; // Convert to percentage
  if (rudderAngle >= 0) {
    rudderBar.style.left = "50%";
    rudderBar.style.width = `${Math.abs(rudderPercent)}%`;
  } else {
    rudderBar.style.left = `${50 + rudderPercent}%`;
    rudderBar.style.width = `${Math.abs(rudderPercent)}%`;
  }

  // Update sail bar (0 to 88 degrees)
  const sailPercent = (sailAngle / 88) * 100;
  sailBar.style.left = "0%";
  sailBar.style.width = `${sailPercent}%`;
  
  // Update boat visualization
  drawBoat();
}

// Draw the boat visualization
function drawBoat() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const boatLength = 120;
  const boatWidth = 40;
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Save context
  ctx.save();
  
  // Draw grid lines for reference
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, canvas.height);
  ctx.moveTo(0, centerY);
  ctx.lineTo(canvas.width, centerY);
  ctx.stroke();
  
  // Draw wind direction arrow (coming FROM this angle)
  // 0 degrees = wind from front of boat
  // 90 degrees = wind from starboard (right)
  // 180 degrees = wind from behind
  // 270 degrees = wind from port (left)
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((windDirection * Math.PI) / 180);
  
  // Wind arrow pointing TO the boat (from outside)
  ctx.strokeStyle = "#17a2b8";
  ctx.fillStyle = "#17a2b8";
  ctx.lineWidth = 3;
  
  // Arrow shaft
  ctx.beginPath();
  ctx.moveTo(0, -150);
  ctx.lineTo(0, -100);
  ctx.stroke();
  
  // Arrow head pointing inward
  ctx.beginPath();
  ctx.moveTo(0, -100);
  ctx.lineTo(-10, -110);
  ctx.lineTo(10, -110);
  ctx.closePath();
  ctx.fill();
  
  // Wind label
  ctx.font = "14px Arial";
  ctx.fillStyle = "#17a2b8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("WIND", 0, -170);
  
  ctx.restore();
  
  // Draw boat hull
  ctx.fillStyle = "#4a4a5a";
  ctx.strokeStyle = "#6a6a7a";
  ctx.lineWidth = 2;
  
  // Hull shape (pointed bow, flat stern)
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - boatLength/2); // Bow
  ctx.lineTo(centerX - boatWidth/2, centerY + boatLength/3); // Port side
  ctx.lineTo(centerX - boatWidth/2, centerY + boatLength/2); // Port stern
  ctx.lineTo(centerX + boatWidth/2, centerY + boatLength/2); // Starboard stern
  ctx.lineTo(centerX + boatWidth/2, centerY + boatLength/3); // Starboard side
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw mast
  ctx.fillStyle = "#8a8a9a";
  ctx.beginPath();
  ctx.arc(centerX, centerY - 20, 4, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw mainsail
  ctx.save();
  ctx.translate(centerX, centerY - 20); // Mast position
  
  // Sail rotates from 0 (parallel to boat) to 88 (nearly perpendicular)
  const sailRotation = (sailAngle * Math.PI) / 180;
  ctx.rotate(sailRotation);
  
  ctx.strokeStyle = "#4caf50";
  ctx.lineWidth = 4;
  
  // Mainsail as a longer line extending backward
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 70);
  ctx.stroke();
  
  ctx.restore();
  
  // Draw rudder as a line
  ctx.save();
  ctx.translate(centerX, centerY + boatLength/2); // Stern position
  
  // Rudder rotates from -45 to +45 degrees
  const rudderRotation = (rudderAngle * Math.PI) / 180;
  ctx.rotate(rudderRotation);
  
  ctx.strokeStyle = "#f44336";
  ctx.lineWidth = 4;
  
  // Rudder as a simple line
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 30);
  ctx.stroke();
  
  ctx.restore();
  
  // Draw boat center dot
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
  ctx.fill();
  
  // Restore context
  ctx.restore();
}

// Update angles based on pressed keys
function updateAngles() {
  let changed = false;

  // Rudder control (constrained to -20 to +20)
  if (keysPressed.a && !keysPressed.d) {
    rudderAngle = Math.max(RUDDER_MIN, rudderAngle - RUDDER_STEP);
    rudderCommandQueued = true;
    changed = true;
  } else if (keysPressed.d && !keysPressed.a) {
    rudderAngle = Math.min(RUDDER_MAX, rudderAngle + RUDDER_STEP);
    rudderCommandQueued = true;
    changed = true;
  }

  // Sail control (constrained to 0 to 88)
  if (keysPressed.w && !keysPressed.s) {
    sailAngle = Math.min(SAIL_MAX, sailAngle + SAIL_STEP);
    sailCommandQueued = true;
    changed = true;
  } else if (keysPressed.s && !keysPressed.w) {
    sailAngle = Math.max(SAIL_MIN, sailAngle - SAIL_STEP);
    sailCommandQueued = true;
    changed = true;
  }

  if (changed) {
    updateQueueStatus();
    updateAngleDisplays();
  }
}

// Update queue status display
function updateQueueStatus() {
  if (rudderCommandQueued && sailCommandQueued) {
    queueStatus.textContent = "Rudder + Sail";
  } else if (rudderCommandQueued) {
    queueStatus.textContent = "Rudder";
  } else if (sailCommandQueued) {
    queueStatus.textContent = "Sail (Press P)";
  } else {
    queueStatus.textContent = "Idle";
  }
  
  if (rudderCommandQueued || sailCommandQueued) {
    queueIndicator.classList.add("active");
  } else {
    queueIndicator.classList.remove("active");
  }
}

// Send rudder command only (called by timer)
async function sendRudderCommand() {
  if (!rudderCommandQueued) {
    return;
  }

  try {
    // Send only rudder command
    await ipcRenderer.invoke("send-rudder-command", rudderAngle);

    // Update UI
    rudderCommandQueued = false;
    updateQueueStatus();
    lastSentDisplay.textContent = new Date().toLocaleTimeString();

  } catch (error) {
    console.error("Error sending rudder command:", error);
    queueStatus.textContent = "Error";
  }
}

// Send sail command (called when P is pressed)
async function sendSailCommand() {
  if (!sailCommandQueued) {
    return;
  }

  try {
    // Send only sail command
    await ipcRenderer.invoke("send-sail-command", sailAngle);

    // Update UI
    sailCommandQueued = false;
    updateQueueStatus();
    
    // Flash confirmation
    queueStatus.textContent = "Sail Sent!";
    setTimeout(() => {
      updateQueueStatus();
    }, 1000);

  } catch (error) {
    console.error("Error sending sail command:", error);
    queueStatus.textContent = "Error";
  }
}

// Update countdown timer
function updateCountdown() {
  const now = Date.now();
  const timeSinceLastSend = now - lastSentTime;
  const timeUntilNextSend = Math.max(0, SEND_INTERVAL - timeSinceLastSend);
  const seconds = (timeUntilNextSend / 1000).toFixed(1);
  sendTimer.textContent = `${seconds}s`;
}

// Initialize send interval (for rudder only)
function startSendInterval() {
  // Clear any existing intervals
  stopSendInterval();
  
  // Send rudder commands at user-defined interval
  sendInterval = setInterval(() => {
    sendRudderCommand();
    lastSentTime = Date.now();
  }, SEND_INTERVAL);

  // Update countdown display
  countdownInterval = setInterval(updateCountdown, 100);
}

// Stop send interval
function stopSendInterval() {
  if (sendInterval) {
    clearInterval(sendInterval);
    sendInterval = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// Key event handlers
function handleKeyDown(event) {
  const key = event.key.toLowerCase();

  if (key in keysPressed && !keysPressed[key]) {
    keysPressed[key] = true;
    if (keyElements[key]) {
      keyElements[key].classList.add("active");
    }
    
    // Send sail command when P is pressed
    if (key === 'p' && sailCommandQueued) {
      sendSailCommand();
    }
  }
}

function handleKeyUp(event) {
  const key = event.key.toLowerCase();

  if (key in keysPressed) {
    keysPressed[key] = false;
    if (keyElements[key]) {
      keyElements[key].classList.remove("active");
    }
  }
}

// Update loop for continuous angle changes while keys are held
let updateLoop = null;
function startUpdateLoop() {
  if (!updateLoop) {
    updateLoop = setInterval(updateAngles, UPDATE_RATE);
  }
}

function stopUpdateLoop() {
  if (updateLoop) {
    clearInterval(updateLoop);
    updateLoop = null;
  }
}

// IPC event handlers
ipcRenderer.on("connection-status", (event, connected) => {
  isConnected = connected;
  if (connected) {
    connectionStatus.classList.remove("disconnected");
    connectionStatus.classList.add("connected");
    connectionStatus.querySelector("span").textContent = "Connected";
    startSendInterval();
  } else {
    connectionStatus.classList.remove("connected");
    connectionStatus.classList.add("disconnected");
    connectionStatus.querySelector("span").textContent = "Disconnected";
    stopSendInterval();
  }
});

// Wind direction update handler
ipcRenderer.on("wind-update", (event, direction) => {
  windDirection = direction;
  windAngleDisplay.textContent = `${direction.toFixed(1)}°`;
  drawBoat();
});

// Initialize
async function init() {
  // Check connection status
  isConnected = await ipcRenderer.invoke("check-rc-connection");
  if (isConnected) {
    connectionStatus.classList.remove("disconnected");
    connectionStatus.classList.add("connected");
    connectionStatus.querySelector("span").textContent = "Connected";
    startSendInterval();
  }

  // Set up event listeners
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  // Prevent default behavior for control keys
  window.addEventListener("keydown", (e) => {
    if (["w", "a", "s", "d", "p"].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });

  // Start update loop
  startUpdateLoop();

  // Initial display update
  updateAngleDisplays();
  
  // Request current wind direction
  const currentWind = await ipcRenderer.invoke("get-wind-direction");
  if (currentWind !== null) {
    windDirection = currentWind;
    windAngleDisplay.textContent = `${currentWind.toFixed(1)}°`;
    drawBoat();
  }
  
  // Set up interval input handler
  sendIntervalInput.addEventListener("change", (e) => {
    const newInterval = parseFloat(e.target.value);
    if (!isNaN(newInterval) && newInterval >= 0.5 && newInterval <= 10) {
      SEND_INTERVAL = newInterval * 1000; // Convert to milliseconds
      
      // Restart the send interval if connected
      if (isConnected) {
        startSendInterval();
      }
    } else {
      // Reset to default if invalid
      e.target.value = (SEND_INTERVAL / 1000).toFixed(1);
    }
  });
  
  // Prevent form submission on Enter key
  sendIntervalInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendIntervalInput.blur();
    }
  });
}

// Clean up on window close
window.addEventListener("beforeunload", () => {
  stopUpdateLoop();
  stopSendInterval();
});

// Run initialization
init();
