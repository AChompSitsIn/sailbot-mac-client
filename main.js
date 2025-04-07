const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// Keep a global reference of the window object to prevent it from being garbage collected
let mainWindow;
let serialPort = null;
let parser = null;

// Track connection state
let isConnected = false;

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    // Set the window background color to match the dark theme
    backgroundColor: '#1e1e2e'
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Set up the menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Connect',
          click: async () => {
            mainWindow.webContents.send('show-port-dialog');
          }
        },
        {
          label: 'Disconnect',
          click: async () => {
            disconnectPort();
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'About Sailbot Client',
          click: async () => {
            mainWindow.webContents.send('show-about');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Initialize app when Electron is ready
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// List available serial ports
ipcMain.handle('list-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports;
  } catch (err) {
    console.error('Error listing ports:', err);
    return [];
  }
});

// Connect to serial port
ipcMain.handle('connect-port', async (_, portPath, baudRate) => {
  try {
    // Disconnect if already connected
    if (serialPort && serialPort.isOpen) {
      await disconnectPort();
    }

    // Create new serial port
    serialPort = new SerialPort({
      path: portPath,
      baudRate: parseInt(baudRate),
      autoOpen: false
    });

    return new Promise((resolve, reject) => {
      serialPort.open((err) => {
        if (err) {
          console.error('Error opening port:', err);
          reject(err.message);
          return;
        }

        // Set up readline parser for text-based messages
        parser = serialPort.pipe(new ReadlineParser({ delimiter: '\n' }));
        
        // Listen for data from the serial port
        parser.on('data', (data) => {
          // Send received data to the renderer
          if (mainWindow) {
            mainWindow.webContents.send('serial-data', data);
          }
        });

        // Listen for binary data (for command acknowledgments)
        serialPort.on('data', (data) => {
          // Check for binary protocol messages
          if (data.length > 0) {
            // Check for acknowledgment header (0xA0)
            if (data[0] === 0xA0 && data.length >= 3) {
              const command = data[1];
              const checksum = data[2];
              
              // Validate checksum (simple XOR)
              if ((command ^ 0xFF) === checksum) {
                mainWindow.webContents.send('command-ack', command);
              }
            }
            
            // Check for initial connection message (0xB0)
            if (data[0] === 0xB0 && data.length >= 3) {
              if (data[1] === 0x55 && data[2] === 0xAA) {
                mainWindow.webContents.send('connection-established');
              }
            }
          }
        });

        // Handle errors
        serialPort.on('error', (err) => {
          console.error('Serial port error:', err);
          if (mainWindow) {
            mainWindow.webContents.send('serial-error', err.message);
          }
        });

        isConnected = true;
        if (mainWindow) {
          mainWindow.webContents.send('connection-status', true);
        }
        resolve('Connected successfully');
      });
    });
  } catch (err) {
    console.error('Connection error:', err);
    return Promise.reject(err.message);
  }
});

// Disconnect from serial port
async function disconnectPort() {
  return new Promise((resolve) => {
    if (serialPort && serialPort.isOpen) {
      serialPort.close((err) => {
        if (err) {
          console.error('Error closing port:', err);
        }
        serialPort = null;
        parser = null;
        isConnected = false;
        if (mainWindow) {
          mainWindow.webContents.send('connection-status', false);
        }
        resolve('Disconnected');
      });
    } else {
      resolve('Not connected');
    }
  });
}

ipcMain.handle('disconnect-port', disconnectPort);

// Send command to the sailbot
ipcMain.handle('send-command', async (_, commandCode) => {
  try {
    if (!serialPort || !serialPort.isOpen) {
      return Promise.reject('Serial port not connected');
    }
    
    // Validate command code is in valid range
    const code = parseInt(commandCode);
    if (isNaN(code) || code < 0 || code > 255) {
      return Promise.reject('Invalid command code (must be 0-255)');
    }
    
    // Command format: Header byte (0xC0) + Command byte + Checksum byte (XOR with 0xFF)
    const checksum = code ^ 0xFF;
    const commandBytes = Buffer.from([0xC0, code, checksum]);
    
    return new Promise((resolve, reject) => {
      serialPort.write(commandBytes, (err) => {
        if (err) {
          reject(err.message);
        } else {
          // Log to the sent messages window
          if (mainWindow) {
            mainWindow.webContents.send('command-sent', code);
          }
          resolve('Command sent');
        }
      });
    });
  } catch (err) {
    console.error('Error sending command:', err);
    return Promise.reject(err.message);
  }
});

// Check connection status
ipcMain.handle('check-connection', () => {
  return isConnected;
});