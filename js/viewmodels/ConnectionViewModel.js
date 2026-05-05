/**
 * ConnectionViewModel - Manages connection state and demo mode
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, ConnectionState, ArmSegment, SENSOR_CONFIG } from '../utils/Constants.js';
import { BluetoothService } from '../services/BluetoothService.js';
import { IMUReading } from '../models/SensorData.js';

export class ConnectionViewModel {
  /**
   * @param {BluetoothService} bluetoothService
   */
  constructor(bluetoothService) {
    this.bluetooth = bluetoothService;
    this._demoInterval = null;
    this._demoTime = 0;
    this._state = ConnectionState.DISCONNECTED;
  }

  /** @returns {string} */
  get state() {
    return this._state;
  }

  /** @returns {boolean} */
  get isConnected() {
    return this._state === ConnectionState.CONNECTED;
  }

  /** @returns {boolean} */
  get isDemoMode() {
    return this._state === ConnectionState.DEMO;
  }

  /**
   * Initialize - listen for state changes
   */
  init() {
    eventBus.on(Events.CONNECTION_STATE_CHANGED, (state) => {
      this._state = state;
    });
  }

  /**
   * Connect to ESP32 via BLE (Bluetooth)
   */
  async connect() {
    this.stopDemo();
    await this.bluetooth.connect();
  }

  /**
   * Connect to ESP32 via USB cable
   */
  async connectUSB() {
    this.stopDemo();
    await this.bluetooth.connectUSB();
  }

  /**
   * Disconnect from ESP32
   */
  async disconnect() {
    await this.bluetooth.disconnect();
  }

  /**
   * Start Demo Mode with simulated sensor data
   */
  startDemo() {
    if (this._demoInterval) this.stopDemo();

    this._demoTime = 0;
    this._state = ConnectionState.DEMO;
    eventBus.emit(Events.CONNECTION_STATE_CHANGED, ConnectionState.DEMO);

    // Generate simulated data at 50Hz
    this._demoInterval = setInterval(() => {
      this._demoTime += SENSOR_CONFIG.SAMPLE_INTERVAL_MS;
      const data = this._generateDemoData(this._demoTime);
      eventBus.emit(Events.RAW_DATA_RECEIVED, JSON.stringify(data));
    }, SENSOR_CONFIG.SAMPLE_INTERVAL_MS);
  }

  /**
   * Stop Demo Mode
   */
  stopDemo() {
    if (this._demoInterval) {
      clearInterval(this._demoInterval);
      this._demoInterval = null;
    }
    if (this._state === ConnectionState.DEMO) {
      this._state = ConnectionState.DISCONNECTED;
      eventBus.emit(Events.CONNECTION_STATE_CHANGED, ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Generate realistic demo data simulating arm movement
   * @param {number} t - Time in ms
   * @returns {Object}
   * @private
   */
  _generateDemoData(t) {
    const sec = t / 1000;

    // Simulate a cyclic arm movement pattern
    // Phase 1: Arm raise (0-3s), Phase 2: Hold (3-5s), Phase 3: Lower (5-8s), Phase 4: Rest (8-10s)
    const cycle = sec % 10;
    let motionPhase;
    if (cycle < 3) motionPhase = cycle / 3; // raising
    else if (cycle < 5) motionPhase = 1; // held
    else if (cycle < 8) motionPhase = 1 - (cycle - 5) / 3; // lowering
    else motionPhase = 0; // resting

    // Smooth easing
    const eased = motionPhase * motionPhase * (3 - 2 * motionPhase);

    // Add natural tremor/noise
    const noise = () => (Math.random() - 0.5) * 0.05;
    const tremor = (freq) => Math.sin(sec * freq * 2 * Math.PI) * 0.02;

    // Upper arm - larger movements
    const ua_pitch = -eased * 65 + noise() * 10; // -65° when raised
    const ua_roll = eased * 10 + tremor(6) + noise() * 5;
    const ua_ax = Math.sin(MathUtils_degToRad(ua_pitch)) + noise();
    const ua_ay = Math.cos(MathUtils_degToRad(ua_roll)) * Math.cos(MathUtils_degToRad(ua_pitch)) + noise();
    const ua_az = -Math.sin(MathUtils_degToRad(ua_roll)) * Math.cos(MathUtils_degToRad(ua_pitch)) + noise();

    // Forearm - follows upper arm with delay
    const delayed = Math.max(0, Math.min(1, (motionPhase * 1.2 - 0.1)));
    const fa_pitch = -delayed * 45 + noise() * 8;
    const fa_roll = delayed * 5 + tremor(5) + noise() * 3;
    const fa_ax = Math.sin(MathUtils_degToRad(fa_pitch)) + noise();
    const fa_ay = Math.cos(MathUtils_degToRad(fa_roll)) * Math.cos(MathUtils_degToRad(fa_pitch)) + noise();
    const fa_az = -Math.sin(MathUtils_degToRad(fa_roll)) * Math.cos(MathUtils_degToRad(fa_pitch)) + noise();

    // Gyroscope = approximate derivative of angle
    const gNoise = () => (Math.random() - 0.5) * 2;
    const dPhase = (cycle < 3) ? 22 : (cycle >= 5 && cycle < 8) ? -22 : 0;

    // Only 2 sensors: Upper Arm (s1) + Forearm (s2), no Wrist
    return {
      t: t,
      s1: {
        ax: r(ua_ax), ay: r(ua_ay), az: r(ua_az),
        gx: r(dPhase * 0.3 + gNoise()), gy: r(dPhase + gNoise()), gz: r(gNoise())
      },
      s2: {
        ax: r(fa_ax), ay: r(fa_ay), az: r(fa_az),
        gx: r(dPhase * 0.2 + gNoise()), gy: r(dPhase * 0.7 + gNoise()), gz: r(gNoise())
      }
    };
  }

  /**
   * Get connection info for display
   * @returns {Object}
   */
  getDisplayInfo() {
    return {
      state: this._state,
      stateLabel: this._getStateLabel(),
      isSupported: this.bluetooth.isSupported,
      baudRate: SENSOR_CONFIG.BAUD_RATE,
      sampleRate: SENSOR_CONFIG.SAMPLE_RATE_HZ,
    };
  }

  _getStateLabel() {
    switch (this._state) {
      case ConnectionState.CONNECTED: return 'Connected';
      case ConnectionState.CONNECTING: return 'Connecting...';
      case ConnectionState.DEMO: return 'Demo Mode';
      case ConnectionState.ERROR: return 'Error';
      default: return 'Disconnected';
    }
  }
}

// Helper functions (avoid importing MathUtils for circular dependency)
function MathUtils_degToRad(deg) { return deg * (Math.PI / 180); }
function r(v) { return Math.round(v * 100) / 100; }
