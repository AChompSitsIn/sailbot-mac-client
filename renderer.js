// This file is required by the index.html file and will be executed in the renderer process

const { ipcRenderer } = require("electron");
const bootstrap = require("bootstrap");

// DOM Elements
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");
const portSelect = document.getElementById("port-select");
const baudRate = document.getElementById("baud-rate");
const refreshPortsBtn = document.getElementById("refresh-ports");
const connectConfirmBtn = document.getElementById("connect-confirm");
const connectionIndicator = document.getElementById("connection-indicator");
const connectionStatus = document.getElementById("connection-status");
const receivedMessages = document.getElementById("received-messages");
const sentMessages = document.getElementById("sent-messages");
const clearReceivedBtn = document.getElementById("clear-received");
const clearSentBtn = document.getElementById("clear-sent");

// Custom command input elements
const customCommand = document.getElementById("custom-command");
const sendCustomCommandBtn = document.getElementById("send-custom-command");

// RC Control button
const openRCControlBtn = document.getElementById("open-rc-control");

// GPS Status Elements
const gpsFixQuality = document.getElementById("gps-fix-quality");
const gpsPosition = document.getElementById("gps-position");
const gpsSpeed = document.getElementById("gps-speed");
const gpsAge = document.getElementById("gps-age");

// Boat Status Elements
const boatMode = document.getElementById("boat-mode");
const boatEvent = document.getElementById("boat-event");
const boatWind = document.getElementById("boat-wind");
const boatWaypoints = document.getElementById("boat-waypoints");

// Command buttons
const commandButtons = document.querySelectorAll('[id^="cmd-"]');

// Modals
const portModal = new bootstrap.Modal(document.getElementById("port-modal"));
const aboutModal = new bootstrap.Modal(document.getElementById("about-modal"));

// GPS & Boat data storage
const gpsData = {
  latitude: 0.0,
  longitude: 0.0,
  fixQuality: 0,
  speed: 0.0,
  timestamp: 0,
};

const boatStatus = {
  controlMode: "unknown",
  eventType: "unknown",
  windDirection: 0.0,
};

const waypointData = {
  current: 0,
  total: 0,
  lastCompleted: 0,
};

// Keep track of last update time
let lastUpdateTime = 0;

// Update UI based on connection status
function updateConnectionUI(connected) {
  if (connected) {
    connectionIndicator.classList.remove("disconnected");
    connectionIndicator.classList.add("connected");
    connectionStatus.textContent = "Connected";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    commandButtons.forEach((btn) => (btn.disabled = false));
    sendCustomCommandBtn.disabled = false;
  } else {
    connectionIndicator.classList.remove("connected");
    connectionIndicator.classList.add("disconnected");
    connectionStatus.textContent = "Disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    commandButtons.forEach((btn) => (btn.disabled = true));
    sendCustomCommandBtn.disabled = true;
  }
}

// Add a message to the received messages terminal
function addReceivedMessage(message, type = "default") {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  const messageElem = document.createElement("div");
  messageElem.classList.add("message-received");

  const timestampSpan = document.createElement("span");
  timestampSpan.classList.add("message-timestamp");
  timestampSpan.textContent = `[${timestamp}]`;

  messageElem.appendChild(timestampSpan);

  // Add type-specific span
  const typeSpan = document.createElement("span");
  typeSpan.classList.add(`message-type-${type}`);
  typeSpan.textContent = message;
  messageElem.appendChild(typeSpan);

  receivedMessages.appendChild(messageElem);
  receivedMessages.scrollTop = receivedMessages.scrollHeight;
}

// Add a message to the sent messages terminal
function addSentMessage(message, type = "default") {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  const messageElem = document.createElement("div");
  messageElem.classList.add(type === "ack" ? "message-ack" : "message-sent");

  const timestampSpan = document.createElement("span");
  timestampSpan.classList.add("message-timestamp");
  timestampSpan.textContent = `[${timestamp}]`;

  messageElem.appendChild(timestampSpan);
  messageElem.appendChild(document.createTextNode(message));

  sentMessages.appendChild(messageElem);
  sentMessages.scrollTop = sentMessages.scrollHeight;
}

// Get command name from code
function getCommandName(code) {
  const commands = {
    0: "RC Control",
    1: "Start Autonomous",
    2: "RC Interrupt",
    3: "Resume Autonomous",
    4: "EMERGENCY STOP",
    9: "Request Status",
    10: "RC Rudder",
    11: "RC Sail",
  };
  return commands[code] || `Custom Command (${code})`;
}

// Get fix quality text and class
function getFixQualityInfo(quality) {
  const fixQualities = {
    0: { text: "No Fix", class: "fix-none" },
    1: { text: "GPS Fix", class: "fix-gps" },
    2: { text: "DGPS Fix", class: "fix-dgps" },
    4: { text: "RTK Fixed", class: "fix-rtk" },
    5: { text: "RTK Float", class: "fix-rtk" },
  };
  return fixQualities[quality] || { text: "Unknown", class: "fix-none" };
}

// Get speed class
function getSpeedClass(speed) {
  if (speed < 0.1) return "speed-stopped";
  if (speed < 1.0) return "speed-slow";
  return "speed-moving";
}

// Get age class
function getAgeClass(age) {
  if (age < 5) return "age-fresh";
  if (age < 10) return "age-stale";
  return "age-old";
}

// Get mode class
function getModeClass(mode) {
  if (mode === "rc") return "mode-rc";
  if (mode === "autonomous") return "mode-autonomous";
  return "mode-unknown";
}

// Process GPS data
// Process GPS data
function processGpsData(data) {
  try {
    // Look for "GPS" in the message regardless of prefix
    if (data.includes("GPS")) {
      // Looking at the raw message format: @U@GPS,37.425041,-122.104624,0.08,2

      // First, extract everything after "GPS,"
      const gpsIndex = data.indexOf("GPS,");
      if (gpsIndex !== -1) {
        const gpsData_str = data.substring(gpsIndex + 4); // Skip past 'GPS,'
        const parts = gpsData_str.split(",");

        // We expect: latitude, longitude, speed, fix quality
        if (parts.length >= 4) {
          gpsData.latitude = parseFloat(parts[0]);
          gpsData.longitude = parseFloat(parts[1]);
          gpsData.speed = parseFloat(parts[2]);
          gpsData.fixQuality = parseInt(parts[3]);
          gpsData.timestamp = Date.now();

          lastUpdateTime = Date.now();
          updateGpsDisplay();

          addReceivedMessage(
            `GPS: LAT=${gpsData.latitude.toFixed(6)}, LON=${gpsData.longitude.toFixed(6)}, SPEED=${gpsData.speed.toFixed(2)}, FIX=${gpsData.fixQuality}`,
            "gps",
          );
          return true;
        }
      }
    }

    // No GPS data found
    return false;
  } catch (error) {
    console.error("Error processing GPS data:", error);
    return false;
  }
}

// Process boat status data
function processStatusData(data) {
  try {
    // Check for STATUS in the data
    if (data.includes("STATUS,")) {
      // Format: STATUS,control_mode,event_type
      const statusIndex = data.indexOf("STATUS,");
      const statusData = data.substring(statusIndex + 7); // Skip past 'STATUS,'
      const statusParts = statusData.split(",");

      if (statusParts.length >= 2) {
        // Update the control mode
        boatStatus.controlMode = statusParts[0].trim().toLowerCase();

        // Update the event type
        boatStatus.eventType = statusParts[1].trim().toLowerCase();

        // Update wind direction if available (some STATUS messages might include it)
        if (statusParts.length >= 3 && !isNaN(parseFloat(statusParts[2]))) {
          boatStatus.windDirection = parseFloat(statusParts[2]);
        }

        // Update the timestamp and refresh the display
        lastUpdateTime = Date.now();
        updateBoatDisplay();

        addReceivedMessage(
          `STATUS: MODE=${boatStatus.controlMode}, EVENT=${boatStatus.eventType}`,
          "status",
        );
        return true;
      }
    } else if (data.includes("STATUS:")) {
      // Support for alternative format: STATUS: MODE=value, EVENT=value, WIND=value
      const modeMatch = /MODE=([^,]+)/.exec(data);
      const eventMatch = /EVENT=([^,]+)/.exec(data);
      const windMatch = /WIND=([^°\s]+)/.exec(data);

      if (modeMatch) boatStatus.controlMode = modeMatch[1].trim().toLowerCase();
      if (eventMatch) boatStatus.eventType = eventMatch[1].trim().toLowerCase();
      if (windMatch) boatStatus.windDirection = parseFloat(windMatch[1]);

      lastUpdateTime = Date.now();
      updateBoatDisplay();

      addReceivedMessage(
        `STATUS: MODE=${boatStatus.controlMode}, EVENT=${boatStatus.eventType}`,
        "status",
      );
      return true;
    }

    // No status data found
    return false;
  } catch (error) {
    console.error("Error processing status data:", error);
    return false;
  }
}

// Process waypoint data
function processWaypointData(data) {
  try {
    if (data.includes("WAYPOINT,")) {
      const waypointIndex = data.indexOf("WAYPOINT,");
      const waypointData = data.substring(waypointIndex + 9); // Skip past 'WAYPOINT,'
      const parts = waypointData.split(",");

      if (parts.length >= 3) {
        waypointData.current = parseInt(parts[0]);
        waypointData.total = parseInt(parts[1]);
        waypointData.lastCompleted = parseInt(parts[2]);

        updateBoatDisplay();

        addReceivedMessage(
          `WAYPOINT: CURRENT=${waypointData.current}, TOTAL=${waypointData.total}, LAST=${waypointData.lastCompleted}`,
          "waypoint",
        );
        return true;
      }
    }
  } catch (error) {
    console.error("Error processing waypoint data:", error);
  }
  return false;
}

function processWindData(data) {
  try {
    // Check for WIND in the data
    if (data.includes("WIND,")) {
      const windIndex = data.indexOf("WIND,");
      const windData = data.substring(windIndex + 5); // Skip past 'WIND,'
      const windValue = parseFloat(windData);

      if (!isNaN(windValue)) {
        boatStatus.windDirection = windValue;
        updateBoatDisplay();

        addReceivedMessage(`WIND: ${windValue.toFixed(1)}°`, "status");
        return true;
      }
    }

    // No wind data found or failed to parse
    return false;
  } catch (error) {
    console.error("Error processing wind data:", error);
    return false;
  }
}

// Then modify the serial-data event listener in renderer.js to include wind processing:

// Received serial data
ipcRenderer.on("serial-data", (event, data) => {
  // First, display the raw data
  addReceivedMessage(`Raw: ${data}`, "default");

  // Try to parse as GPS, status, waypoint, or wind data
  if (
    !processGpsData(data) &&
    !processStatusData(data) &&
    !processWaypointData(data) &&
    !processWindData(data)
  ) {
    // Data already displayed as raw, no need to display again
  }
});

// Update GPS display
function updateGpsDisplay() {
  // Update fix quality
  const fixInfo = getFixQualityInfo(gpsData.fixQuality);
  gpsFixQuality.textContent = fixInfo.text;
  gpsFixQuality.className = "status-value " + fixInfo.class;

  // Update position
  gpsPosition.textContent = `${gpsData.latitude.toFixed(6)}°, ${gpsData.longitude.toFixed(6)}°`;
  gpsPosition.className = "status-value " + fixInfo.class;

  // Update speed
  const speedKnots = gpsData.speed * 1.94384;
  gpsSpeed.textContent = `${gpsData.speed.toFixed(2)} m/s (${speedKnots.toFixed(2)} knots)`;
  gpsSpeed.className = "status-value " + getSpeedClass(gpsData.speed);

  // Update data age
  updateDataAge();
}

// Update boat status display
function updateBoatDisplay() {
  // Update control mode
  boatMode.textContent = boatStatus.controlMode.toUpperCase();
  boatMode.className = "status-value " + getModeClass(boatStatus.controlMode);

  // Update event type
  boatEvent.textContent = boatStatus.eventType.toUpperCase();

  // Update wind direction
  boatWind.textContent = `${boatStatus.windDirection.toFixed(1)}°`;

  // Update waypoints
  boatWaypoints.textContent = `${waypointData.current}/${waypointData.total} (Last: ${waypointData.lastCompleted})`;
}

// Update data age display
function updateDataAge() {
  if (gpsData.timestamp === 0) {
    gpsAge.textContent = "N/A";
    return;
  }

  const ageInSeconds = (Date.now() - gpsData.timestamp) / 1000;
  gpsAge.textContent = `${ageInSeconds.toFixed(1)}s`;
  gpsAge.className = "status-value " + getAgeClass(ageInSeconds);
}

// Refresh port list
async function refreshPorts() {
  try {
    const ports = await ipcRenderer.invoke("list-ports");

    // Clear previous options
    while (portSelect.options.length > 1) {
      portSelect.remove(1);
    }

    // Add new port options
    ports.forEach((port) => {
      const option = document.createElement("option");
      option.value = port.path;
      option.textContent = `${port.path} - ${port.manufacturer || "Unknown"}`;
      portSelect.appendChild(option);
    });

    if (ports.length === 0) {
      addReceivedMessage("No serial ports found", "error");
    }
  } catch (error) {
    console.error("Error refreshing ports:", error);
    addReceivedMessage(`Error listing ports: ${error.message}`, "error");
  }
}

// Connect to selected port
async function connectToPort() {
  const selectedPort = portSelect.value;
  const selectedBaud = baudRate.value;

  if (!selectedPort) {
    alert("Please select a serial port");
    return;
  }

  try {
    const result = await ipcRenderer.invoke(
      "connect-port",
      selectedPort,
      selectedBaud,
    );
    portModal.hide();
    updateConnectionUI(true);
    addReceivedMessage(
      `Connected to ${selectedPort} at ${selectedBaud} baud`,
      "connection",
    );

    // Send initial status request after connection
    setTimeout(() => {
      sendCommand(9);
    }, 1000);
  } catch (error) {
    alert(`Failed to connect: ${error}`);
    addReceivedMessage(`Connection failed: ${error}`, "error");
  }
}

// Disconnect from port
async function disconnectFromPort() {
  try {
    const result = await ipcRenderer.invoke("disconnect-port");
    updateConnectionUI(false);
    addReceivedMessage("Disconnected from serial port", "connection");
  } catch (error) {
    console.error("Error disconnecting:", error);
    addReceivedMessage(`Disconnect error: ${error}`, "error");
  }
}

// Send command to the sailbot
async function sendCommand(commandCode) {
  try {
    await ipcRenderer.invoke("send-command", commandCode);
    addSentMessage(
      `Sent command: ${commandCode} - ${getCommandName(commandCode)}`,
    );
  } catch (error) {
    console.error("Error sending command:", error);
    addReceivedMessage(`Failed to send command: ${error}`, "error");
  }
}

// Send custom command
async function sendCustomCommandHandler() {
  const code = parseInt(customCommand.value);
  if (isNaN(code) || code < 0 || code > 255) {
    alert("Please enter a valid command code (0-255)");
    return;
  }

  await sendCommand(code);
  customCommand.value = ""; // Clear input after sending
}

// Start periodic updates for data age
function startPeriodicUpdates() {
  setInterval(() => {
    updateDataAge();

    // Check connection health based on last update time
    const timeSinceUpdate = (Date.now() - lastUpdateTime) / 1000;
    if (
      timeSinceUpdate > 10 &&
      connectionIndicator.classList.contains("connected")
    ) {
      addReceivedMessage("Connection timed out (no data for 10s)", "error");
      updateConnectionUI(false);
    }
  }, 1000);
}

// Event Listeners

// Connection button
connectBtn.addEventListener("click", () => {
  refreshPorts();
  portModal.show();
});

// Disconnect button
disconnectBtn.addEventListener("click", disconnectFromPort);

// Refresh ports button
refreshPortsBtn.addEventListener("click", refreshPorts);

// Connect confirm button
connectConfirmBtn.addEventListener("click", connectToPort);

// Command buttons
commandButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const code = parseInt(button.dataset.code);
    sendCommand(code);
  });
});

// Custom command button
sendCustomCommandBtn.addEventListener("click", sendCustomCommandHandler);

// Custom command input - Enter key
customCommand.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendCustomCommandHandler();
  }
});

// Clear message buttons
clearReceivedBtn.addEventListener("click", () => {
  receivedMessages.innerHTML = "";
});

clearSentBtn.addEventListener("click", () => {
  sentMessages.innerHTML = "";
});

// Open RC Control button
openRCControlBtn.addEventListener("click", () => {
  ipcRenderer.invoke("open-rc-window");
});

// IPC Event Listeners

// Received serial data
ipcRenderer.on("serial-data", (event, data) => {
  // First, display the raw data
  addReceivedMessage(`Raw: ${data}`, "default");

  // Try to parse as GPS, status, waypoint, or wind data
  if (
    !processGpsData(data) &&
    !processStatusData(data) &&
    !processWaypointData(data) &&
    !processWindData(data)
  ) {
    // Data already displayed as raw, no need to display again
  }
});

// Command acknowledgment
ipcRenderer.on("command-ack", (event, command) => {
  addSentMessage(
    `Command acknowledged: ${command} - ${getCommandName(command)}`,
    "ack",
  );
});

// Command sent (for logging RC commands differently)
ipcRenderer.on("command-sent", (event, details) => {
  if (typeof details === "string") {
    // RC command with details
    addSentMessage(details);
  } else {
    // Regular command number
    addSentMessage(`Sent command: ${details} - ${getCommandName(details)}`);
  }
});

// Connection established
ipcRenderer.on("connection-established", () => {
  addReceivedMessage("Connection established with jetson!", "connection");
  updateConnectionUI(true);
  lastUpdateTime = Date.now();
});

// Connection status update
ipcRenderer.on("connection-status", (event, connected) => {
  updateConnectionUI(connected);
});

// Serial error
ipcRenderer.on("serial-error", (event, error) => {
  addReceivedMessage(`Serial error: ${error}`, "error");
});

// Show port dialog
ipcRenderer.on("show-port-dialog", () => {
  refreshPorts();
  portModal.show();
});

// Show about dialog
ipcRenderer.on("show-about", () => {
  aboutModal.show();
});

// Initialize the app
async function init() {
  // Check if already connected
  const isConnected = await ipcRenderer.invoke("check-connection");
  updateConnectionUI(isConnected);

  // Start periodic updates
  startPeriodicUpdates();

  // Initially disable the custom command button until connected
  sendCustomCommandBtn.disabled = true;
}

// Run initialization
init();
