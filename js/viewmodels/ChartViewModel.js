/**
 * ChartViewModel - Prepares data for Chart.js rendering
 * Handles buffer windowing, throttled updates, and dataset formatting.
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, BUFFER_CONFIG, CHART_CONFIG, ArmSegment, SEGMENT_LABELS, SEGMENT_COLORS, AXIS_COLORS, SENSOR_CONFIG } from '../utils/Constants.js';
import { SignalProcessing } from '../services/SignalProcessing.js';

export class ChartViewModel {
  /**
   * @param {import('./DataProcessingVM.js').DataProcessingViewModel} dataVM
   */
  constructor(dataVM) {
    this.dataVM = dataVM;
    this._chartWindow = BUFFER_CONFIG.CHART_WINDOW;
    this._lastUpdate = 0;
    this._updateInterval = CHART_CONFIG.UPDATE_INTERVAL_MS;
    this._pendingUpdate = false;
  }

  /**
   * Initialize and listen for processed data
   */
  init() {
    eventBus.on(Events.PROCESSED_DATA_READY, () => {
      this._scheduleUpdate();
    });
  }

  /**
   * Schedule throttled chart update
   * @private
   */
  _scheduleUpdate() {
    if (this._pendingUpdate) return;

    const now = performance.now();
    const elapsed = now - this._lastUpdate;

    if (elapsed >= this._updateInterval) {
      this._lastUpdate = now;
      eventBus.emit('charts:update');
    } else {
      this._pendingUpdate = true;
      setTimeout(() => {
        this._pendingUpdate = false;
        this._lastUpdate = performance.now();
        eventBus.emit('charts:update');
      }, this._updateInterval - elapsed);
    }
  }

  /** Get chart window size */
  get windowSize() {
    return this._chartWindow;
  }

  /** Set chart window size */
  set windowSize(size) {
    this._chartWindow = Math.max(50, Math.min(BUFFER_CONFIG.MAX_SAMPLES, size));
  }

  /**
   * Get frame labels (X-axis)
   * @returns {number[]}
   */
  getLabels() {
    return this.dataVM.session.getFrameIndices(this._chartWindow);
  }

  /**
   * Get time labels in seconds
   * @returns {number[]}
   */
  getTimeLabels() {
    return this.dataVM.session.getTimestamps(this._chartWindow);
  }

  // ═══════════════════════════════════════════════
  //   DATASET GENERATORS FOR EACH CHART TYPE
  // ═══════════════════════════════════════════════

  /**
   * Accelerometer XYZ for a specific segment
   * @param {string} segment - ArmSegment value
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getAccelData(segment) {
    const session = this.dataVM.session;
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: `Accel X`,
          data: session.getTimeSeries(`raw.${segment}.ax`, this._chartWindow),
          borderColor: AXIS_COLORS.x,
          backgroundColor: AXIS_COLORS.x + '20',
        },
        {
          label: `Accel Y`,
          data: session.getTimeSeries(`raw.${segment}.ay`, this._chartWindow),
          borderColor: AXIS_COLORS.y,
          backgroundColor: AXIS_COLORS.y + '20',
        },
        {
          label: `Accel Z`,
          data: session.getTimeSeries(`raw.${segment}.az`, this._chartWindow),
          borderColor: AXIS_COLORS.z,
          backgroundColor: AXIS_COLORS.z + '20',
        },
      ],
    };
  }

  /**
   * Gyroscope XYZ for a specific segment
   * @param {string} segment
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getGyroData(segment) {
    const session = this.dataVM.session;
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: `Gyro X`,
          data: session.getTimeSeries(`raw.${segment}.gx`, this._chartWindow),
          borderColor: AXIS_COLORS.x,
          backgroundColor: AXIS_COLORS.x + '20',
        },
        {
          label: `Gyro Y`,
          data: session.getTimeSeries(`raw.${segment}.gy`, this._chartWindow),
          borderColor: AXIS_COLORS.y,
          backgroundColor: AXIS_COLORS.y + '20',
        },
        {
          label: `Gyro Z`,
          data: session.getTimeSeries(`raw.${segment}.gz`, this._chartWindow),
          borderColor: AXIS_COLORS.z,
          backgroundColor: AXIS_COLORS.z + '20',
        },
      ],
    };
  }

  /**
   * Roll/Pitch/Yaw orientation for a specific segment
   * @param {string} segment
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getOrientationData(segment) {
    const session = this.dataVM.session;
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: 'Roll',
          data: session.getTimeSeries(`orientation.${segment}.roll`, this._chartWindow),
          borderColor: AXIS_COLORS.x,
          backgroundColor: AXIS_COLORS.x + '20',
        },
        {
          label: 'Pitch',
          data: session.getTimeSeries(`orientation.${segment}.pitch`, this._chartWindow),
          borderColor: AXIS_COLORS.y,
          backgroundColor: AXIS_COLORS.y + '20',
        },
        {
          label: 'Yaw',
          data: session.getTimeSeries(`orientation.${segment}.yaw`, this._chartWindow),
          borderColor: AXIS_COLORS.z,
          backgroundColor: AXIS_COLORS.z + '20',
        },
      ],
    };
  }

  /**
   * Joint angles over time (all joints)
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getJointAnglesData() {
    const session = this.dataVM.session;
    const colors = ['#3b82f6', '#06b6d4', '#ef4444', '#f97316']; // L-Shoulder, L-Elbow, R-Shoulder, R-Elbow

    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: 'L-Shoulder Flexion',
          data: session.getTimeSeries('jointAngles.leftShoulderFlexion', this._chartWindow),
          borderColor: colors[0],
          backgroundColor: colors[0] + '20',
        },
        {
          label: 'L-Elbow Flexion',
          data: session.getTimeSeries('jointAngles.leftElbowFlexion', this._chartWindow),
          borderColor: colors[1],
          backgroundColor: colors[1] + '20',
        },
        {
          label: 'R-Shoulder Flexion',
          data: session.getTimeSeries('jointAngles.rightShoulderFlexion', this._chartWindow),
          borderColor: colors[2],
          backgroundColor: colors[2] + '20',
        },
        {
          label: 'R-Elbow Flexion',
          data: session.getTimeSeries('jointAngles.rightElbowFlexion', this._chartWindow),
          borderColor: colors[3],
          backgroundColor: colors[3] + '20',
        },
      ],
    };
  }

  /**
   * Angular velocity per joint
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getAngularVelocityData() {
    const session = this.dataVM.session;
    const joints = ['leftShoulderFlexion', 'leftElbowFlexion', 'rightShoulderFlexion', 'rightElbowFlexion'];
    const labels = ['L-Shoulder', 'L-Elbow', 'R-Shoulder', 'R-Elbow'];
    const colors = ['#3b82f6', '#06b6d4', '#ef4444', '#f97316'];
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;

    const datasets = joints.map((joint, i) => {
      const angles = session.getTimeSeries(`jointAngles.${joint}`, this._chartWindow);
      const velocity = [0];
      for (let j = 1; j < angles.length; j++) {
        velocity.push(Math.round(((angles[j] - angles[j - 1]) / dt) * 100) / 100);
      }
      return {
        label: `${labels[i]} (°/s)`,
        data: velocity,
        borderColor: colors[i],
        backgroundColor: colors[i] + '20',
      };
    });

    return { labels: this.getLabels(), datasets };
  }

  /**
   * FFT spectrum data for a specific path
   * @param {string} path
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getFFTData(path) {
    const { frequencies, magnitudes } = this.dataVM.getFFT(path);
    return {
      labels: frequencies,
      datasets: [{
        label: 'Magnitude',
        data: magnitudes,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.3)',
        fill: true,
      }],
    };
  }

  /**
   * Movement trajectory (XY plane from accel)
   * @param {string} segment
   * @returns {{ datasets: Object[] }}
   */
  getTrajectoryData(segment) {
    const session = this.dataVM.session;
    const rollData = session.getTimeSeries(`orientation.${segment}.roll`, this._chartWindow);
    const pitchData = session.getTimeSeries(`orientation.${segment}.pitch`, this._chartWindow);

    const xyData = rollData.map((r, i) => ({ x: r, y: pitchData[i] || 0 }));

    return {
      datasets: [{
        label: SEGMENT_LABELS[segment],
        data: xyData,
        borderColor: SEGMENT_COLORS[segment],
        backgroundColor: SEGMENT_COLORS[segment] + '40',
        showLine: true,
        pointRadius: 0,
      }],
    };
  }

  /**
   * ROM comparison bar chart data
   * @returns {{ labels: string[], datasets: Object[] }}
   */
  getROMData() {
    const rom = this.dataVM.session.getROM();
    return {
      labels: ['L-Shoulder', 'L-Elbow', 'R-Shoulder', 'R-Elbow'],
      datasets: [
        {
          label: 'Measured ROM (°)',
          data: [
            rom.leftShoulderFlexion || 0,
            rom.leftElbowFlexion || 0,
            rom.rightShoulderFlexion || 0,
            rom.rightElbowFlexion || 0,
          ],
          backgroundColor: ['#3b82f6', '#06b6d4', '#ef4444', '#f97316'],
          borderRadius: 6,
        },
        {
          label: 'Normal ROM (°)',
          data: [180, 150, 180, 150],
          backgroundColor: 'rgba(148, 163, 184, 0.2)',
          borderRadius: 6,
        },
      ],
    };
  }

  /**
   * Get A/A (Adduction/Abduction) time-series data for individual joint charts
   * @param {string} jointPath - e.g. 'jointAngles.leftShoulderAbduction'
   * @param {string} label
   * @param {string} color
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getAAChartData(jointPath, label, color) {
    const session = this.dataVM.session;
    return {
      labels: this.getLabels(),
      datasets: [{
        label: label,
        data: session.getTimeSeries(jointPath, this._chartWindow),
        borderColor: color,
        backgroundColor: color + '20',
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
      }],
    };
  }

  /**
   * Get current statistics for stat cards
   * @returns {Object}
   */
  getCurrentStats() {
    const latest = this.dataVM.session.getLatest();
    const stats = this.dataVM.getStats();

    if (!latest) {
      return {
        leftShoulderAngle: 0,
        leftElbowAngle: 0,
        rightShoulderAngle: 0,
        rightElbowAngle: 0,
        sampleRate: 0,
      };
    }

    return {
      leftShoulderAngle: latest.jointAngles.leftShoulderFlexion || 0,
      leftElbowAngle: latest.jointAngles.leftElbowFlexion || 0,
      rightShoulderAngle: latest.jointAngles.rightShoulderFlexion || 0,
      rightElbowAngle: latest.jointAngles.rightElbowFlexion || 0,
      sampleRate: stats.actualRate,
    };
  }

  // ═══════════════════════════════════════════
  //   CLINICAL ANALYSIS — IMU Pipeline
  //   Ref: imu_to_chart_pipeline_stepper.html
  // ═══════════════════════════════════════════

  /**
   * Moving average filter (low-pass approximation, Pipeline Step 1)
   */
  _smooth(data, windowSize = 5) {
    const half = Math.floor(windowSize / 2);
    return data.map((_, i) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
        sum += data[j];
        count++;
      }
      return sum / count;
    });
  }

  /**
   * Pipeline Step 4: ω(t) = Δθ/Δt, then re-filter
   * "Lọc lại sau đạo hàm (nhiễu khuếch đại)"
   */
  _computeVelocity(angle, dt) {
    const raw = [0];
    for (let i = 1; i < angle.length; i++) {
      raw.push((angle[i] - angle[i - 1]) / dt);
    }
    return this._smooth(raw, 9); // re-filter (fc≈10Hz equiv)
  }

  /**
   * Pipeline Step 5: SPARC — Spectral Arc Length via FFT
   * SPARC ∈ (-∞, 0): -1~-2 = smooth, < -2.5 = problematic
   */
  _computeSPARC(velocity, dt) {
    const N = velocity.length;
    if (N < 16) return 0;

    // 1. Normalize: v̂ = v / max(|v|)
    const maxV = Math.max(...velocity.map(Math.abs)) || 1e-8;
    const vNorm = velocity.map(v => v / maxV);

    // 2. DFT magnitude spectrum (positive freqs)
    const nFreqs = Math.floor(N / 2) + 1;
    const spectrum = new Array(nFreqs);
    for (let k = 0; k < nFreqs; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const a = -2 * Math.PI * k * n / N;
        re += vNorm[n] * Math.cos(a);
        im += vNorm[n] * Math.sin(a);
      }
      spectrum[k] = Math.sqrt(re * re + im * im) / N;
    }

    // 3. Frequency axis & cutoff
    const fs = 1 / dt;
    const fc = Math.min(20, fs / 2);
    const nUsable = Math.min(nFreqs, Math.ceil(fc * N / fs));

    // 4. Arc length: L = -∫ sqrt((1/ωc)² + |dV/dω|²) dω
    let arcLength = 0;
    for (let k = 1; k < nUsable; k++) {
      const df = fs / N;
      const dV = (spectrum[k] - spectrum[k - 1]) / df;
      arcLength += Math.sqrt((1 / fc) ** 2 + dV * dV) * df;
    }
    return -arcLength;
  }

  /**
   * Clinical summary stats (Pipeline Steps 3-5)
   */
  getClinicalStats(jointPath) {
    const rawData = this.dataVM.session.getTimeSeries(jointPath, this._chartWindow);
    if (rawData.length < 16) return { rom: 0, peakVelocity: 0, sparc: 0, tremorIndex: 0 };

    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const data = this._smooth(rawData, 5);
    const rom = Math.max(...data) - Math.min(...data);

    const velocity = this._computeVelocity(data, dt);
    const peakVelocity = Math.max(...velocity.map(Math.abs));
    const sparc = this._computeSPARC(velocity, dt);

    // Tremor Index: high-freq residual ratio
    const smoothVel = this._smooth(velocity, 15);
    const velMean = velocity.reduce((s, v) => s + v, 0) / velocity.length;
    let totalVar = 0, hfVar = 0;
    for (let i = 0; i < velocity.length; i++) {
      totalVar += (velocity[i] - velMean) ** 2;
      hfVar += (velocity[i] - smoothVel[i]) ** 2;
    }
    const tremorIndex = totalVar > 0 ? hfVar / totalVar : 0;

    return {
      rom: Math.round(rom * 10) / 10,
      peakVelocity: Math.round(peakVelocity * 10) / 10,
      sparc: Math.round(sparc * 100) / 100,
      tremorIndex: Math.round(tremorIndex * 100) / 100,
    };
  }

  /**
   * Velocity & Acceleration time-series (Pipeline Step 4)
   */
  getVelocityAccelerationData(jointPath) {
    const rawData = this.dataVM.session.getTimeSeries(jointPath, this._chartWindow);
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const labels = this.getLabels();

    const data = this._smooth(rawData, 5);
    const velocity = this._computeVelocity(data, dt);
    const acceleration = this._computeVelocity(velocity, dt);

    return {
      labels,
      datasets: [
        {
          label: 'Vận tốc góc (°/s)',
          data: velocity,
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true, borderWidth: 1.5, pointRadius: 0,
        },
        {
          label: 'Gia tốc góc (°/s²)',
          data: acceleration,
          borderColor: '#f97316',
          backgroundColor: '#f9731620',
          fill: true, borderWidth: 1.5, pointRadius: 0,
        },
      ],
    };
  }

  /**
   * Phase Portrait: θ vs ω (Pipeline Step 5)
   */
  getPhasePortraitData(jointPath) {
    const rawData = this.dataVM.session.getTimeSeries(jointPath, this._chartWindow);
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;

    const data = this._smooth(rawData, 5);
    const velocity = this._computeVelocity(data, dt);

    const points = data.map((d, i) => ({ x: d, y: velocity[i] }));
    const colors = points.map((_, i) => {
      const t = i / points.length;
      return `rgba(${Math.round(99 + t * 156)},${Math.round(102 - t * 50)},241,0.7)`;
    });

    return {
      datasets: [{
        label: 'Quỹ đạo pha',
        data: points, backgroundColor: colors,
        pointRadius: 3, pointHoverRadius: 5, showLine: false,
      }],
    };
  }

  /**
   * Jerk with spike detection (Pipeline Step 5)
   * jerk = d(acceleration)/dt
   */
  getJerkData(jointPath) {
    const rawData = this.dataVM.session.getTimeSeries(jointPath, this._chartWindow);
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const labels = this.getLabels();

    const data = this._smooth(rawData, 5);
    const velocity = this._computeVelocity(data, dt);
    const acceleration = this._computeVelocity(velocity, dt);
    const jerk = this._computeVelocity(acceleration, dt).map(Math.abs);

    const mean = jerk.reduce((s, v) => s + v, 0) / Math.max(jerk.length, 1);
    const std = Math.sqrt(jerk.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(jerk.length, 1));
    const threshold = mean + 2 * std;

    return {
      labels,
      datasets: [
        {
          label: 'Jerk bình thường', data: jerk.map(v => v <= threshold ? v : 0),
          backgroundColor: '#22c55e80', borderColor: '#22c55e', borderWidth: 1, type: 'bar',
        },
        {
          label: 'Spike bất thường', data: jerk.map(v => v > threshold ? v : 0),
          backgroundColor: '#ef444480', borderColor: '#ef4444', borderWidth: 1, type: 'bar',
        },
      ],
    };
  }
}

