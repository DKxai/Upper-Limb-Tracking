/**
 * BluetoothService - Kết nối ESP32 qua BLE hoặc USB Serial
 * 
 * Hỗ trợ 2 chế độ:
 *   - BLE (Bluetooth Low Energy): Web Bluetooth API → Không cần pair, không bị block
 *   - USB Serial: Web Serial API → kết nối bằng dây cáp USB
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, ConnectionState, SENSOR_CONFIG, SEGMENT_BY_INDEX } from '../utils/Constants.js';
import { IMUReading } from '../models/SensorData.js';

// Nordic UART Service UUIDs (chuẩn BLE UART)
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // ESP32 → PC

export class BluetoothService {
  constructor() {
    // BLE
    this._bleDevice = null;
    this._bleServer = null;
    this._txCharacteristic = null;

    // USB Serial
    this._port = null;
    this._reader = null;
    this._readableStreamClosed = null;
    this._keepReading = false;

    // Shared
    this._state = ConnectionState.DISCONNECTED;
    this._mode = null; // 'ble' or 'usb'
    this._buffer = '';
    this._decoder = new TextDecoder(); // Reuse decoder for performance
    this._loggedChunks = 0;

    // Auto-reconnect states
    this._shouldAutoReconnect = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;

    // Network stats tracking
    this._networkStats = {
      startTime: 0,
      totalFrames: 0,
      validFrames: 0,
      lastLogTime: 0
    };

    // Binary accumulation buffer (handles BLE MTU fragmentation)
    this._binBuffer = new Uint8Array(256); // Ring buffer
    this._binLen = 0;                       // Current bytes in buffer
    this._binMode = false;                  // Auto-detected: true = binary, false = text

    this._onDisconnectHandler = this._onDisconnect.bind(this);

    // Check support
    this.isBLESupported = 'bluetooth' in navigator;
    this.isSerialSupported = 'serial' in navigator;
    this.isSupported = this.isBLESupported || this.isSerialSupported;
  }

  /** @returns {string} Current connection state */
  get state() { return this._state; }
  
  /** @returns {string|null} Connection mode ('ble', 'usb', or null) */
  get mode() { return this._mode; }

  /**
   * Update connection state and notify
   * @param {string} newState
   */
  _setState(newState) {
    this._state = newState;
    eventBus.emit(Events.CONNECTION_STATE_CHANGED, newState);
  }

  // ═══════════════════════════════════════════════
  //   BLE CONNECTION (Web Bluetooth API)
  // ═══════════════════════════════════════════════

  /**
   * Attempt to auto-connect to previously permitted devices (like headphones)
   * This skips the pairing popup if the user has connected before.
   */
  async autoConnect() {
    if (!this.isBLESupported || !navigator.bluetooth.getDevices) return false;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const espDevice = devices.find(d => d.name && d.name.startsWith('ESP32'));
      
      if (espDevice) {
        console.log('[BLE] Found previously connected device:', espDevice.name);
        
        // Thử kết nối ngay lập tức (nếu ESP32 đang bật sẵn)
        this._reconnectAttempts = 0;
        const success = await this._connectToDevice(espDevice);
        if (success) return true;

        // Nếu thất bại (ESP32 chưa bật), bật chế độ quét ngầm chờ ESP32 phát sóng
        if (typeof espDevice.watchAdvertisements === 'function') {
          console.log('[BLE] Device is offline. Watching for it to turn on...');
          
          espDevice.addEventListener('advertisementreceived', async (event) => {
            console.log('[BLE] Detected ESP32 signal! Auto-connecting...');
            espDevice.unwatchAdvertisements(); // Dừng quét
            this._reconnectAttempts = 0;
            await this._connectToDevice(espDevice);
          });

          await espDevice.watchAdvertisements();
          // Báo cho UI biết là đang ở chế độ chờ
          this._setState(ConnectionState.CONNECTING);
        } else {
          console.warn('[BLE] watchAdvertisements not supported in this browser.');
        }
      }
    } catch (err) {
      console.warn('[BLE] Auto-connect not supported or failed:', err);
    }
    return false;
  }

  /**
   * Connect via BLE (Bluetooth Low Energy) - Shows popup
   * @returns {Promise<boolean>}
   */
  async connectBLE() {
    if (!this.isBLESupported) {
      console.error('[BLE] Web Bluetooth API not supported');
      eventBus.emit(Events.CONNECTION_ERROR, 'Web Bluetooth not supported. Use Chrome/Edge.');
      return false;
    }

    try {
      this._setState(ConnectionState.CONNECTING);
      console.log('[BLE] Requesting device...');

      // Popup chọn thiết bị BLE — user sẽ thấy "ESP32_ArmTrack"
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'ESP32' }],
        optionalServices: [NUS_SERVICE_UUID],
      });

      this._reconnectAttempts = 0;
      return await this._connectToDevice(device);

    } catch (error) {
      console.error('[BLE] Connection failed:', error);
      if (error.name === 'NotFoundError') {
        this._setState(ConnectionState.DISCONNECTED);
      } else {
        this._setState(ConnectionState.ERROR);
        eventBus.emit(Events.CONNECTION_ERROR, error.message);
      }
      return false;
    }
  }

  /**
   * Internal method to establish GATT connection and setup services
   * @param {BluetoothDevice} device
   * @private
   */
  async _connectToDevice(device) {
    try {
      this._setState(ConnectionState.CONNECTING);
      this._bleDevice = device;
      this._shouldAutoReconnect = true; // Enable auto-reconnect once intentionally connected

      // Xóa listener cũ (nếu có) để tránh duplicate
      this._bleDevice.removeEventListener('gattserverdisconnected', this._onDisconnectHandler);
      this._bleDevice.addEventListener('gattserverdisconnected', this._onDisconnectHandler);

      console.log('[BLE] Connecting GATT server...');
      this._bleServer = await this._bleDevice.gatt.connect();

      console.log('[BLE] Getting NUS service...');
      const service = await this._bleServer.getPrimaryService(NUS_SERVICE_UUID);

      console.log('[BLE] Getting TX characteristic...');
      this._txCharacteristic = await service.getCharacteristic(NUS_TX_CHAR_UUID);
      await this._txCharacteristic.startNotifications();

      this._txCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
        this._onBLEData(event);
      });

      this._mode = 'ble';
      this._setState(ConnectionState.CONNECTED);
      this._reconnectAttempts = 0; // Reset upon successful connection
      console.log('[BLE] ✅ Connected to', this._bleDevice.name);
      return true;

    } catch (error) {
      console.error('[BLE] GATT Connection failed:', error);
      this._setState(ConnectionState.DISCONNECTED);
      this._cleanupBLE();
      return false;
    }
  }

  /**
   * Handle device disconnection and trigger auto-reconnect
   * @private
   */
  _onDisconnect() {
    console.log('[BLE] Device disconnected');
    this._cleanupBLE();
    this._setState(ConnectionState.DISCONNECTED);

    if (this._shouldAutoReconnect && this._bleDevice) {
      this._attemptReconnect();
    }
  }

  /**
   * Exponential backoff reconnection logic
   * @private
   */
  _attemptReconnect() {
    if (this._reconnectTimer) {
      // Reconnect timer already scheduled, do not schedule another one
      return;
    }

    this._reconnectAttempts++;
    if (this._reconnectAttempts > 10) {
      console.log('[BLE] Max reconnect attempts reached. Giving up.');
      this._shouldAutoReconnect = false;
      return;
    }

    // Delay: 1s, 2s, 4s, 8s, 10s...
    const delayMs = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 10000);
    console.log(`[BLE] Auto-reconnecting in ${delayMs}ms... (Attempt ${this._reconnectAttempts})`);
    this._setState(ConnectionState.CONNECTING);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null; // Clear timer reference before starting the connect attempt
      console.log('[BLE] Reconnecting now...');
      try {
        const success = await this._connectToDevice(this._bleDevice);
        if (!success && this._shouldAutoReconnect) {
          // If connection failed, try again
          this._attemptReconnect();
        }
      } catch (e) {
        if (this._shouldAutoReconnect) {
          this._attemptReconnect();
        }
      }
    }, delayMs);
  }

  _onBLEData(event) {
    if (this._networkStats.startTime === 0) {
      this._networkStats.startTime = Date.now();
      this._networkStats.lastLogTime = Date.now();
    }

    const dataView = event.target.value; // DataView from BLE
    const incoming = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);

    // Debug: log first 10 notifications to diagnose
    if (this._loggedChunks < 10) {
      const hex = Array.from(incoming.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`[BLE RAW #${this._loggedChunks}] ${incoming.length} bytes: ${hex}${incoming.length > 20 ? '...' : ''}`);
      this._loggedChunks++;
    }

    // ── Auto-detect mode on first data ──
    if (!this._binMode && incoming.length > 0) {
      // If first byte is 0xAA (binary header) → binary mode
      // If first byte is printable ASCII (0x20-0x7E, '{', '[') → text mode
      const first = incoming[0];
      if (first === 0xAA) {
        this._binMode = true;
        console.log('[BLE] ✅ Auto-detected BINARY mode');
      } else if (first >= 0x20 && first <= 0x7E) {
        this._binMode = false;
        console.log('[BLE] Auto-detected TEXT mode');
      } else {
        // Could be a fragment, check if any byte is 0xAA
        if (incoming.includes(0xAA)) {
          this._binMode = true;
          console.log('[BLE] ✅ Auto-detected BINARY mode (0xAA found in fragment)');
        }
      }
    }

    // ══════════════════════════════════════
    //   BINARY MODE (80-byte frame protocol)
    // ══════════════════════════════════════
    if (this._binMode) {
      // Append incoming bytes to accumulation buffer
      if (this._binLen + incoming.length > this._binBuffer.length) {
        // Grow buffer if needed
        const newBuf = new Uint8Array(this._binLen + incoming.length + 128);
        newBuf.set(this._binBuffer.subarray(0, this._binLen));
        this._binBuffer = newBuf;
      }
      this._binBuffer.set(incoming, this._binLen);
      this._binLen += incoming.length;

      // Scan buffer for complete frames (0xAA ... 0x55, 80 bytes)
      this._scanBinaryBuffer();
      return;
    }

    // ══════════════════════════════════════
    //   TEXT MODE (JSON/CSV fallback)
    // ══════════════════════════════════════
    const chunk = this._decoder.decode(dataView.buffer, { stream: true });
    this._buffer += chunk;

    const lines = this._buffer.split('\n');
    this._buffer = lines.pop() || '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length > 0) {
        eventBus.emit(Events.RAW_DATA_RECEIVED, line);
      }
    }

    if (this._buffer.length > 2048) {
      this._buffer = this._buffer.substring(this._buffer.length - 512);
    }
  }

  /**
   * Scan binary accumulation buffer for complete 80-byte frames
   * Frame: [0xAA] [active_mask] [timestamp 4B] [data 72B] [checksum] [0x55]
   * @private
   */
  _scanBinaryBuffer() {
    const FRAME_SIZE = 80;
    let processed = 0;

    while (this._binLen - processed >= FRAME_SIZE) {
      // Find 0xAA header
      let headerIdx = -1;
      for (let i = processed; i <= this._binLen - FRAME_SIZE; i++) {
        if (this._binBuffer[i] === 0xAA) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx === -1) {
        // No header found, discard all but last (FRAME_SIZE-1) bytes
        processed = Math.max(processed, this._binLen - FRAME_SIZE + 1);
        break;
      }

      // Discard bytes before header
      if (headerIdx > processed) {
        processed = headerIdx;
      }

      // Check if we have enough bytes for a full frame
      if (this._binLen - processed < FRAME_SIZE) break;

      // Check footer at byte 79
      if (this._binBuffer[processed + FRAME_SIZE - 1] !== 0x55) {
        // Bad footer → skip this 0xAA and search for next one
        processed++;
        continue;
      }

      // Extract frame and parse
      const frameBytes = this._binBuffer.slice(processed, processed + FRAME_SIZE);
      const dv = new DataView(frameBytes.buffer);
      const parsed = this._parseBinaryFrame(dv);

      if (parsed) {
        eventBus.emit(Events.RAW_DATA_RECEIVED, parsed);
      }

      processed += FRAME_SIZE;
    }

    // Compact buffer: move unprocessed bytes to front
    if (processed > 0) {
      const remaining = this._binLen - processed;
      if (remaining > 0) {
        this._binBuffer.copyWithin(0, processed, this._binLen);
      }
      this._binLen = remaining;
    }

    // Safety: prevent buffer from growing forever
    if (this._binLen > 1024) {
      this._binLen = 0;
    }
  }

  /**
   * Parse a binary BLE frame (80 bytes) from Master ESP32
   * Frame format:
   *   Byte 0:     0xAA (header)
   *   Byte 1:     active_mask (bitmask, 6 bits)
   *   Byte 2-5:   timestamp (uint32 LE)
   *   Byte 6-77:  6 nodes × 12 bytes (6 × int16 LE)
   *   Byte 78:    checksum (XOR bytes 0-77)
   *   Byte 79:    0x55 (footer)
   * @param {DataView} dv
   * @returns {Object|null}
   * @private
   */
  _parseBinaryFrame(dv) {
    this._networkStats.totalFrames++;

    // Verify XOR checksum
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    let chk = 0;
    for (let i = 0; i < 78; i++) chk ^= bytes[i];
    if (chk !== dv.getUint8(78)) {
      console.warn('[BLE] Bad checksum, expected', chk, 'got', dv.getUint8(78));
      eventBus.emit(Events.RAW_DATA_RECEIVED, `[BLE ERR] Bad checksum: ${chk} != ${dv.getUint8(78)}`);
      this._logNetworkStats();
      return null;
    }

    this._networkStats.validFrames++;
    this._logNetworkStats();

    const activeMask = dv.getUint8(1);
    const timestamp = dv.getUint32(2, true); // little-endian

    const readings = {};
    const NUM_NODES = 6;

    for (let i = 0; i < NUM_NODES; i++) {
      if (!(activeMask & (1 << i))) continue; // Node inactive
      const offset = 6 + i * 12;
      const segment = SEGMENT_BY_INDEX[i + 1]; // 1-based index
      if (!segment) continue;

      readings[segment] = new IMUReading(
        dv.getInt16(offset, true)     / 16384,  // ax (±2g → 16384 LSB/g)
        dv.getInt16(offset + 2, true) / 16384,  // ay
        dv.getInt16(offset + 4, true) / 16384,  // az
        dv.getInt16(offset + 6, true) / 131,    // gx (±250°/s → 131 LSB/°/s)
        dv.getInt16(offset + 8, true) / 131,    // gy
        dv.getInt16(offset + 10, true) / 131     // gz
      );
    }

    return { timestamp, readings, mode: 'raw', activeMask };
  }

  _logNetworkStats() {
    const now = Date.now();
    if (now - this._networkStats.lastLogTime >= 5000) {
      this._networkStats.lastLogTime = now;
      const elapsedSec = (now - this._networkStats.startTime) / 1000;
      if (elapsedSec <= 0) return;
      
      const expectedFrames = elapsedSec * 50; // 50 Hz
      const actualRate = this._networkStats.totalFrames / elapsedSec;
      const lossRate = Math.max(0, (1 - (this._networkStats.totalFrames / expectedFrames)) * 100);
      const validRate = this._networkStats.totalFrames > 0 ? (this._networkStats.validFrames / this._networkStats.totalFrames) * 100 : 0;
      const invalidCount = this._networkStats.totalFrames - this._networkStats.validFrames;
      
      console.log(`\n========== [NETWORK STATS] ==========
- Thời gian chạy     : ${elapsedSec.toFixed(1)} giây
- Tổng khung nhận    : ${this._networkStats.totalFrames}
- Tần số cập nhật    : ${actualRate.toFixed(2)} Hz (mong đợi ~50 Hz)
- Tỉ lệ mất gói      : ${lossRate.toFixed(2)} %
- Khung hợp lệ       : ${this._networkStats.validFrames}
- Lỗi checksum       : ${invalidCount}
- Tỉ lệ khung hợp lệ : ${validRate.toFixed(2)} %
=====================================\n`);
    }
  }

  /** Cleanup BLE resources */
  _cleanupBLE() {
    this._txCharacteristic = null;
    this._bleServer = null;
    this._mode = null;
    this._buffer = '';

    this._networkStats = {
      startTime: 0,
      totalFrames: 0,
      validFrames: 0,
      lastLogTime: 0
    };
  }

  // ═══════════════════════════════════════════════
  //   USB SERIAL CONNECTION (Web Serial API)
  // ═══════════════════════════════════════════════

  /**
   * Connect via USB Serial (cáp USB)
   * @returns {Promise<boolean>}
   */
  async connectUSB() {
    if (!this.isSerialSupported) {
      console.error('[USB] Web Serial API not supported');
      eventBus.emit(Events.CONNECTION_ERROR, 'Web Serial not supported. Use Chrome/Edge.');
      return false;
    }

    try {
      this._setState(ConnectionState.CONNECTING);

      this._port = await navigator.serial.requestPort();
      await this._port.open({ baudRate: SENSOR_CONFIG.BAUD_RATE });

      this._keepReading = true;
      this._mode = 'usb';
      this._setState(ConnectionState.CONNECTED);
      console.log('[USB] ✅ Connected via USB Serial');

      this._readSerialLoop();

      navigator.serial.addEventListener('disconnect', (event) => {
        if (event.target === this._port) {
          this.disconnect();
        }
      });

      return true;

    } catch (error) {
      console.error('[USB] Connection failed:', error);
      if (error.name === 'NotFoundError') {
        this._setState(ConnectionState.DISCONNECTED);
      } else {
        this._setState(ConnectionState.ERROR);
        eventBus.emit(Events.CONNECTION_ERROR, error.message);
      }
      return false;
    }
  }

  /**
   * USB Serial read loop
   * @private
   */
  async _readSerialLoop() {
    while (this._port.readable && this._keepReading) {
      const textDecoder = new TextDecoderStream();
      this._readableStreamClosed = this._port.readable.pipeTo(textDecoder.writable);
      this._reader = textDecoder.readable.getReader();

      let buffer = '';
      try {
        while (true) {
          const { value, done } = await this._reader.read();
          if (done) break;
          buffer += value;

          let idx;
          while ((idx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.substring(0, idx).trim();
            buffer = buffer.substring(idx + 1);
            if (line.length > 0) {
              eventBus.emit(Events.RAW_DATA_RECEIVED, line);
            }
          }
          if (buffer.length > 2048) {
            buffer = buffer.substring(buffer.length - 512);
          }
        }
      } catch (error) {
        console.error('[USB] Read error:', error);
        if (this._keepReading) {
          this._setState(ConnectionState.ERROR);
          eventBus.emit(Events.CONNECTION_ERROR, 'USB read error.');
        }
      } finally {
        this._reader.releaseLock();
      }
    }
  }

  // ═══════════════════════════════════════════════
  //   SHARED: connect (default) / disconnect
  // ═══════════════════════════════════════════════

  /**
   * Default connect — uses BLE (Bluetooth)
   * @returns {Promise<boolean>}
   */
  async connect() {
    return this.connectBLE();
  }

  /**
   * Disconnect from any connection
   */
  async disconnect() {
    this._shouldAutoReconnect = false;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    
    if (this._mode === 'ble') {
      this._cleanupBLE();
      this._bleDevice = null;
    } else if (this._mode === 'usb') {
      this._keepReading = false;
      try {
        if (this._reader) await this._reader.cancel().catch(() => {});
        if (this._readableStreamClosed) await this._readableStreamClosed.catch(() => {});
        if (this._port) await this._port.close().catch(() => {});
      } catch (e) {
        console.warn('[USB] Disconnect error:', e);
      }
      this._port = null;
      this._reader = null;
      this._mode = null;
    }

    this._setState(ConnectionState.DISCONNECTED);
    console.log('[Service] Disconnected');
  }

  /**
   * Get connection info
   * @returns {Object}
   */
  getInfo() {
    return {
      state: this._state,
      mode: this._mode,
      isBLESupported: this.isBLESupported,
      isSerialSupported: this.isSerialSupported,
      deviceName: this._bleDevice ? this._bleDevice.name : null,
    };
  }
}
