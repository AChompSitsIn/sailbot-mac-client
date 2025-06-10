const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const WebSocket = require("ws");

// Keep a global reference of the window object to prevent it from being garbage collected
let mainWindow;
let rcWindow = null;
let ws = null;

// Track connection state
let isConnected = false;

// Track current wind direction
let currentWindDirection = 0.0;

// RC Command codes
const RC_RUDDER_CMD = 10; // 0x0A
const RC_SAIL_CMD = 11; // 0x0B

// WebSocket relay configuration
const RELAY_URL = "wss://sailbot-relay.onrender.com";
const AUTH_TOKEN = "antonius";

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, "preload.js"),
    },
    // Set the window background color to match the dark theme
    backgroundColor: "#1e1e2e",
  });

  // Load the index.html file
  mainWindow.loadFile("index.html");

  // Handle window close
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Set up the menu
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Connect",
          click: async () => {
            connectToRelay();
          },
        },
        {
          label: "Disconnect",
          click: async () => {
            disconnectFromRelay();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Control",
      submenu: [
        {
          label: "Open RC Control",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            createRCWindow();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "help",
      submenu: [
        {
          label: "About Sailbot Client",
          click: async () => {
            mainWindow.webContents.send("show-about");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Create the RC control window
function createRCWindow() {
  if (rcWindow) {
    rcWindow.focus();
    return;
  }

  rcWindow = new BrowserWindow({
    width: 850,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: "#1e1e2e",
    parent: mainWindow,
    modal: false,
    show: false,
  });

  rcWindow.loadFile("rc-window.html");

  rcWindow.once("ready-to-show", () => {
    rcWindow.show();
  });

  rcWindow.on("closed", () => {
    rcWindow = null;
  });

  // Forward connection status to RC window
  if (isConnected && rcWindow) {
    rcWindow.webContents.send("connection-status", true);
  }

  // Send current wind direction to RC window
  if (rcWindow) {
    rcWindow.webContents.on("did-finish-load", () => {
      rcWindow.webContents.send("wind-update", currentWindDirection);
    });
  }
}

// Initialize app when Electron is ready
app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Connect to WebSocket relay
async function connectToRelay() {
  return new Promise((resolve, reject) => {
    try {
      // Disconnect if already connected
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        disconnectFromRelay();
      }

      // Create WebSocket connection with type=control and auth token
      const wsUrl = `${RELAY_URL}?type=control&auth=${AUTH_TOKEN}`;
      ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        console.log("Connected to relay server");
        isConnected = true;
        
        if (mainWindow) {
          mainWindow.webContents.send("connection-status", true);
          mainWindow.webContents.send("connection-established");
        }
        if (rcWindow) {
          rcWindow.webContents.send("connection-status", true);
        }
        
        resolve("Connected successfully");
      });

      ws.on("message", (data) => {
        // Handle text messages (status updates)
        if (typeof data === "string" || data instanceof String) {
          // Send received data to the renderer
          if (mainWindow) {
            mainWindow.webContents.send("serial-data", data.toString());
          }

          // Check for wind data and forward to RC window
          const dataStr = data.toString();
          if (dataStr.includes("WIND,")) {
            const windIndex = dataStr.indexOf("WIND,");
            const windData = dataStr.substring(windIndex + 5);
            const windValue = parseFloat(windData);

            if (!isNaN(windValue)) {
              currentWindDirection = windValue;
              if (rcWindow) {
                rcWindow.webContents.send("wind-update", windValue);
              }
            }
          }
        } 
        // Handle binary messages (acknowledgments)
        else if (data instanceof Buffer) {
          // Check for acknowledgment header (0xA0)
          if (data.length >= 3 && data[0] === 0xa0) {
            const command = data[1];
            const checksum = data[2];

            // Validate checksum (simple XOR)
            if ((command ^ 0xff) === checksum) {
              mainWindow.webContents.send("command-ack", command);
            }
          }

          // Check for initial connection message (0xB0)
          if (data.length >= 3 && data[0] === 0xb0) {
            if (data[1] === 0x55 && data[2] === 0xaa) {
              mainWindow.webContents.send("connection-established");
            }
          }
        }
      });

      ws.on("error", (err) => {
        console.error("WebSocket error:", err);
        if (mainWindow) {
          mainWindow.webContents.send("serial-error", err.message);
        }
        reject(err.message);
      });

      ws.on("close", () => {
        console.log("WebSocket connection closed");
        isConnected = false;
        ws = null;
        
        if (mainWindow) {
          mainWindow.webContents.send("connection-status", false);
        }
        if (rcWindow) {
          rcWindow.webContents.send("connection-status", false);
        }
      });

    } catch (err) {
      console.error("Connection error:", err);
      reject(err.message);
    }
  });
}

// Disconnect from WebSocket relay
async function disconnectFromRelay() {
  return new Promise((resolve) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
      ws = null;
      isConnected = false;
      
      if (mainWindow) {
        mainWindow.webContents.send("connection-status", false);
      }
      if (rcWindow) {
        rcWindow.webContents.send("connection-status", false);
      }
      
      resolve("Disconnected");
    } else {
      resolve("Not connected");
    }
  });
}

// List available serial ports (not used anymore, but kept for compatibility)
ipcMain.handle("list-ports", async () => {
  return [];
});

// Connect to port (modified to connect to relay instead)
ipcMain.handle("connect-port", async (_, portPath, baudRate) => {
  // Ignore port path and baud rate, connect to relay instead
  return connectToRelay();
});

// Disconnect from port
ipcMain.handle("disconnect-port", disconnectFromRelay);

// Send command to the sailbot
ipcMain.handle("send-command", async (_, commandCode) => {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject("WebSocket not connected");
    }

    // Validate command code is in valid range
    const code = parseInt(commandCode);
    if (isNaN(code) || code < 0 || code > 255) {
      return Promise.reject("Invalid command code (must be 0-255)");
    }

    // Command format: Header byte (0xC0) + Command byte + Checksum byte (XOR with 0xFF)
    const checksum = code ^ 0xff;
    const commandBytes = Buffer.from([0xc0, code, checksum]);

    return new Promise((resolve, reject) => {
      try {
        ws.send(commandBytes, { binary: true }, (err) => {
          if (err) {
            reject(err.message);
          } else {
            // Log to the sent messages window
            if (mainWindow) {
              mainWindow.webContents.send("command-sent", code);
            }
            resolve("Command sent");
          }
        });
      } catch (err) {
        reject(err.message);
      }
    });
  } catch (err) {
    console.error("Error sending command:", err);
    return Promise.reject(err.message);
  }
});

// Check connection status
ipcMain.handle("check-connection", () => {
  return isConnected;
});

// Check RC connection status (same as main connection)
ipcMain.handle("check-rc-connection", () => {
  return isConnected;
});

// Get current wind direction
ipcMain.handle("get-wind-direction", () => {
  return currentWindDirection;
});

// Open RC window
ipcMain.handle("open-rc-window", () => {
  createRCWindow();
});

// Send rudder command only
ipcMain.handle("send-rudder-command", async (_, rudderAngle) => {
  try {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to relay server");
    }

    // Convert angle (-20 to +20) to byte value (0-255)
    // The Pi expects: rudder_angle = (data_byte * 90.0 / 255.0) - 45.0
    // So we need: data_byte = (rudder_angle + 45.0) * 255.0 / 90.0
    const rudderByte = Math.round((rudderAngle + 45.0) * 255.0 / 90.0);
    
    // Clamp to valid byte range
    const clampedByte = Math.max(0, Math.min(255, rudderByte));
    
    // Debug logging
    console.log(`Rudder angle: ${rudderAngle}° -> byte: ${clampedByte} (will be decoded as ${(clampedByte * 90.0 / 255.0) - 45.0}° on Pi)`);

    // Create binary command for rudder (4 bytes total)
    const rudderCommand = Buffer.from([
      0xc0, // Header (matching Pi's expectation)
      RC_RUDDER_CMD, // Command code (10)
      clampedByte, // Single data byte
      (RC_RUDDER_CMD ^ clampedByte) ^ 0xff, // Checksum
    ]);

    // Send command
    return new Promise((resolve, reject) => {
      ws.send(rudderCommand, { binary: true }, (err) => {
        if (err) {
          reject(err.message);
        } else {
          // Log to main window
          if (mainWindow) {
            mainWindow.webContents.send(
              "command-sent",
              `RC Rudder: ${rudderAngle.toFixed(1)}°`
            );
          }
          resolve("Rudder command sent");
        }
      });
    });
  } catch (error) {
    throw error;
  }
});

// Send sail command only
ipcMain.handle("send-sail-command", async (_, sailAngle) => {
  try {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to relay server");
    }

    // Convert angle (0 to 88) to byte value (0-255)
    // The Pi expects: sail_angle = data_byte * 90.0 / 255.0
    // So we need: data_byte = sail_angle * 255.0 / 90.0
    const sailByte = Math.round(sailAngle * 255.0 / 90.0);
    
    // Clamp to valid byte range
    const clampedByte = Math.max(0, Math.min(255, sailByte));

    // Create binary command for sail (4 bytes total)
    const sailCommand = Buffer.from([
      0xc0, // Header (matching Pi's expectation)
      RC_SAIL_CMD, // Command code (11)
      clampedByte, // Single data byte
      (RC_SAIL_CMD ^ clampedByte) ^ 0xff, // Checksum
    ]);

    // Send command
    return new Promise((resolve, reject) => {
      ws.send(sailCommand, { binary: true }, (err) => {
        if (err) {
          reject(err.message);
        } else {
          // Log to main window
          if (mainWindow) {
            mainWindow.webContents.send(
              "command-sent",
              `RC Sail: ${sailAngle.toFixed(1)}°`
            );
          }
          resolve("Sail command sent");
        }
      });
    });
  } catch (error) {
    throw error;
  }
});

// Send RC command with rudder and sail angles (kept for compatibility)
ipcMain.handle("send-rc-command", async (_, rudderAngle, sailAngle) => {
  try {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject("WebSocket not connected");
    }

    // Convert angles to byte values
    // Rudder: -45 to 45 degrees -> 0 to 255 (128 = center)
    const rudderByte = Math.round(((rudderAngle + 45) * 255) / 90);

    // Sail: 0 to 90 degrees -> 0 to 255
    const sailByte = Math.round((sailAngle * 255) / 90);

    // Send rudder command
    const rudderChecksum = RC_RUDDER_CMD ^ rudderByte ^ 0xff;
    const rudderCommand = Buffer.from([
      0xc0,
      RC_RUDDER_CMD,
      rudderByte,
      rudderChecksum,
    ]);

    // Send sail command
    const sailChecksum = RC_SAIL_CMD ^ sailByte ^ 0xff;
    const sailCommand = Buffer.from([
      0xc0,
      RC_SAIL_CMD,
      sailByte,
      sailChecksum,
    ]);

    return new Promise((resolve, reject) => {
      // Send rudder command
      ws.send(rudderCommand, { binary: true }, (err) => {
        if (err) {
          reject(err.message);
          return;
        }

        // Small delay between commands
        setTimeout(() => {
          // Send sail command
          ws.send(sailCommand, { binary: true }, (err) => {
            if (err) {
              reject(err.message);
            } else {
              // Log to main window
              if (mainWindow) {
                mainWindow.webContents.send(
                  "command-sent",
                  `RC: Rudder=${rudderAngle.toFixed(1)}°, Sail=${sailAngle.toFixed(1)}°`,
                );
              }
              resolve("RC commands sent");
            }
          });
        }, 50);
      });
    });
  } catch (err) {
    console.error("Error sending RC command:", err);
    return Promise.reject(err.message);
  }
});