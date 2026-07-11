/**
 * SessionData Model
 * Manages a recording session: stores time-series data, computes statistics.
 */

import { BUFFER_CONFIG, ArmSegment } from '../utils/Constants.js';
import { MathUtils } from '../utils/MathUtils.js';

export class SessionData {
  /**
   * @param {number} maxSamples - Maximum samples to keep in buffer
   */
  constructor(maxSamples = BUFFER_CONFIG.MAX_SAMPLES) {
    /** @type {import('./SensorData.js').SensorDataSample[]} */
    this.samples = [];
    this.maxSamples = maxSamples;
    this.isRecording = false;
    this.startTime = null;
    this.endTime = null;
    this.frameCounter = 0;
    this.totalSamplesReceived = 0;

    // ROM tracking (per joint)
    // ROM tracking (per joint - Dual Arm)
    this._romTracker = {
      leftShoulderFlexion: { min: Infinity, max: -Infinity },
      leftShoulderAbduction: { min: Infinity, max: -Infinity },
      leftElbowFlexion: { min: Infinity, max: -Infinity },
      leftWristFlexion: { min: Infinity, max: -Infinity },
      leftWristDeviation: { min: Infinity, max: -Infinity },
      rightShoulderFlexion: { min: Infinity, max: -Infinity },
      rightShoulderAbduction: { min: Infinity, max: -Infinity },
      rightElbowFlexion: { min: Infinity, max: -Infinity },
      rightWristFlexion: { min: Infinity, max: -Infinity },
      rightWristDeviation: { min: Infinity, max: -Infinity },
    };
  }

  /**
   * Add a new data sample
   * @param {import('./SensorData.js').SensorDataSample} sample
   */
  addSample(sample) {
    this.totalSamplesReceived++;
    this.samples.push(sample);

    // Update ROM tracking
    // Update ROM tracking
    if (sample.jointAngles) {
      this._updateROM('leftShoulderFlexion', sample.jointAngles.leftShoulderFlexion);
      this._updateROM('leftShoulderAbduction', sample.jointAngles.leftShoulderAbduction);
      this._updateROM('leftElbowFlexion', sample.jointAngles.leftElbowFlexion);
      this._updateROM('leftWristFlexion', sample.jointAngles.leftWristFlexion);
      this._updateROM('leftWristDeviation', sample.jointAngles.leftWristDeviation);
      
      this._updateROM('rightShoulderFlexion', sample.jointAngles.rightShoulderFlexion);
      this._updateROM('rightShoulderAbduction', sample.jointAngles.rightShoulderAbduction);
      this._updateROM('rightElbowFlexion', sample.jointAngles.rightElbowFlexion);
      this._updateROM('rightWristFlexion', sample.jointAngles.rightWristFlexion);
      this._updateROM('rightWristDeviation', sample.jointAngles.rightWristDeviation);
    }

    // Trim buffer if exceeds max
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  /**
   * Update ROM min/max tracker
   * @param {string} joint
   * @param {number} angle
   */
  _updateROM(joint, angle) {
    if (angle < this._romTracker[joint].min) this._romTracker[joint].min = angle;
    if (angle > this._romTracker[joint].max) this._romTracker[joint].max = angle;
  }

  /**
   * Get Range of Motion for each joint
   * @returns {Object}
   */
  getROM() {
    const rom = {};
    for (const [joint, tracker] of Object.entries(this._romTracker)) {
      if (tracker.min === Infinity) {
        rom[joint] = 0;
      } else {
        rom[joint] = MathUtils.roundTo(tracker.max - tracker.min, 1);
      }
    }
    return rom;
  }

  /**
   * Get the last N samples
   * @param {number} n
   * @returns {import('./SensorData.js').SensorDataSample[]}
   */
  getLastN(n) {
    return this.samples.slice(-n);
  }

  /**
   * Get latest sample
   * @returns {import('./SensorData.js').SensorDataSample|null}
   */
  getLatest() {
    return this.samples.length > 0 ? this.samples[this.samples.length - 1] : null;
  }

  /**
   * Get time-series array for a specific data path
   * Examples: 'raw.upper_arm.ax', 'orientation.forearm.roll', 'jointAngles.elbowFlexion'
   * @param {string} path - Dot-notation path
   * @param {number} [windowSize] - Number of recent samples
   * @returns {number[]}
   */
  getTimeSeries(path, windowSize = null) {
    const data = windowSize ? this.getLastN(windowSize) : this.samples;
    return data.map(sample => {
      const parts = path.split('.');
      let value = sample;
      for (const part of parts) {
        if (value == null) return 0;
        value = value[part];
      }
      return typeof value === 'number' ? value : 0;
    });
  }

  /**
   * Get frame indices for X axis
   * @param {number} [windowSize]
   * @returns {number[]}
   */
  getFrameIndices(windowSize = null) {
    const data = windowSize ? this.getLastN(windowSize) : this.samples;
    return data.map(s => s.frameIndex);
  }

  /**
   * Get timestamps for X axis
   * @param {number} [windowSize]
   * @returns {number[]}
   */
  getTimestamps(windowSize = null) {
    const data = windowSize ? this.getLastN(windowSize) : this.samples;
    return data.map(s => MathUtils.roundTo(s.timestamp / 1000, 2)); // seconds
  }

  /**
   * Calculate statistics for a time series
   * @param {string} path
   * @returns {{mean: number, std: number, min: number, max: number, rms: number}}
   */
  getStats(path) {
    const data = this.getTimeSeries(path);
    if (data.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, rms: 0, current: 0 };
    }
    const mean = data.reduce((s, v) => s + v, 0) / data.length;
    return {
      mean: MathUtils.roundTo(mean, 2),
      std: MathUtils.roundTo(MathUtils.stdDev(data), 2),
      min: MathUtils.roundTo(Math.min(...data), 2),
      max: MathUtils.roundTo(Math.max(...data), 2),
      rms: MathUtils.roundTo(MathUtils.rms(data), 2),
      current: MathUtils.roundTo(data[data.length - 1], 2),
    };
  }

  /**
   * Get data duration in seconds
   * @returns {number}
   */
  getDuration() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0].timestamp;
    const last = this.samples[this.samples.length - 1].timestamp;
    return MathUtils.roundTo((last - first) / 1000, 1);
  }

  /**
   * Get actual sample rate (Hz)
   * @returns {number}
   */
  getActualSampleRate() {
    const duration = this.getDuration();
    if (duration <= 0) return 0;
    return MathUtils.roundTo(this.samples.length / duration, 1);
  }

  /**
   * Start recording
   */
  startRecording() {
    this.isRecording = true;
    this.startTime = Date.now();
    this.endTime = null;
  }

  /**
   * Stop recording
   */
  stopRecording() {
    this.isRecording = false;
    this.endTime = Date.now();
  }

  /**
   * Reset all data
   */
  reset() {
    this.samples = [];
    this.frameCounter = 0;
    this.totalSamplesReceived = 0;
    this.isRecording = false;
    this.startTime = null;
    this.endTime = null;
    for (const tracker of Object.values(this._romTracker)) {
      tracker.min = Infinity;
      tracker.max = -Infinity;
    }
  }

  /**
   * Export all data as JSON
   * @returns {Object}
   */
  toJSON() {
    return {
      metadata: {
        totalSamples: this.totalSamplesReceived,
        duration: this.getDuration(),
        sampleRate: this.getActualSampleRate(),
        startTime: this.startTime,
        endTime: this.endTime,
        rom: this.getROM(),
      },
      samples: this.samples,
    };
  }

  /**
   * Export as CSV string
   * @returns {string}
   */
  toCSV() {
    const segments = [ArmSegment.UPPER_ARM, ArmSegment.FOREARM, ArmSegment.WRIST];
    const headers = ['frame', 'timestamp_ms'];

    for (const seg of segments) {
      headers.push(
        `${seg}_ax`, `${seg}_ay`, `${seg}_az`,
        `${seg}_gx`, `${seg}_gy`, `${seg}_gz`,
        `${seg}_cal_ax`, `${seg}_cal_ay`, `${seg}_cal_az`,
        `${seg}_cal_gx`, `${seg}_cal_gy`, `${seg}_cal_gz`,
        `${seg}_roll`, `${seg}_pitch`, `${seg}_yaw`
      );
    }
    headers.push('shoulder_flexion', 'shoulder_abduction', 'elbow_flexion', 'wrist_flexion', 'wrist_deviation');

    const rows = [headers.join(',')];
    for (const sample of this.samples) {
      const row = [sample.frameIndex, sample.timestamp];
      for (const seg of segments) {
        const r = sample.raw[seg];
        const c = sample.calibrated[seg];
        const o = sample.orientation[seg];
        row.push(
          r.ax, r.ay, r.az, r.gx, r.gy, r.gz,
          c.ax, c.ay, c.az, c.gx, c.gy, c.gz,
          o.roll, o.pitch, o.yaw
        );
      }
      const j = sample.jointAngles;
      row.push(j.shoulderFlexion, j.shoulderAbduction, j.elbowFlexion, j.wristFlexion, j.wristDeviation);
      rows.push(row.join(','));
    }
    return rows.join('\n');
  }
}
