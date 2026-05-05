/**
 * DashboardView - Main view rendering and DOM management
 * Handles page rendering, chart initialization, and UI updates.
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, Pages, PAGE_CONFIG, ArmSegment, SEGMENT_LABELS, SEGMENT_COLORS, ConnectionState, NORMAL_ROM } from '../utils/Constants.js';
import { ChartView } from './ChartView.js';
import { ExportService } from '../services/ExportService.js';
import { HistoryView } from './HistoryView.js';

export class DashboardView {
  /**
   * @param {import('../viewmodels/DashboardViewModel.js').DashboardViewModel} dashboardVM
   * @param {import('../viewmodels/ChartViewModel.js').ChartViewModel} chartVM
   * @param {import('../viewmodels/DataProcessingVM.js').DataProcessingViewModel} dataVM
   */
  constructor(dashboardVM, chartVM, dataVM) {
    this.dashboardVM = dashboardVM;
    this.chartVM = chartVM;
    this.dataVM = dataVM;
    this.chartView = new ChartView();
    this.historyView = null; // Will be instantiated when navigating to history page

    // DOM Elements
    this.$content = document.getElementById('content-area');
    this.$headerTitle = document.getElementById('header-title');
    this.$connectionBtn = document.getElementById('btn-connect');
    this.$usbBtn = document.getElementById('btn-usb');
    this.$recordBtn = document.getElementById('btn-record');
    this.$statusDot = document.getElementById('status-dot');
    this.$statusLabel = document.getElementById('status-label');
    this.$sampleRateDisplay = document.getElementById('sample-rate-display');
    this.$frameCountDisplay = document.getElementById('frame-count-display');

    this._currentPage = null;
    this._updateRAF = null;
  }

  /**
   * Initialize view - bind events and render initial page
   */
  init() {
    this._bindSidebarNavigation();
    this._bindHeaderActions();
    this._listenForEvents();
    this.renderPage(Pages.DASHBOARD);
  }

  /**
   * Bind sidebar navigation clicks
   * @private
   */
  _bindSidebarNavigation() {
    document.querySelectorAll('.sidebar-nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        this.dashboardVM.navigateTo(page);
      });
    });
  }

  /**
   * Bind header action buttons
   * @private
   */
  _bindHeaderActions() {
    // BLE Bluetooth Connect button
    this.$connectionBtn?.addEventListener('click', async () => {
      const state = this.dashboardVM.connectionVM.state;
      if (state === ConnectionState.CONNECTED) {
        await this.dashboardVM.disconnect();
      } else {
        await this.dashboardVM.connect();
      }
    });

    // USB Cable Connect button
    this.$usbBtn?.addEventListener('click', async () => {
      const state = this.dashboardVM.connectionVM.state;
      if (state === ConnectionState.CONNECTED) {
        await this.dashboardVM.disconnect();
      } else {
        await this.dashboardVM.connectUSB();
      }
    });

    // Record button - Prompt for patient name
    this.$recordBtn?.addEventListener('click', () => {
      if (this.dashboardVM.isRecording) {
        // Stop recording
        this.dashboardVM.toggleRecording();
        this._updateRecordButton();
      } else {
        // Prompt for patient name
        const patientName = prompt('🏥 Nhập tên bệnh nhân hoặc mã hồ sơ:');
        if (patientName === null) return; // User cancelled
        this.dashboardVM.toggleRecording(patientName.trim() || 'Không rõ');
        this._updateRecordButton();
      }
    });

    // Export buttons
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      this.dashboardVM.exportCSV();
    });

    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      this.dashboardVM.exportJSON();
    });

    // Reset button
    document.getElementById('btn-reset')?.addEventListener('click', () => {
      this.dashboardVM.resetData();
      this.renderPage(this._currentPage);
    });

    // Calibrate button
    document.getElementById('btn-calibrate')?.addEventListener('click', () => {
      this.dashboardVM.startCalibration();
    });
  }

  /**
   * Listen for ViewModel events
   * @private
   */
  _listenForEvents() {
    // Page change
    eventBus.on(Events.TAB_CHANGED, (page) => {
      this.renderPage(page);
      this._updateActiveNav(page);
    });

    // Connection state
    eventBus.on(Events.CONNECTION_STATE_CHANGED, (state) => {
      this._updateConnectionUI(state);
      // Auto-show calibration overlay when connected
      if (state === ConnectionState.CONNECTED) {
        this._showCalibrationOverlay();
      }
    });

    // Chart data updates
    eventBus.on('charts:update', () => {
      this._updateCharts();
      this._updateStatCards();
      this._updateStatusBar();
    });

    // Calibration
    eventBus.on(Events.CALIBRATION_PROGRESS, (progress) => {
      this._updateCalibrationOverlay(progress);
    });

    eventBus.on(Events.CALIBRATION_COMPLETE, () => {
      this._hideCalibrationOverlay();
    });

    // Update debug UI periodically even if no charts are rendering
    setInterval(() => {
      if (this.dashboardVM.connectionVM.state === ConnectionState.CONNECTED) {
        this._updateStatusBar();
      }
    }, 1000);
  }

  // ═══════════════════════════════════════════
  //   PAGE RENDERING
  // ═══════════════════════════════════════════

  /**
   * Render a page
   * @param {string} page
   */
  renderPage(page) {
    this._currentPage = page;
    this.chartView.destroyAll(); // Destroy previous charts

    const config = PAGE_CONFIG[page];
    if (this.$headerTitle) {
      this.$headerTitle.textContent = config?.label || 'Dashboard';
    }

    switch (page) {
      case Pages.DASHBOARD:     this._renderDashboard(); break;
      case Pages.RAW_DATA:      this._renderRawData(); break;
      case Pages.ANGLE:         this._renderAngle(); break;
      case Pages.ROM:           this._renderROM(); break;
      case Pages.DATA_TABLE:
        this._renderDataTable();
        break;
      
      case 'history':
        this.$content.innerHTML = `<div id="history-container"></div>`;
        if (!this.historyView) {
          this.historyView = new HistoryView('history-container', this.dataVM);
        } else {
          this.historyView.container = document.getElementById('history-container');
        }
        this.historyView.render();
        break;

      case Pages.CLINICAL:    this._renderClinical(); break;
      case Pages.SETTINGS:    this._renderSettings(); break;
      default:                this._renderDashboard(); break;
    }

    this._updateActiveNav(page);
  }

  /**
   * Render Dashboard (overview with stat cards + key charts)
   * @private
   */
  _renderDashboard() {
    this.$content.innerHTML = `
      <!-- Stat Cards -->
      <div class="stat-grid page-section" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
        <div class="card stat-card" id="stat-l-shoulder">
          <div class="stat-card-icon primary">💪</div>
          <div class="stat-card-label">L-Shoulder</div>
          <div class="stat-card-value"><span id="val-l-shoulder">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-l-elbow">
          <div class="stat-card-icon warning">🦾</div>
          <div class="stat-card-label">L-Elbow</div>
          <div class="stat-card-value"><span id="val-l-elbow">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-r-shoulder">
          <div class="stat-card-icon danger" style="background: var(--color-danger-soft); color: var(--color-danger);">💪</div>
          <div class="stat-card-label">R-Shoulder</div>
          <div class="stat-card-value"><span id="val-r-shoulder">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-r-elbow">
          <div class="stat-card-icon info" style="background: var(--color-info-soft); color: var(--color-info);">🦾</div>
          <div class="stat-card-label">R-Elbow</div>
          <div class="stat-card-value"><span id="val-r-elbow">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-rate">
          <div class="stat-card-icon success">📡</div>
          <div class="stat-card-label">Rate</div>
          <div class="stat-card-value"><span id="val-rate">0</span><span class="stat-card-unit">Hz</span></div>
        </div>
      </div>

      <!-- Joint Angles Chart -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">📐</span> Joint Angles</div>
            <div class="section-subtitle">Real-time joint angle tracking (Shoulder, Elbow, Wrist)</div>
          </div>
        </div>
        <div class="card chart-card">
          <div class="card-body">
            <div class="chart-container large">
              <canvas id="chart-dashboard-joints"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- Overview Charts Grid -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">🔍</span> Sensor Overview</div>
            <div class="section-subtitle">Raw accelerometer data from 2 segments (Upper Arm & Forearm)</div>
          </div>
        </div>
        <div class="chart-grid chart-grid-2col">
          ${this._renderSensorChartCards('accel-overview', 'Accelerometer')}
        </div>
      </div>

      <!-- ROM + Trajectory -->
      <div class="page-section">
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: var(--color-accent-primary)"></span> Range of Motion</div>
            </div>
            <div class="card-body">
              <div class="chart-container medium">
                <canvas id="chart-dashboard-rom"></canvas>
              </div>
            </div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: var(--color-error)"></span> Connection Debug</div>
            </div>
            <div class="card-body">
              <div style="background: #0f172a; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; color: #38bdf8; overflow-x: auto; white-space: pre-wrap; height: 100%; min-height: 150px; border: 1px solid #1e293b;">
                <div style="color: #94a3b8; margin-bottom: 8px;">Latest Raw Data Received:</div>
                <div id="debug-raw-data" style="word-break: break-all;">Waiting for data... Connect device.</div>
                <div style="margin-top: 12px; color: #94a3b8; border-top: 1px dashed #334155; padding-top: 8px;">
                  Parse Errors: <span id="debug-parse-errors" style="color: #ef4444;">0</span> | Format: <span id="debug-data-format" style="color: #10b981;">N/A</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._initChart('chart-dashboard-joints', 'line');
    this._initSensorCharts('accel-overview');
    this._initChart('chart-dashboard-rom', 'bar');
  }

  /**
   * Render Raw Data page
   * @private
   */
  _renderRawData() {
    this.$content.innerHTML = `
      <!-- Accelerometer Charts -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">📈</span> Accelerometer Data</div>
            <div class="section-subtitle">Raw accelerometer XYZ readings (g) per segment</div>
          </div>
        </div>
        <div class="chart-grid chart-grid-2col">
          ${this._renderSensorChartCards('raw-accel', 'Accelerometer')}
        </div>
      </div>

      <!-- Gyroscope Charts -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">🌀</span> Gyroscope Data</div>
            <div class="section-subtitle">Raw gyroscope XYZ readings (°/s) per segment</div>
          </div>
        </div>
        <div class="chart-grid chart-grid-2col">
          ${this._renderSensorChartCards('raw-gyro', 'Gyroscope')}
        </div>
      </div>
    `;

    this._initSensorCharts('raw-accel');
    this._initSensorCharts('raw-gyro');
  }

  /**
   * Render Angle page (Orientation + Joints)
   * @private
   */
  _renderAngle() {
    this.$content.innerHTML = `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">🧭</span> Euler Angles (Roll / Pitch / Yaw)</div>
            <div class="section-subtitle">Orientation after Complementary Filter sensor fusion</div>
          </div>
        </div>
        <div class="chart-grid chart-grid-2col">
          ${this._renderSensorChartCards('orientation', 'Orientation')}
        </div>
      </div>

      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">💪</span> Joint Angles Over Time</div>
            <div class="section-subtitle">Computed joint angles from segment orientations</div>
          </div>
        </div>
        <div class="card chart-card">
          <div class="card-body">
            <div class="chart-container xlarge">
              <canvas id="chart-joint-angles"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;

    this._initSensorCharts('orientation');
    this._initChart('chart-joint-angles', 'line');
  }

  /**
   * Render Range of Motion (ROM) page
   * @private
   */
  _renderROM() {
    this.$content.innerHTML = `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">📊</span> Range of Motion Analysis</div>
            <div class="section-subtitle">Maximal joint angles achieved during this session</div>
          </div>
        </div>
      </div>

      <div class="page-section">
        <div class="chart-grid chart-grid-2col">
          <!-- ROM Bar Chart -->
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: var(--color-accent-primary)"></span> Range of Motion Comparison</div>
            </div>
            <div class="card-body">
              <div class="chart-container large">
                <canvas id="chart-rom-bar"></canvas>
              </div>
            </div>
          </div>

          <!-- ROM Radar -->
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: var(--color-accent-tertiary)"></span> ROM Radar Profile</div>
            </div>
            <div class="card-body">
              <div class="chart-container large">
                <canvas id="chart-rom-radar"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ROM Progress Bars & Mobility Score -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">📋</span> ROM vs Normal Range</div>
          </div>
        </div>
        <div class="card">
          <div class="card-body" style="display: flex; gap: 20px;">
            <div style="flex: 1; text-align: center; border-right: 1px solid var(--border-color); display: flex; flex-direction: column; justify-content: center;">
              <h3 style="margin-bottom: 10px; color: var(--text-secondary);">Mobility Score</h3>
              <div id="live-mobility-score" style="font-size: 4rem; color: var(--color-primary); font-weight: bold; line-height: 1;">0%</div>
              <p style="color: var(--text-muted); margin-top: 10px;">So với mức bình thường</p>
            </div>
            <div class="rom-bar-container" id="rom-bars" style="flex: 2;">
              ${this._renderROMBars()}
            </div>
          </div>
        </div>
      </div>

      <!-- A/A Time-Series Charts (Adduction/Abduction) -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">📈</span> A/A - Adduction / Abduction</div>
            <div class="section-subtitle">Biểu đồ góc Adduction/Abduction theo thời gian cho từng khớp</div>
          </div>
        </div>
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #3b82f6;">💪 L-Shoulder A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-l-shoulder"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #ef4444;">💪 R-Shoulder A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-r-shoulder"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #06b6d4;">🦾 L-Wrist A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-l-wrist"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #f97316;">🦾 R-Wrist A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-r-wrist"></canvas></div></div>
          </div>
        </div>
      </div>
    `;

    this._initChart('chart-rom-bar', 'bar');
    this._initChart('chart-rom-radar', 'radar');
    this._initChart('chart-aa-l-shoulder', 'line');
    this._initChart('chart-aa-r-shoulder', 'line');
    this._initChart('chart-aa-l-wrist', 'line');
    this._initChart('chart-aa-r-wrist', 'line');
  }

  /**
   * Render Data Table page
   * @private
   */
  _renderDataTable() {
    this.$content.innerHTML = `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">📋</span> Live Data Table</div>
            <div class="section-subtitle">Dữ liệu góc khớp thời gian thực - 2 tay (Dual-Arm)</div>
          </div>
          <div class="section-actions">
            <button class="btn btn-secondary btn-sm" id="btn-copy-clipboard">📋 Copy</button>
            <button class="btn btn-secondary btn-sm" id="btn-table-export-csv">📥 CSV</button>
          </div>
        </div>
        <div class="card" style="overflow-x: auto;">
          <div class="card-body" style="padding: 0;">
            <table class="data-table" id="live-data-table">
              <thead>
                <tr>
                  <th>Frame</th>
                  <th>Time (s)</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_UPPER_ARM]}">L-Shoulder</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_FOREARM]}">L-Elbow</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_WRIST]}">L-Wrist</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_UPPER_ARM]}">R-Shoulder</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_FOREARM]}">R-Elbow</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_WRIST]}">R-Wrist</th>
                </tr>
              </thead>
              <tbody id="live-data-tbody">
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Bind table actions
    document.getElementById('btn-copy-clipboard')?.addEventListener('click', async () => {
      const ok = await ExportService.copyToClipboard(this.dataVM.session);
      const btn = document.getElementById('btn-copy-clipboard');
      btn.textContent = ok ? '✅ Copied!' : '❌ Failed';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
    });

    document.getElementById('btn-table-export-csv')?.addEventListener('click', () => {
      this.dashboardVM.exportCSV();
    });
  }

  /**
   * Render Clinical Analysis page (5 medical charts)
   * @private
   */
  _renderClinical() {
    // Default joint for analysis
    this._clinicalJoint = 'jointAngles.leftElbowFlexion';
    this._clinicalJointLabel = 'Khuỷu tay trái';
    this._clinicalNormalMax = 145;

    this.$content.innerHTML = `
      <!-- Clinical Stat Cards -->
      <div class="stat-grid page-section" style="grid-template-columns: repeat(4, 1fr);">
        <div class="card stat-card">
          <div class="stat-card-icon primary">📐</div>
          <div class="stat-card-label">ROM ${this._clinicalJointLabel}</div>
          <div class="stat-card-value"><span id="clin-rom">0</span><span class="stat-card-unit">°</span></div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">bình thường ≥ ${this._clinicalNormalMax}°</div>
        </div>
        <div class="card stat-card">
          <div class="stat-card-icon warning">⚡</div>
          <div class="stat-card-label">Peak Velocity</div>
          <div class="stat-card-value"><span id="clin-peak-vel">0</span><span class="stat-card-unit"> °/s</span></div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">vận tốc đỉnh</div>
        </div>
        <div class="card stat-card">
          <div class="stat-card-icon" style="background: var(--color-success-soft); color: var(--color-success);">🌊</div>
          <div class="stat-card-label">Smoothness (SPARC)</div>
          <div class="stat-card-value"><span id="clin-sparc">0</span></div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">tốt (&gt; -2.5)</div>
        </div>
        <div class="card stat-card">
          <div class="stat-card-icon danger" style="background: var(--color-danger-soft); color: var(--color-danger);">🌀</div>
          <div class="stat-card-label">Tremor Index</div>
          <div class="stat-card-value"><span id="clin-tremor">0</span></div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">cao (&gt; 0.25)</div>
        </div>
      </div>

      <!-- Joint selector tabs -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">🩺</span> Phân tích Lâm sàng</div>
            <div class="section-subtitle">Chọn khớp cần phân tích — dữ liệu cập nhật realtime</div>
          </div>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
          <button class="btn btn-primary btn-sm clinical-joint-btn active" data-joint="jointAngles.leftElbowFlexion" data-label="Khuỷu tay trái" data-normal="145">Khuỷu tay trái</button>
          <button class="btn btn-secondary btn-sm clinical-joint-btn" data-joint="jointAngles.rightElbowFlexion" data-label="Khuỷu tay phải" data-normal="145">Khuỷu tay phải</button>
          <button class="btn btn-secondary btn-sm clinical-joint-btn" data-joint="jointAngles.leftShoulderFlexion" data-label="Vai trái" data-normal="180">Vai trái</button>
          <button class="btn btn-secondary btn-sm clinical-joint-btn" data-joint="jointAngles.rightShoulderFlexion" data-label="Vai phải" data-normal="180">Vai phải</button>
          <button class="btn btn-secondary btn-sm clinical-joint-btn" data-joint="jointAngles.leftWristFlexion" data-label="Cổ tay trái" data-normal="80">Cổ tay trái</button>
          <button class="btn btn-secondary btn-sm clinical-joint-btn" data-joint="jointAngles.rightWristFlexion" data-label="Cổ tay phải" data-normal="80">Cổ tay phải</button>
        </div>
      </div>

      <!-- Chart 1: Time-Series Position (X, Y, Z orientation) -->
      <div class="page-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background: #3b82f6;"></span> 1 — Time-Series vị trí (X, Y, Z)</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Vị trí 3 trục theo thời gian — phát hiện run tay, biên độ bất thường</div>
          </div>
          <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-timeseries"></canvas></div></div>
        </div>
      </div>

      <!-- Chart 2: Joint Angle Plot -->
      <div class="page-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background: #8b5cf6;"></span> 2 — Góc khớp <span id="clin-joint-name">khuỷu tay</span> theo thời gian</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Góc giữa vector vai→khuỷu và khuỷu→cổ tay. Bình thường 0–<span id="clin-normal-range">145</span>°</div>
          </div>
          <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-joint-angle"></canvas></div></div>
        </div>
      </div>

      <!-- Charts 3 & 4: Velocity/Acceleration + Phase Portrait -->
      <div class="page-section">
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: #06b6d4;"></span> 3 — Vận tốc & Gia tốc</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">Độ mượt và phát hiện bradykinesia</div>
            </div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-vel-acc"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: #a855f7;"></span> 4 — Phase Portrait</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">Vị trí vs Vận tốc — vòng méo = bất thường</div>
            </div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-phase"></canvas></div></div>
          </div>
        </div>
      </div>

      <!-- Chart 5: Jerk / Smoothness -->
      <div class="page-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background: #ef4444;"></span> 5 — Jerk (Smoothness) theo thời gian</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Đạo hàm bậc 3 của vị trí. Spike cao = chuyển động giật cục. <span style="color: #22c55e;">■</span> Bình thường <span style="color: #ef4444;">■</span> Bất thường</div>
          </div>
          <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-jerk"></canvas></div></div>
        </div>
      </div>
    `;

    // Initialize charts
    this._initChart('chart-clin-timeseries', 'line');
    this._initChart('chart-clin-joint-angle', 'line');
    this._initChart('chart-clin-vel-acc', 'line');
    this._initChart('chart-clin-phase', 'scatter');
    this._initChart('chart-clin-jerk', 'bar');

    // Joint selector tab events
    document.querySelectorAll('.clinical-joint-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.clinical-joint-btn').forEach(b => {
          b.className = 'btn btn-secondary btn-sm clinical-joint-btn';
        });
        btn.className = 'btn btn-primary btn-sm clinical-joint-btn active';
        this._clinicalJoint = btn.dataset.joint;
        this._clinicalJointLabel = btn.dataset.label;
        this._clinicalNormalMax = parseInt(btn.dataset.normal);
        this._setTextContent('clin-joint-name', this._clinicalJointLabel);
        this._setTextContent('clin-normal-range', this._clinicalNormalMax);
      });
    });
  }

  /**
   * Render Settings page
   * @private
   */
  _renderSettings() {
    const stats = this.dataVM.getStats();
    this.$content.innerHTML = `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title"><span class="section-title-icon">⚙️</span> Configuration</div>
          </div>
        </div>

        <div class="chart-grid chart-grid-2col">
          <!-- Filter Settings -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Low-pass Filter</div>
              <label class="toggle-switch">
                <input type="checkbox" id="toggle-lpf" ${stats.lowPassEnabled ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="card-body">
              <div class="connection-info">
                <div class="connection-info-row">
                  <span class="connection-info-label">Alpha (smoothing)</span>
                  <span class="connection-info-value" id="lpf-alpha-value">${stats.lowPassAlpha}</span>
                </div>
              </div>
              <input type="range" id="slider-lpf-alpha" min="0.05" max="0.5" step="0.01" value="${stats.lowPassAlpha}" style="width: 100%;">
              <p class="text-xs text-tertiary" style="margin-top: var(--space-2);">Lower α = smoother (more lag). Higher α = more responsive (more noise).</p>
            </div>
          </div>

          <!-- Fusion Settings -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Complementary Filter</div>
            </div>
            <div class="card-body">
              <div class="connection-info">
                <div class="connection-info-row">
                  <span class="connection-info-label">Alpha (gyro trust)</span>
                  <span class="connection-info-value" id="fusion-alpha-value">${stats.fusionAlpha}</span>
                </div>
              </div>
              <input type="range" id="slider-fusion-alpha" min="0.8" max="0.99" step="0.01" value="${stats.fusionAlpha}" style="width: 100%;">
              <p class="text-xs text-tertiary" style="margin-top: var(--space-2);">Higher α = more gyro trust (responsive but drifts). Lower α = more accel trust (stable but noisy).</p>

              <button class="btn btn-primary btn-sm" id="btn-settings-calibrate" style="margin-top: var(--space-4); width: 100%;">
                🔧 Start Calibration (keep arm still)
              </button>
            </div>
          </div>

          <!-- Chart Settings -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Chart Window</div>
            </div>
            <div class="card-body">
              <div class="connection-info">
                <div class="connection-info-row">
                  <span class="connection-info-label">Window size (frames)</span>
                  <span class="connection-info-value" id="window-size-value">${this.chartVM.windowSize}</span>
                </div>
              </div>
              <input type="range" id="slider-window" min="50" max="500" step="10" value="${this.chartVM.windowSize}" style="width: 100%;">
            </div>
          </div>

          <!-- Connection Info -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Connection Info</div>
            </div>
            <div class="card-body">
              <div class="connection-info">
                <div class="connection-info-row">
                  <span class="connection-info-label">Baud Rate</span>
                  <span class="connection-info-value">115200</span>
                </div>
                <div class="connection-info-row">
                  <span class="connection-info-label">Target Sample Rate</span>
                  <span class="connection-info-value">50 Hz</span>
                </div>
                <div class="connection-info-row">
                  <span class="connection-info-label">Data Format</span>
                  <span class="connection-info-value">${stats.dataFormat}</span>
                </div>
                <div class="connection-info-row">
                  <span class="connection-info-label">Parse Errors</span>
                  <span class="connection-info-value">${stats.parseErrors} (${stats.parseErrorRate}%)</span>
                </div>
                <div class="connection-info-row">
                  <span class="connection-info-label">Calibrated</span>
                  <span class="connection-info-value">${stats.isCalibrated ? '✅ Yes' : '❌ No'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind settings
    document.getElementById('toggle-lpf')?.addEventListener('change', (e) => {
      this.dataVM.setLowPassEnabled(e.target.checked);
    });

    document.getElementById('slider-lpf-alpha')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.dataVM.setLowPassAlpha(val);
      document.getElementById('lpf-alpha-value').textContent = val;
    });

    document.getElementById('slider-fusion-alpha')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.dataVM.setFusionAlpha(val);
      document.getElementById('fusion-alpha-value').textContent = val;
    });

    document.getElementById('slider-window')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      this.chartVM.windowSize = val;
      document.getElementById('window-size-value').textContent = val;
    });

    document.getElementById('btn-settings-calibrate')?.addEventListener('click', () => {
      this.dashboardVM.startCalibration();
    });
  }

  // ═══════════════════════════════════════════
  //   CHART HELPERS
  // ═══════════════════════════════════════════

  _renderSensorChartCards(prefix, dataType) {
    return Object.values(ArmSegment).map(seg => `
      <div class="card chart-card">
        <div class="card-header">
          <div class="card-title">
            <span class="card-title-icon" style="background: ${SEGMENT_COLORS[seg]}"></span>
            ${SEGMENT_LABELS[seg]}
          </div>
          <span class="text-xs text-tertiary">${dataType}</span>
        </div>
        <div class="card-body">
          <div class="chart-container medium">
            <canvas id="chart-${prefix}-${seg}"></canvas>
          </div>
        </div>
      </div>
    `).join('');
  }

  _initSensorCharts(prefix) {
    Object.values(ArmSegment).forEach(seg => {
      this._initChart(`${prefix}-${seg}`, 'line');
    });
  }

  _initChart(id, type, extraOptions = {}) {
    const canvas = document.getElementById(`chart-${id}`) || document.getElementById(id);
    if (!canvas) return;

    switch (type) {
      case 'line':    this.chartView.createLineChart(id, canvas, extraOptions); break;
      case 'bar':     this.chartView.createBarChart(id, canvas, extraOptions); break;
      case 'scatter': this.chartView.createScatterChart(id, canvas, extraOptions); break;
      case 'radar':   this.chartView.createRadarChart(id, canvas, extraOptions); break;
    }
  }

  _renderROMBars() {
    const rom = this.dataVM.session.getROM();
    const items = [
      { label: 'L-Shoulder Flexion', value: rom.leftShoulderFlexion || 0, normal: 180, color: '#3b82f6' },
      { label: 'L-Elbow Flexion', value: rom.leftElbowFlexion || 0, normal: 150, color: '#06b6d4' },
      { label: 'R-Shoulder Flexion', value: rom.rightShoulderFlexion || 0, normal: 180, color: '#ef4444' },
      { label: 'R-Elbow Flexion', value: rom.rightElbowFlexion || 0, normal: 150, color: '#f97316' },
    ];

    return items.map(item => {
      const pct = Math.min(100, (item.value / item.normal) * 100);
      const normalPct = 100;
      return `
        <div class="rom-bar-row">
          <span class="rom-bar-label" style="width: 140px;">${item.label}</span>
          <div class="rom-bar-track">
            <div class="rom-bar-fill" style="width: ${pct}%; background: ${item.color};" data-rom-key="${item.label}"></div>
            <div class="rom-bar-normal" style="left: ${normalPct}%"></div>
          </div>
          <span class="rom-bar-value" data-rom-value="${item.label}">${item.value}°</span>
        </div>
      `;
    }).join('');
  }

  // ═══════════════════════════════════════════
  //   REAL-TIME UPDATES
  // ═══════════════════════════════════════════

  _updateCharts() {
    switch (this._currentPage) {
      case Pages.DASHBOARD:     this._updateDashboardCharts(); break;
      case Pages.RAW_DATA:      this._updateRawDataCharts(); break;
      case Pages.ANGLE:         this._updateAngleCharts(); break;
      case Pages.ROM:           this._updateROMCharts(); break;
      case Pages.DATA_TABLE:    this._updateDataTable(); break;
      case Pages.CLINICAL:      this._updateClinicalCharts(); break;
    }
  }

  _updateClinicalCharts() {
    const joint = this._clinicalJoint || 'jointAngles.leftElbowFlexion';

    // Update stat cards
    const clinStats = this.chartVM.getClinicalStats(joint);
    this._setTextContent('clin-rom', clinStats.rom);
    this._setTextContent('clin-peak-vel', clinStats.peakVelocity);
    this._setTextContent('clin-sparc', clinStats.sparc);
    this._setTextContent('clin-tremor', clinStats.tremorIndex);

    // Determine which segment to show in time-series chart (XYZ orientation)
    // Parse the joint path to find which arm/segment
    const isLeft = joint.includes('left') || joint.includes('Left');
    const isWrist = joint.includes('rist') || joint.includes('Wrist');
    const isElbow = joint.includes('lbow') || joint.includes('Elbow');
    let segment;
    if (isLeft) {
      segment = isWrist ? ArmSegment.LEFT_WRIST : (isElbow ? ArmSegment.LEFT_FOREARM : ArmSegment.LEFT_UPPER_ARM);
    } else {
      segment = isWrist ? ArmSegment.RIGHT_WRIST : (isElbow ? ArmSegment.RIGHT_FOREARM : ArmSegment.RIGHT_UPPER_ARM);
    }

    // Chart 1: Time-series XYZ orientation
    this.chartView.updateChart('chart-clin-timeseries', this.chartVM.getOrientationData(segment));

    // Chart 2: Joint angle + normal range line
    const angleData = this.chartVM.getAAChartData(joint, this._clinicalJointLabel + ' (°)', '#8b5cf6');
    // Add a reference "Normal" line
    const normalMax = this._clinicalNormalMax || 145;
    angleData.datasets.push({
      label: `Ngưỡng bình thường (${normalMax}°)`,
      data: angleData.labels.map(() => normalMax),
      borderColor: 'rgba(148, 163, 184, 0.5)',
      borderWidth: 1,
      borderDash: [5, 5],
      pointRadius: 0,
      fill: false,
    });
    this.chartView.updateChart('chart-clin-joint-angle', angleData);

    // Chart 3: Velocity & Acceleration
    this.chartView.updateChart('chart-clin-vel-acc', this.chartVM.getVelocityAccelerationData(joint));

    // Chart 4: Phase Portrait
    this.chartView.updateChart('chart-clin-phase', this.chartVM.getPhasePortraitData(joint));

    // Chart 5: Jerk
    this.chartView.updateChart('chart-clin-jerk', this.chartVM.getJerkData(joint));
  }

  _updateDashboardCharts() {
    this.chartView.updateChart('chart-dashboard-joints', this.chartVM.getJointAnglesData());

    Object.values(ArmSegment).forEach(seg => {
      this.chartView.updateChart(`accel-overview-${seg}`, this.chartVM.getAccelData(seg));
    });

    this.chartView.updateChart('chart-dashboard-rom', this.chartVM.getROMData());
  }

  _updateRawDataCharts() {
    Object.values(ArmSegment).forEach(seg => {
      this.chartView.updateChart(`raw-accel-${seg}`, this.chartVM.getAccelData(seg));
      this.chartView.updateChart(`raw-gyro-${seg}`, this.chartVM.getGyroData(seg));
    });
  }

  _updateAngleCharts() {
    Object.values(ArmSegment).forEach(seg => {
      this.chartView.updateChart(`orientation-${seg}`, this.chartVM.getOrientationData(seg));
    });
    this.chartView.updateChart('chart-joint-angles', this.chartVM.getJointAnglesData());
  }

  _updateROMCharts() {
    this.chartView.updateChart('chart-rom-bar', this.chartVM.getROMData());

    // ROM Radar (Dual-Arm)
    const rom = this.dataVM.session.getROM();
    this.chartView.updateChart('chart-rom-radar', {
      labels: ['L-Shoulder', 'L-Elbow', 'R-Shoulder', 'R-Elbow'],
      datasets: [
        {
          label: 'Measured',
          data: [
            rom.leftShoulderFlexion || 0,
            rom.leftElbowFlexion || 0,
            rom.rightShoulderFlexion || 0,
            rom.rightElbowFlexion || 0,
          ],
          borderColor: 'rgba(99, 102, 241, 0.8)',
          backgroundColor: 'rgba(99, 102, 241, 0.2)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#6366f1',
        },
        {
          label: 'Normal',
          data: [180, 150, 180, 150],
          borderColor: 'rgba(148, 163, 184, 0.4)',
          backgroundColor: 'rgba(148, 163, 184, 0.05)',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
        },
      ],
    });

    // A/A Time-series charts
    this.chartView.updateChart('chart-aa-l-shoulder',
      this.chartVM.getAAChartData('jointAngles.leftShoulderAbduction', 'L-Shoulder Abduction (°)', '#3b82f6'));
    this.chartView.updateChart('chart-aa-r-shoulder',
      this.chartVM.getAAChartData('jointAngles.rightShoulderAbduction', 'R-Shoulder Abduction (°)', '#ef4444'));
    this.chartView.updateChart('chart-aa-l-wrist',
      this.chartVM.getAAChartData('jointAngles.leftWristDeviation', 'L-Wrist Deviation (°)', '#06b6d4'));
    this.chartView.updateChart('chart-aa-r-wrist',
      this.chartVM.getAAChartData('jointAngles.rightWristDeviation', 'R-Wrist Deviation (°)', '#f97316'));

    // Update ROM bars
    this._updateROMBars();
  }

  _updateDataTable() {
    const tbody = document.getElementById('live-data-tbody');
    if (!tbody) return;

    const samples = this.dataVM.session.getLastN(20).slice().reverse();
    tbody.innerHTML = samples.map(s => {
      const j = s.jointAngles || {};
      const time = s.timestamp ? (s.timestamp / 1000).toFixed(2) : (s.relativeTime ? (s.relativeTime / 1000).toFixed(2) : '—');
      return `
      <tr>
        <td>${s.frameIndex}</td>
        <td>${time}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_UPPER_ARM]}">${(j.leftShoulderFlexion || 0).toFixed(1)}°</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_FOREARM]}">${(j.leftElbowFlexion || 0).toFixed(1)}°</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_WRIST]}">${(j.leftWristFlexion || 0).toFixed(1)}°</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_UPPER_ARM]}">${(j.rightShoulderFlexion || 0).toFixed(1)}°</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_FOREARM]}">${(j.rightElbowFlexion || 0).toFixed(1)}°</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_WRIST]}">${(j.rightWristFlexion || 0).toFixed(1)}°</td>
      </tr>
    `;
    }).join('');
  }

  _updateROMBars() {
    const rom = this.dataVM.session.getROM();
    const items = [
      { label: 'L-Shoulder Flexion', value: rom.leftShoulderFlexion || 0, normal: 180 },
      { label: 'L-Elbow Flexion', value: rom.leftElbowFlexion || 0, normal: 150 },
      { label: 'R-Shoulder Flexion', value: rom.rightShoulderFlexion || 0, normal: 180 },
      { label: 'R-Elbow Flexion', value: rom.rightElbowFlexion || 0, normal: 150 },
    ];

    items.forEach(item => {
      const fill = document.querySelector(`[data-rom-key="${item.label}"]`);
      const valEl = document.querySelector(`[data-rom-value="${item.label}"]`);
      if (fill) {
        const pct = Math.min(100, (item.value / item.normal) * 100);
        fill.style.width = `${pct}%`;
      }
      if (valEl) {
        valEl.textContent = `${item.value}°`;
      }
    });

    // Calculate Mobility Score
    const score1 = Math.min(100, Math.round((items[0].value / items[0].normal) * 100)) || 0;
    const score2 = Math.min(100, Math.round((items[1].value / items[1].normal) * 100)) || 0;
    const score3 = Math.min(100, Math.round((items[2].value / items[2].normal) * 100)) || 0;
    const score4 = Math.min(100, Math.round((items[3].value / items[3].normal) * 100)) || 0;
    const avgScore = Math.round((score1 + score2 + score3 + score4) / 4) || 0;
    
    const scoreEl = document.getElementById('live-mobility-score');
    if (scoreEl) {
      scoreEl.textContent = `${avgScore}%`;
      if (avgScore > 80) scoreEl.style.color = 'var(--color-success)';
      else if (avgScore > 50) scoreEl.style.color = 'var(--color-warning)';
      else scoreEl.style.color = 'var(--color-danger)';
    }
  }

  // ═══════════════════════════════════════════
  //   UI HELPERS
  // ═══════════════════════════════════════════

  _updateStatCards() {
    if (this._currentPage !== Pages.DASHBOARD) return;
    const stats = this.chartVM.getCurrentStats();
    this._setTextContent('val-l-shoulder', stats.leftShoulderAngle.toFixed(1));
    this._setTextContent('val-l-elbow', stats.leftElbowAngle.toFixed(1));
    this._setTextContent('val-r-shoulder', stats.rightShoulderAngle.toFixed(1));
    this._setTextContent('val-r-elbow', stats.rightElbowAngle.toFixed(1));
    this._setTextContent('val-rate', stats.sampleRate.toFixed(0));
  }

  _updateStatusBar() {
    const stats = this.chartVM.getCurrentStats();
    const dataStats = this.dataVM.getStats();
    this._setTextContent('sample-rate-display', `${stats.sampleRate.toFixed(0)} Hz`);
    this._setTextContent('frame-count-display', `${dataStats.totalFrames} frames`);

    // Update debug monitor on dashboard
    if (this._currentPage === Pages.DASHBOARD) {
      const dataStats = this.dataVM.getStats();
      this._setTextContent('debug-raw-data', dataStats.lastRawLine);
      this._setTextContent('debug-parse-errors', dataStats.parseErrors);
      this._setTextContent('debug-data-format', dataStats.dataFormat);
    }
  }

  _updateConnectionUI(state) {
    const dot = this.$statusDot;
    const label = this.$statusLabel;

    if (dot) {
      dot.className = 'badge-dot';
      dot.classList.add(state === ConnectionState.CONNECTED ? 'connected' :
        state === ConnectionState.DEMO ? 'demo' :
          state === ConnectionState.CONNECTING ? 'connecting' : 'disconnected');
    }

    if (label) {
      const labels = {
        [ConnectionState.CONNECTED]: 'Connected',
        [ConnectionState.CONNECTING]: 'Connecting...',
        [ConnectionState.DEMO]: 'Demo Mode',
        [ConnectionState.ERROR]: 'Error',
        [ConnectionState.DISCONNECTED]: 'Disconnected',
      };
      label.textContent = labels[state] || 'Unknown';
    }

    // Update Connect + USB buttons
    if (this.$connectionBtn) {
      if (state === ConnectionState.CONNECTED) {
        this.$connectionBtn.textContent = '⏏ Disconnect';
        this.$connectionBtn.className = 'btn btn-danger btn-sm';
      } else {
        this.$connectionBtn.textContent = '📶 Bluetooth';
        this.$connectionBtn.className = 'btn btn-primary btn-sm';
      }
    }
    if (this.$usbBtn) {
      if (state === ConnectionState.CONNECTED) {
        this.$usbBtn.style.display = 'none';
      } else {
        this.$usbBtn.style.display = '';
        this.$usbBtn.textContent = '🔌 USB';
        this.$usbBtn.className = 'btn btn-secondary btn-sm';
      }
    }
  }

  _updateRecordButton() {
    if (this.$recordBtn) {
      if (this.dashboardVM.isRecording) {
        this.$recordBtn.innerHTML = '<span style="color: var(--color-error);">●</span> Stop';
        this.$recordBtn.className = 'btn btn-danger btn-sm';
      } else {
        this.$recordBtn.textContent = '⏺ Record';
        this.$recordBtn.className = 'btn btn-secondary btn-sm';
      }
    }
  }

  _updateActiveNav(page) {
    document.querySelectorAll('.sidebar-nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });
  }

  _showCalibrationOverlay() {
    // Remove existing overlay if any
    document.getElementById('calibration-overlay')?.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'calibration-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 9999; display: flex; align-items: center; justify-content: center;';
    overlay.innerHTML = `
      <div style="background: var(--bg-card); border-radius: 16px; padding: 40px; max-width: 500px; text-align: center; box-shadow: 0 25px 60px rgba(0,0,0,0.5);">
        <div style="font-size: 4rem; margin-bottom: 16px;">🧑‍⚕️</div>
        <h2 style="color: var(--text-primary); margin-bottom: 8px;">Hiệu chuẩn Cảm biến</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px; font-size: 1.1rem;">
          Yêu cầu bệnh nhân <strong>đứng nghiêm</strong>, <strong>duỗi thẳng 2 tay xuống</strong> dọc thân người.
        </p>
        <div style="margin-bottom: 20px;">
          <div style="background: var(--bg-tertiary); border-radius: 8px; height: 12px; overflow: hidden;">
            <div id="calib-progress-bar" style="background: linear-gradient(90deg, #3b82f6, #06b6d4); height: 100%; width: 0%; transition: width 0.1s; border-radius: 8px;"></div>
          </div>
          <p id="calib-progress-text" style="color: var(--text-muted); margin-top: 8px;">Đang chờ...</p>
        </div>
        <button class="btn btn-primary" id="btn-start-calib">🔧 Bắt đầu Hiệu chuẩn</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('btn-start-calib').addEventListener('click', () => {
      document.getElementById('btn-start-calib').disabled = true;
      document.getElementById('btn-start-calib').textContent = 'Đang hiệu chuẩn...';
      document.getElementById('calib-progress-text').textContent = 'Giữ yên 2 tay... 0%';
      this.dashboardVM.startCalibration();
    });
  }

  _updateCalibrationOverlay(progress) {
    const bar = document.getElementById('calib-progress-bar');
    const text = document.getElementById('calib-progress-text');
    if (bar) bar.style.width = `${progress}%`;
    if (text) text.textContent = `Giữ yên 2 tay... ${progress}%`;
  }

  _hideCalibrationOverlay() {
    const bar = document.getElementById('calib-progress-bar');
    const text = document.getElementById('calib-progress-text');
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = '✅ Hiệu chuẩn thành công!';
    
    setTimeout(() => {
      document.getElementById('calibration-overlay')?.remove();
    }, 1200);

    const state = this.dashboardVM.connectionVM.state;
    this._updateConnectionUI(state);
  }

  _setTextContent(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}
