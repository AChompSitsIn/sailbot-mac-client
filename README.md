# Sailbot Remote Control Client

A desktop application for controlling and monitoring the Sailbot over a radio link.

## Overview

The Sailbot Remote Control Client provides a graphical interface for communicating with the autonomous sailboat. It displays real-time GPS and boat status information and allows for sending commands via radio.

## Features

- **Dark-themed GUI interface** optimized for outdoor use
- **Real-time data visualization**:
  - GPS position, speed, and fix quality
  - Boat status (control mode, event type, wind direction)
  - Waypoint tracking information
- **Command control system**:
  - Pre-defined commands (RC Control, Autonomous, etc.)
  - Custom command input for debugging and testing
- **Extensive message logging**:
  - Color-coded message display
  - Raw data inspection
  - Sent commands and acknowledgments
- **Reliable communication protocol**:
  - Text-based data format for robustness
  - Binary command protocol for efficiency
  - Connection status monitoring

## Communication Protocol

The client uses a hybrid communication protocol:

### Text-based Data Format
Data is sent as simple text lines with prefixes:
```
GPS,latitude,longitude,speed,fix_quality
STATUS,control_mode,event_type,wind_direction
WAYPOINT,current_waypoint,total_waypoints,last_completed
```

### Binary Command Protocol
Commands use a simple binary protocol:
- Command Header: `0xC0`
- Command Code: `0-255`
- Checksum: `command code XOR 0xFF`

## Hardware Requirements

- RFD900x radio modem (or compatible)
- macOS/Linux/Windows computer with USB port
- Sailbot with corresponding radio receiver

## Technology Stack

- Electron framework for cross-platform desktop application
- Node.js for backend logic
- SerialPort library for radio communication
- Bootstrap for UI components

## Team

Developed by the Sailbot Team at The Kehillah School.
