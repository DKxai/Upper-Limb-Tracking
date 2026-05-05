/**
 * DataProcessingViewModel - Orchestrates the data processing pipeline
 * Supports two input modes:
 *   RAW:         Raw IMU → Parse → Calibrate → Filter → Fuse → Joint Angles → Store
 *   ORIENTATION: Pre-fused (from ESP32) → Parse → Joint Angles → Store
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, FUSION_CONFIG, SENSOR_CONFIG, ArmSegment } from '../utils/Constants.js';
import { DataParser } from '../services/DataParser.js';
import { SensorFusion } from '../services/SensorFusion.js';
import { SignalProcessing } from '../services/SignalProcessing.js';
import { SensorDataSample, IMUReading, Orientation } from '../models/SensorData.js';
import { SessionData } from '../models/SessionData.js';
import { WebSocketClient } from '../services/WebSocketClient.js';

export class DataProcessingViewModel {
  constructor() {
    this.parser = new DataParser();
    this.fusion = new SensorFusion();
    this.session = new SessionData();

    this._frameCounter = 0;
    this._startTimestamp = null;
    this._lowPassEnabled = true;
    this._lowPassAlpha = FUSION_CONFIG.LOWPASS_ALPHA;
    this._dataMode = null; // 'raw' or 'orientation' (auto-detected)

    // Backend Connection
    this.wsClient = new WebSocketClient();
    this.wsClient.connect();

    // Per-sensor low-pass filter states (dynamic for all segments)
    this._lpfState = {};
    for (const seg of Object.values(ArmSegment)) {
      this._lpfState[seg] = {};
    }
  }

  /**
   * Initialize event listeners
   */
  init() {
    eventBus.on(Events.RAW_DATA_RECEIVED, (data) => {
      if (typeof data === 'string') {
        this._processLine(data);           // Text mode (JSON/CSV)
      } else {
        this._processParsedData(data);     // Binary mode (pre-parsed object)
      }
    });
  }

  /** @returns {string|null} Current data mode ('raw', 'orientation', or null) */
  get dataMode() {
    return this._dataMode;
  }

  /**
   * Process a raw data line through the pipeline
   * @param {string} line
   * @private
   */
  _processLine(line) {
    // Step 1: Parse
    const parsed = this.parser.parse(line);
    if (!parsed) return;

    // Step 2: Track timing
    if (this._startTimestamp === null) {
      this._startTimestamp = parsed.timestamp;
    }
    const relativeTime = parsed.timestamp - this._startTimestamp;

    // Auto-detect data mode on first valid parse
    if (this._dataMode === null && parsed.mode) {
      this._dataMode = parsed.mode;
      console.log(`[DataProcessing] Data mode detected: ${this._dataMode}`);
    }

    // Step 3: Route to appropriate pipeline
    if (parsed.mode === 'orientation') {
      this._processOrientation(parsed, relativeTime);
    } else {
      this._processRawIMU(parsed, relativeTime);
    }
  }

  /**
   * Process pre-computed orientation data (from ESP32 with sensor fusion)
   * Skips low-pass filter, calibration, and sensor fusion
   * @param {Object} parsed
   * @param {number} relativeTime
   * @private
   */
  _processOrientation(parsed, relativeTime) {
    // Convert to Orientation objects
    const orientations = {};
    for (const [segment, o] of Object.entries(parsed.orientations)) {
      orientations[segment] = new Orientation(o.roll, o.pitch, o.yaw);
    }

    // Compute joint angles from orientations
    const jointAngles = this.fusion.computeJointAngles(orientations);

    // Create sample (raw data will be empty IMUReading defaults)
    const sample = new SensorDataSample(
      relativeTime,
      this._frameCounter++,
      {},             // no raw IMU data
      orientations,
      jointAngles
    );

    // Store and emit
    this.session.addSample(sample);
    eventBus.emit(Events.PROCESSED_DATA_READY, sample);
  }

  /**
   * Process raw IMU data through full pipeline
   * @param {Object} parsed
   * @param {number} relativeTime
   * @private
   */
  _processRawIMU(parsed, relativeTime) {
    // Step 3: Apply low-pass filter to raw data (if enabled)
    let readings = parsed.readings;
    if (this._lowPassEnabled) {
      readings = this._applyLowPass(readings);
    }

    // Step 4: Handle calibration
    if (this.fusion.isCalibrating) {
      const done = this.fusion.processCalibration(readings);
      eventBus.emit(Events.CALIBRATION_PROGRESS, this.fusion.calibrationProgress);
      if (done) {
        eventBus.emit(Events.CALIBRATION_COMPLETE);
      }
      return; // Don't process data during calibration
    }

    // Step 5: Sensor fusion (Complementary Filter)
    const { orientations, jointAngles } = this.fusion.process(readings);

    // Step 6: Create complete sample
    const sample = new SensorDataSample(
      relativeTime,
      this._frameCounter++,
      readings,
      orientations,
      jointAngles
    );

    // Step 7: Store in session
    this.session.addSample(sample);

    // Step 8: Emit processed data
    eventBus.emit(Events.PROCESSED_DATA_READY, sample);
  }

  /**
   * Process pre-parsed binary data (from BLE binary protocol)
   * Skips text parsing - data already contains readings object
   * @param {Object} parsed - { timestamp, readings, mode, activeMask }
   * @private
   */
  _processParsedData(parsed) {
    if (this._startTimestamp === null) this._startTimestamp = parsed.timestamp;
    const relativeTime = parsed.timestamp - this._startTimestamp;

    // Auto-detect data mode
    if (this._dataMode === null && parsed.mode) {
      this._dataMode = parsed.mode;
      console.log(`[DataProcessing] Binary data mode: ${this._dataMode}`);
    }

    // --- Format fake raw line for Dashboard UI Debug Monitor ---
    const activeNodes = [];
    for (let i = 0; i < 6; i++) {
      if (parsed.activeMask & (1 << i)) activeNodes.push(i + 1);
    }
    this.parser.lastRawLine = `[BINARY 80B] Nodes: ${activeNodes.join(',')} | TS: ${parsed.timestamp}ms`;
    // -----------------------------------------------------------

    if (parsed.mode === 'orientation') {
      this._processOrientation(parsed, relativeTime);
      return;
    }

    // Process raw IMU data
    let readings = parsed.readings;
    if (this._lowPassEnabled) readings = this._applyLowPass(readings);

    if (this.fusion.isCalibrating) {
      const done = this.fusion.processCalibration(readings);
      eventBus.emit(Events.CALIBRATION_PROGRESS, this.fusion.calibrationProgress);
      if (done) eventBus.emit(Events.CALIBRATION_COMPLETE);
      return;
    }

    const { orientations, jointAngles } = this.fusion.process(readings);
    const sample = new SensorDataSample(
      relativeTime, this._frameCounter++,
      readings, orientations, jointAngles
    );

    this.session.addSample(sample);
    eventBus.emit(Events.PROCESSED_DATA_READY, sample);

    // Gửi dữ liệu về Backend để lưu vào TimescaleDB
    this.wsClient.sendFrame(sample);
  }

  /**
   * Apply low-pass filter to raw IMU readings
   * @param {Object.<string, IMUReading>} readings
   * @returns {Object.<string, IMUReading>}
   * @private
   */
  _applyLowPass(readings) {
    const filtered = {};
    const alpha = this._lowPassAlpha;

    for (const [segment, reading] of Object.entries(readings)) {
      const state = this._lpfState[segment];
      if (!state || !reading) {
        filtered[segment] = reading;
        continue;
      }

      // Initialize state
      if (state.ax === undefined) {
        state.ax = reading.ax;
        state.ay = reading.ay;
        state.az = reading.az;
        state.gx = reading.gx;
        state.gy = reading.gy;
        state.gz = reading.gz;
        filtered[segment] = reading;
        continue;
      }

      // Apply IIR filter
      state.ax = alpha * reading.ax + (1 - alpha) * state.ax;
      state.ay = alpha * reading.ay + (1 - alpha) * state.ay;
      state.az = alpha * reading.az + (1 - alpha) * state.az;
      state.gx = alpha * reading.gx + (1 - alpha) * state.gx;
      state.gy = alpha * reading.gy + (1 - alpha) * state.gy;
      state.gz = alpha * reading.gz + (1 - alpha) * state.gz;

      filtered[segment] = new IMUReading(
        state.ax, state.ay, state.az,
        state.gx, state.gy, state.gz
      );
    }

    return filtered;
  }

  /**
   * Start sensor calibration
   */
  startCalibration() {
    this.fusion.startCalibration();
  }

  /**
   * Toggle low-pass filter
   * @param {boolean} enabled
   */
  setLowPassEnabled(enabled) {
    this._lowPassEnabled = enabled;
  }

  /**
   * Set low-pass filter alpha
   * @param {number} alpha
   */
  setLowPassAlpha(alpha) {
    this._lowPassAlpha = alpha;
  }

  /**
   * Set complementary filter alpha
   * @param {number} alpha
   */
  setFusionAlpha(alpha) {
    this.fusion.setAlpha(alpha);
  }

  /**
   * Reset all data
   */
  reset() {
    this.session.reset();
    this.fusion.reset();
    this.parser.resetStats();
    this._frameCounter = 0;
    this._startTimestamp = null;
    this._dataMode = null;
    for (const state of Object.values(this._lpfState)) {
      for (const key of Object.keys(state)) {
        delete state[key];
      }
    }
    // Re-init for all segments
    this._lpfState = {};
    for (const seg of Object.values(ArmSegment)) {
      this._lpfState[seg] = {};
    }
  }

  /**
   * Start recording session
   */
  startRecording(patientName) {
    this.session.startRecording();
    this.wsClient.startSession(patientName);
    eventBus.emit(Events.RECORDING_STARTED);
  }

  /**
   * Stop recording session
   */
  stopRecording() {
    this.session.stopRecording();
    this.wsClient.stopSession();
    eventBus.emit(Events.RECORDING_STOPPED);
  }

  /**
   * Get processing statistics
   * @returns {Object}
   */
  getStats() {
    const parserStats = this.parser.getStats();
    return {
      totalFrames: this._frameCounter,
      totalSamples: this.session.totalSamplesReceived,
      bufferSize: this.session.samples.length,
      duration: this.session.getDuration(),
      actualRate: this.session.getActualSampleRate(),
      parseErrors: parserStats.errors,
      parseErrorRate: parserStats.errorRate,
      dataFormat: parserStats.lastFormat || 'N/A',
      lastRawLine: parserStats.lastRawLine || 'No data received yet',
      isCalibrated: this.fusion.isCalibrated,
      dataMode: this._dataMode || 'N/A',
      lowPassEnabled: this._lowPassEnabled,
      lowPassAlpha: this._lowPassAlpha,
      fusionAlpha: this.fusion.alpha,
    };
  }

  /**
   * Get FFT analysis for a specific data path
   * @param {string} path - e.g., 'raw.upper_arm.ax'
   * @returns {{ frequencies: number[], magnitudes: number[] }}
   */
  getFFT(path) {
    const data = this.session.getTimeSeries(path);
    if (data.length < 16) return { frequencies: [], magnitudes: [] };
    return SignalProcessing.fft(data, SENSOR_CONFIG.SAMPLE_RATE_HZ);
  }

  /**
   * Get SPARC smoothness for a joint
   * @param {string} jointPath - e.g., 'jointAngles.elbowFlexion'
   * @returns {number}
   */
  getSPARC(jointPath) {
    const angles = this.session.getTimeSeries(jointPath);
    if (angles.length < 16) return 0;
    // Calculate angular velocity
    const velocity = [];
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    for (let i = 1; i < angles.length; i++) {
      velocity.push((angles[i] - angles[i - 1]) / dt);
    }
    return SignalProcessing.sparc(velocity, SENSOR_CONFIG.SAMPLE_RATE_HZ);
  }
}
