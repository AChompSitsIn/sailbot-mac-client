const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

// Keep a global reference of the window object to prevent it from being garbage collected
let mainWindow;
let rcWindow = null;
let serialPort = null;
let parser = null;

// Track connection state
let isConnected = false;

// Track current wind direction
let currentWindDirection = 0.0;

// RC Command codes
const RC_RUDDER_CMD = 10; // 0x0A
const RC_SAIL_CMD = 11; // 0x0B

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
            mainWindow.webContents.send("show-port-dialog");
          },
        },
        {
          label: "Disconnect",
          click: async () => {
            disconnectPort();
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

// List available serial ports
ipcMain.handle("list-ports", async () => {
  try {
    const ports = await SerialPort.list();
    return ports;
  } catch (err) {
    console.error("Error listing ports:", err);
    return [];
  }
});

// Connect to serial port
ipcMain.handle("connect-port", async (_, portPath, baudRate) => {
  try {
    // Disconnect if already connected
    if (serialPort && serialPort.isOpen) {
      await disconnectPort();
    }

    // Create new serial port
    serialPort = new SerialPort({
      path: portPath,
      baudRate: parseInt(baudRate),
      autoOpen: false,
    });

    return new Promise((resolve, reject) => {
      serialPort.open((err) => {
        if (err) {
          console.error("Error opening port:", err);
          reject(err.message);
          return;
        }

        // Set up readline parser for text-based messages
        parser = serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

        // Listen for data from the serial port
        parser.on("data", (data) => {
          // Send received data to the renderer
          if (mainWindow) {
            mainWindow.webContents.send("serial-data", data);
          }

          // Check for wind data and forward to RC window
          if (data.includes("WIND,")) {
            const windIndex = data.indexOf("WIND,");
            const windData = data.substring(windIndex + 5);
            const windValue = parseFloat(windData);

            if (!isNaN(windValue)) {
              currentWindDirection = windValue;
              if (rcWindow) {
                rcWindow.webContents.send("wind-update", windValue);
              }
            }
          }
        });

        // Listen for binary data (for command acknowledgments)
        serialPort.on("data", (data) => {
          // Check for binary protocol messages
          if (data.length > 0) {
            // Check for acknowledgment header (0xA0)
            if (data[0] === 0xa0 && data.length >= 3) {
              const command = data[1];
              const checksum = data[2];

              // Validate checksum (simple XOR)
              if ((command ^ 0xff) === checksum) {
                mainWindow.webContents.send("command-ack", command);
              }
            }

            // Check for initial connection message (0xB0)
            if (data[0] === 0xb0 && data.length >= 3) {
              if (data[1] === 0x55 && data[2] === 0xaa) {
                mainWindow.webContents.send("connection-established");
              }
            }
          }
        });

        // Handle errors
        serialPort.on("error", (err) => {
          console.error("Serial port error:", err);
          if (mainWindow) {
            mainWindow.webContents.send("serial-error", err.message);
          }
        });

        isConnected = true;
        if (mainWindow) {
          mainWindow.webContents.send("connection-status", true);
        }
        if (rcWindow) {
          rcWindow.webContents.send("connection-status", true);
        }
        resolve("Connected successfully");
      });
    });
  } catch (err) {
    console.error("Connection error:", err);
    return Promise.reject(err.message);
  }
});

// Disconnect from serial port
async function disconnectPort() {
  return new Promise((resolve) => {
    if (serialPort && serialPort.isOpen) {
      serialPort.close((err) => {
        if (err) {
          console.error("Error closing port:", err);
        }
        serialPort = null;
        parser = null;
        isConnected = false;
        if (mainWindow) {
          mainWindow.webContents.send("connection-status", false);
        }
        if (rcWindow) {
          rcWindow.webContents.send("connection-status", false);
        }
        resolve("Disconnected");
      });
    } else {
      resolve("Not connected");
    }
  });
}

ipcMain.handle("disconnect-port", disconnectPort);

// Send command to the sailbot
ipcMain.handle("send-command", async (_, commandCode) => {
  try {
    if (!serialPort || !serialPort.isOpen) {
      return Promise.reject("Serial port not connected");
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
      serialPort.write(commandBytes, (err) => {
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
    if (!isConnected || !serialPort) {
      throw new Error("Not connected to serial port");
    }

    // Convert angle to integer
    const rudderValue = Math.round(rudderAngle);

    // Create binary command for rudder
    const rudderCommand = Buffer.from([
      0xaa, // Marker
      RC_RUDDER_CMD,
      rudderValue & 0xff,
      (rudderValue >> 8) & 0xff,
      (RC_RUDDER_CMD ^ rudderValue) & 0xff, // Checksum
    ]);

    // Send command
    return new Promise((resolve, reject) => {
      serialPort.write(rudderCommand, (err) => {
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
    if (!isConnected || !serialPort) {
      throw new Error("Not connected to serial port");
    }

    // Convert angle to integer
    const sailValue = Math.round(sailAngle);

    // Create binary command for sail
    const sailCommand = Buffer.from([
      0xaa, // Marker
      RC_SAIL_CMD,
      sailValue & 0xff,
      (sailValue >> 8) & 0xff,
      (RC_SAIL_CMD ^ sailValue) & 0xff, // Checksum
    ]);

    // Send command
    return new Promise((resolve, reject) => {
      serialPort.write(sailCommand, (err) => {
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
    if (!serialPort || !serialPort.isOpen) {
      return Promise.reject("Serial port not connected");
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
      serialPort.write(rudderCommand, (err) => {
        if (err) {
          reject(err.message);
          return;
        }

        // Small delay between commands
        setTimeout(() => {
          // Send sail command
          serialPort.write(sailCommand, (err) => {
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
