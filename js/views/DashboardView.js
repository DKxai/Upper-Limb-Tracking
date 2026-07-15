/**
 * DashboardView - Main view rendering and DOM management
 * Handles page rendering, chart initialization, and UI updates.
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, Pages, PAGE_CONFIG, ArmSegment, SEGMENT_LABELS, SEGMENT_COLORS, SEGMENT_BY_INDEX, ConnectionState, NORMAL_ROM, NAV_SECTIONS } from '../utils/Constants.js';
import { themeManager } from '../utils/ThemeManager.js';
import { sessionStore } from '../services/SessionStore.js';
import { ChartView } from './ChartView.js';
import { ExportService } from '../services/ExportService.js';
import { HistoryView } from './HistoryView.js';
import { Arm3DView } from './Arm3DView.js';
import { Arm3DViewHumanoid } from './Arm3DViewHumanoid.js';
import { ExerciseGuidance } from './ExerciseGuidance.js';

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

    // 3D Tracking components
    this.arm3DView = null;
    this.exerciseGuidance = null;

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
    this.$demoBtn = document.getElementById('btn-demo');
    this.$menuToggle = document.getElementById('btn-menu-toggle');
    this.$sidebar = document.getElementById('sidebar');
    this.$backdrop = document.getElementById('sidebar-backdrop');
    this.$themeBtn = document.getElementById('btn-theme');
    this.$roleSwitch = document.getElementById('role-switch');
    this.$sidebarNav = document.getElementById('sidebar-nav');

    this._currentPage = null;
    this._updateRAF = null;
    // Role-based UI (Bệnh nhân / Bác sĩ), remembered across sessions
    this._role = localStorage.getItem('armtrack-role') || 'patient';
    // Stored session currently selected for clinical analysis (null = live)
    this._selectedSessionId = null;
  }

  /**
   * Initialize view - bind events and render initial page
   */
  init() {
    // Restore the live chart window preference (rolling vs whole-session)
    this.chartVM.setLiveFullSession(localStorage.getItem('armtrack-live-window') === 'session');
    this._renderSidebarNav();
    this._bindRoleSwitch();
    this._bindThemeToggle();
    this._bindHeaderActions();
    this._bindMobileNav();
    this._listenForEvents();
    this._updateThemeButton();
    this.renderPage(Pages.DASHBOARD);
  }

  /**
   * Build the sidebar navigation from NAV_SECTIONS, filtered by the current role.
   * @private
   */
  _renderSidebarNav() {
    if (!this.$sidebarNav) return;
    const sections = NAV_SECTIONS.filter(s => s.roles.includes(this._role));
    this.$sidebarNav.innerHTML = sections.map(sec => `
      <div class="sidebar-section-label">${sec.label}</div>
      ${sec.items.map(it => `
        <div class="sidebar-nav-item${it.page === this._currentPage ? ' active' : ''}" data-page="${it.page}">
          <span>${it.label}</span>
        </div>
      `).join('')}
    `).join('');

    this.$sidebarNav.querySelectorAll('.sidebar-nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        this.dashboardVM.navigateTo(item.dataset.page);
        this._closeMobileSidebar(); // collapse drawer after picking a page on mobile
      });
    });
  }

  /** Whether a page is reachable in the current role's navigation. @private */
  _pageInRole(page) {
    return NAV_SECTIONS
      .filter(s => s.roles.includes(this._role))
      .some(s => s.items.some(it => it.page === page));
  }

  /**
   * Bind the Bệnh nhân / Bác sĩ role switch.
   * @private
   */
  _bindRoleSwitch() {
    this.$roleSwitch?.querySelectorAll('.role-switch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.role === this._role);
      btn.addEventListener('click', () => {
        if (btn.dataset.role === this._role) return;
        this._role = btn.dataset.role;
        localStorage.setItem('armtrack-role', this._role);
        this.$roleSwitch.querySelectorAll('.role-switch-btn')
          .forEach(b => b.classList.toggle('active', b.dataset.role === this._role));
        this._renderSidebarNav();
        // If the active page isn't in this role, jump to the dashboard
        if (!this._pageInRole(this._currentPage)) {
          this.dashboardVM.navigateTo(Pages.DASHBOARD);
        }
      });
    });
  }

  /**
   * Bind the light/dark theme toggle.
   * @private
   */
  _bindThemeToggle() {
    this.$themeBtn?.addEventListener('click', () => themeManager.toggle());
  }

  /** Update the theme button label to reflect the action it performs. @private */
  _updateThemeButton() {
    if (this.$themeBtn) {
      this.$themeBtn.textContent = themeManager.theme === 'dark' ? 'Nền sáng' : 'Nền tối';
    }
  }

  /**
   * Bind mobile hamburger drawer (open/close sidebar over content)
   * @private
   */
  _bindMobileNav() {
    this.$menuToggle?.addEventListener('click', () => {
      const isOpen = this.$sidebar?.classList.toggle('open');
      this.$backdrop?.classList.toggle('active', isOpen);
    });
    this.$backdrop?.addEventListener('click', () => this._closeMobileSidebar());
  }

  /** @private */
  _closeMobileSidebar() {
    this.$sidebar?.classList.remove('open');
    this.$backdrop?.classList.remove('active');
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

    // Demo button - toggle simulated data (no hardware required)
    this.$demoBtn?.addEventListener('click', async () => {
      if (this.dashboardVM.connectionVM.isDemoMode) {
        this.dashboardVM.stopDemo();
      } else {
        // If a real device is connected, disconnect first
        if (this.dashboardVM.connectionVM.state === ConnectionState.CONNECTED) {
          await this.dashboardVM.disconnect();
        }
        this.dashboardVM.startDemo();
      }
    });

    // Record button - ask for patient name via modal
    this.$recordBtn?.addEventListener('click', () => {
      if (this.dashboardVM.isRecording) {
        // Stop recording
        this.dashboardVM.toggleRecording();
        this._updateRecordButton();
      } else {
        this._promptPatientName((name) => {
          this.dashboardVM.toggleRecording(name || 'Không rõ');
          this._updateRecordButton();
        });
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

      // Calibrate zero pose for humanoid 3D model
      if (this.arm3DView && typeof this.arm3DView.calibrateZero === 'function') {
        const lastSample = this.dataVM.session.getLatest();
        if (lastSample) {
          this.arm3DView.calibrateZero(lastSample);
          console.log('[DashboardView] Humanoid zero-pose calibrated');
        }
      }
    });

    // Theme change → re-render current page so charts pick up new colors
    eventBus.on(Events.THEME_CHANGED, () => {
      this._updateThemeButton();
      if (this._currentPage) this.renderPage(this._currentPage);
    });

    // A session was recorded/removed → refresh the Sessions page if it's open
    eventBus.on(Events.SESSIONS_CHANGED, () => {
      if (this._currentPage === 'sessions') this._renderSessions();
    });

    // When a recording stops, jump to the Sessions list so the user sees it
    eventBus.on(Events.RECORDING_STOPPED, () => {
      this._updateRecordButton();
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

    // Destroy 3D view if navigating away
    if (this.arm3DView) {
      this.arm3DView.destroy();
      this.arm3DView = null;
    }
    // Tear down the clinical replay (timer + its own 3D viewport)
    this._destroyClinicalReplay();
    if (this.exerciseGuidance) {
      this.exerciseGuidance.destroy();
      this.exerciseGuidance = null;
    }

    // Default to live data; the Clinical page may switch to a stored session.
    if (page !== Pages.CLINICAL) this.chartVM.clearAnalysisSession();

    const config = PAGE_CONFIG[page];
    if (this.$headerTitle) {
      this.$headerTitle.textContent = config?.label || 'Tổng quan';
    }

    switch (page) {
      case Pages.DASHBOARD:     this._renderDashboard(); break;
      case Pages.RAW_DATA:      this._renderRawData(); break;
      case Pages.ANGLE:         this._renderAngle(); break;
      case Pages.ROM:           this._renderROM(); break;
      case 'sessions':          this._renderSessions(); break;
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
      case Pages.TRACKING_3D:  this._render3DTracking(); break;
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
          <div class="stat-card-label">L-Shoulder</div>
          <div class="stat-card-value"><span id="val-l-shoulder">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-l-elbow">
          <div class="stat-card-label">L-Elbow</div>
          <div class="stat-card-value"><span id="val-l-elbow">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-r-shoulder">
          <div class="stat-card-label">R-Shoulder</div>
          <div class="stat-card-value"><span id="val-r-shoulder">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-r-elbow">
          <div class="stat-card-label">R-Elbow</div>
          <div class="stat-card-value"><span id="val-r-elbow">0.0</span><span class="stat-card-unit">°</span></div>
        </div>
        <div class="card stat-card" id="stat-rate">
          <div class="stat-card-label">Rate</div>
          <div class="stat-card-value"><span id="val-rate">0</span><span class="stat-card-unit">Hz</span></div>
        </div>
      </div>

      <!-- Joint Angles Charts (tách theo từng tay) -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Góc khớp theo thời gian</div>
            <div class="section-subtitle">Tách theo tay — vai (góc nâng), khuỷu (gập), cổ tay (xoay) — trùng với chuyển động trên model 3D</div>
          </div>
          ${this._renderViewModeToggle()}
        </div>
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:#3b82f6"></span>Tay trái</div></div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-dashboard-joints-left"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:#ef4444"></span>Tay phải</div></div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-dashboard-joints-right"></canvas></div></div>
          </div>
        </div>
      </div>

      <!-- ROM summary -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Phạm vi chuyển động (buổi hiện tại)</div>
            <div class="section-subtitle">Biên độ đạt được so với mức bình thường</div>
          </div>
        </div>
        <div class="card chart-card">
          <div class="card-body">
            <div class="chart-container medium">
              <canvas id="chart-dashboard-rom"></canvas>
            </div>
          </div>
        </div>
      </div>
    `;

    this._initChart('chart-dashboard-joints-left', 'line');
    this._initChart('chart-dashboard-joints-right', 'line');
    this._initChart('chart-dashboard-rom', 'bar');
    this._bindViewModeToggle();
  }

  /**
   * Render Raw Data page
   * @private
   */
  _renderRawData() {
    if (!this._rawSegment) this._rawSegment = ArmSegment.LEFT_UPPER_ARM;
    if (!this._rawType) this._rawType = 'accel';
    const type = this._rawType;
    const typeBtn = (val, label) =>
      `<button class="btn btn-sm ${type === val ? 'btn-primary' : 'btn-secondary'} raw-type-btn" data-type="${val}">${label}</button>`;
    const typeLabel = { accel: 'Gia tốc (g)', gyro: 'Con quay (°/s)', activity: 'Hoạt động |a| & |ω|' }[type];

    this.$content.innerHTML = `
      <!-- Section 1: all 6 nodes at a glance -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Dữ liệu vào 6 node — ${typeLabel}</div>
            <div class="section-subtitle">Theo dõi tín hiệu thô tất cả node cùng lúc. Số liệu = mẫu mới nhất.</div>
          </div>
          <div class="section-actions" style="align-items:center; gap:12px; flex-wrap:wrap;">
            <div style="display:flex; gap:6px;">${typeBtn('accel', 'Gia tốc')}${typeBtn('gyro', 'Con quay')}${typeBtn('activity', 'Hoạt động')}</div>
            ${this._renderViewModeToggle()}
          </div>
        </div>
        <div class="chart-grid chart-grid-3col">
          ${Object.values(ArmSegment).map(seg => `
            <div class="card chart-card">
              <div class="card-header">
                <div class="card-title"><span class="card-title-icon" style="background:${SEGMENT_COLORS[seg]}"></span>Node ${SEGMENT_BY_INDEX.indexOf(seg)} · ${SEGMENT_LABELS[seg]}</div>
                <span class="text-xs text-tertiary" id="node-readout-${seg}" style="font-family:'JetBrains Mono',monospace;">—</span>
              </div>
              <div class="card-body"><div class="chart-container small"><canvas id="chart-node-${seg}"></canvas></div></div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Section 2: deep dive on one node -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Chi tiết một node</div>
            <div class="section-subtitle">Accelerometer & Gyroscope theo trục X/Y/Z</div>
          </div>
          <div class="section-actions">${this._renderSegmentSelect('raw-segment-select', this._rawSegment)}</div>
        </div>
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header"><div class="card-title">Accelerometer (g)</div></div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-raw-accel"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header"><div class="card-title">Gyroscope (°/s)</div></div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-raw-gyro"></canvas></div></div>
          </div>
        </div>
      </div>
    `;

    // Node mini charts: dual axis only for the |a|/|ω| activity view
    const nodeOpts = type === 'activity'
      ? { plugins: { legend: { display: false } }, scales: { x: { ticks: { display: false } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { maxTicksLimit: 4 } } } }
      : { plugins: { legend: { display: false } }, scales: { x: { ticks: { display: false } } } };
    Object.values(ArmSegment).forEach(seg => this._initChart(`chart-node-${seg}`, 'line', nodeOpts));
    this._initChart('chart-raw-accel', 'line');
    this._initChart('chart-raw-gyro', 'line');

    this._bindViewModeToggle();
    this.$content.querySelectorAll('.raw-type-btn').forEach(b => {
      b.addEventListener('click', () => { this._rawType = b.dataset.type; this._renderRawData(); });
    });
    document.getElementById('raw-segment-select')?.addEventListener('change', (e) => {
      this._rawSegment = e.target.value;
      this._updateRawDataCharts();
    });
    this._updateRawDataCharts();
  }

  /**
   * Render Angle page (Orientation + Joints)
   * @private
   */
  _renderAngle() {
    if (!this._angleSegment) this._angleSegment = ArmSegment.LEFT_UPPER_ARM;
    this.$content.innerHTML = `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Góc khớp theo thời gian</div>
            <div class="section-subtitle">Góc khớp tính từ hướng các segment (4 khớp chính)</div>
          </div>
          ${this._renderViewModeToggle()}
        </div>
        <div class="card chart-card">
          <div class="card-body">
            <div class="chart-container xlarge">
              <canvas id="chart-joint-angles"></canvas>
            </div>
          </div>
        </div>
      </div>

      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Euler Angles (Roll / Pitch / Yaw)</div>
            <div class="section-subtitle">Hướng segment sau Complementary Filter — chọn segment</div>
          </div>
          <div class="section-actions">
            ${this._renderSegmentSelect('angle-segment-select', this._angleSegment)}
          </div>
        </div>
        <div class="card chart-card">
          <div class="card-body">
            <div class="chart-container large"><canvas id="chart-orientation"></canvas></div>
          </div>
        </div>
      </div>
    `;

    this._initChart('chart-joint-angles', 'line');
    this._initChart('chart-orientation', 'line');
    this._bindViewModeToggle();
    document.getElementById('angle-segment-select')?.addEventListener('change', (e) => {
      this._angleSegment = e.target.value;
      this._updateAngleCharts();
    });
    this._updateAngleCharts();
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
            <div class="section-title">Range of Motion Analysis</div>
            <div class="section-subtitle">Maximal joint angles achieved during this session</div>
          </div>
        </div>
      </div>

      <!-- ROM Progress Bars & Mobility Score -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">ROM vs Normal Range</div>
            <div class="section-subtitle">Biên độ đo được so với mức bình thường + điểm vận động chung</div>
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
            <div class="section-title">A/A - Adduction / Abduction</div>
            <div class="section-subtitle">Biểu đồ góc Adduction/Abduction theo thời gian cho từng khớp</div>
          </div>
        </div>
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #3b82f6;">L-Shoulder A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-l-shoulder"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #ef4444;">R-Shoulder A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-r-shoulder"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #06b6d4;">L-Wrist A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-l-wrist"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title" style="color: #f97316;">R-Wrist A/A</div>
            </div>
            <div class="card-body"><div class="chart-container"><canvas id="chart-aa-r-wrist"></canvas></div></div>
          </div>
        </div>
      </div>
    `;

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
            <div class="section-title">Live Data Table</div>
            <div class="section-subtitle">Góc khớp thời gian thực (SFTR). Duỗi thẳng = 0°; mỗi ô 2 chiều hiện <b>chiều+/chiều−</b>, cả hai luôn ≥ 0.</div>
          </div>
          <div class="section-actions">
            <button class="btn btn-secondary btn-sm" id="btn-copy-clipboard">Sao chép</button>
            <button class="btn btn-secondary btn-sm" id="btn-table-export-csv">CSV</button>
          </div>
        </div>
        <div class="card" style="overflow-x: auto;">
          <div class="card-body" style="padding: 0;">
            <table class="data-table" id="live-data-table">
              <thead>
                <tr>
                  <th>Frame</th>
                  <th>Time (s)</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_UPPER_ARM]}">L-Vai <small>Gập/Duỗi</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_UPPER_ARM]}">L-Nâng vai</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_FOREARM]}">L-Khuỷu <small>Gập</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_FOREARM]}">L-Cẳng <small>Ngửa/Sấp</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_WRIST]}">L-Cổ tay <small>Gập/Duỗi</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_UPPER_ARM]}">R-Vai <small>Gập/Duỗi</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_UPPER_ARM]}">R-Nâng vai</th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_FOREARM]}">R-Khuỷu <small>Gập</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_FOREARM]}">R-Cẳng <small>Ngửa/Sấp</small></th>
                  <th style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_WRIST]}">R-Cổ tay <small>Gập/Duỗi</small></th>
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
      btn.textContent = ok ? 'Đã sao chép!' : 'Lỗi';
      setTimeout(() => { btn.textContent = 'Sao chép'; }, 2000);
    });

    document.getElementById('btn-table-export-csv')?.addEventListener('click', () => {
      this.dashboardVM.exportCSV();
    });
  }

  /**
   * Render Sessions tracking page — list of recorded training sessions (local).
   * @private
   */
  _renderSessions() {
    const sessions = sessionStore.list();
    const mobility = (rom) => {
      const p = (v, n) => Math.min(100, Math.round(((v || 0) / n) * 100)) || 0;
      const scores = [
        p(rom.leftShoulderFlexion, 180), p(rom.leftShoulderElevation, 180),
        p(rom.leftElbowFlexion, 150), p(rom.leftForearmProSup, 85),
        p(rom.rightShoulderFlexion, 180), p(rom.rightShoulderElevation, 180),
        p(rom.rightElbowFlexion, 150), p(rom.rightForearmProSup, 85),
      ];
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    };

    const rows = sessions.map(s => `
      <tr>
        <td><strong>${this._escape(s.patientName)}</strong></td>
        <td>${new Date(s.startedAt).toLocaleString('vi-VN')}</td>
        <td>${s.durationSec}s</td>
        <td>${s.frameCount}</td>
        <td>${s.sampleRateHz} Hz</td>
        <td>${mobility(s.rom || {})}%</td>
        <td style="white-space: nowrap;">
          <button class="btn btn-primary btn-sm btn-analyze-session" data-id="${s.id}">Phân tích</button>
          <button class="btn btn-ghost btn-sm btn-del-session" data-id="${s.id}">Xóa</button>
        </td>
      </tr>
    `).join('');

    this.$content.innerHTML = `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Buổi tập đã ghi</div>
            <div class="section-subtitle">Mỗi buổi tập được lưu cục bộ trên máy. Bấm "Ghi buổi tập" ở thanh trên, cho bệnh nhân tập, rồi dừng để lưu.</div>
          </div>
          <div class="section-actions">
            <button class="btn btn-primary btn-sm" id="btn-sessions-record">Ghi buổi tập mới</button>
            ${sessions.length ? '<button class="btn btn-ghost btn-sm" id="btn-sessions-clear">Xóa tất cả</button>' : ''}
          </div>
        </div>

        ${sessions.length === 0 ? `
          <div class="card"><div class="empty-state">
            <div class="empty-state-title">Chưa có buổi tập nào</div>
            <div class="empty-state-desc">Kết nối thiết bị (hoặc bật Demo), bấm <strong>Ghi buổi tập</strong>, cho bệnh nhân thực hiện một buổi, rồi bấm <strong>Dừng ghi</strong>. Buổi tập sẽ xuất hiện ở đây và có thể đưa sang trang Phân tích lâm sàng.</div>
          </div></div>
        ` : `
          <div class="card" style="overflow-x: auto;">
            <div class="card-body" style="padding: 0;">
              <table class="data-table">
                <thead><tr>
                  <th>Bệnh nhân</th><th>Bắt đầu</th><th>Thời lượng</th>
                  <th>Số khung</th><th>Tần số</th><th>Vận động</th><th>Thao tác</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        `}
      </div>
    `;

    document.getElementById('btn-sessions-record')?.addEventListener('click', () => this.$recordBtn?.click());
    document.getElementById('btn-sessions-clear')?.addEventListener('click', () => {
      if (confirm('Xóa tất cả buổi tập đã lưu cục bộ?')) sessionStore.clear();
    });
    this.$content.querySelectorAll('.btn-analyze-session').forEach(btn => {
      btn.addEventListener('click', () => {
        this._selectedSessionId = btn.dataset.id;
        this.dashboardVM.navigateTo(Pages.CLINICAL);
      });
    });
    this.$content.querySelectorAll('.btn-del-session').forEach(btn => {
      btn.addEventListener('click', () => sessionStore.remove(btn.dataset.id));
    });
  }

  /** Escape user text for safe HTML insertion. @private */
  _escape(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Render Clinical Analysis page — analyzes ONE selected training session
   * (or live data) across its full length.
   * @private
   */
  _renderClinical() {
    // Resolve which session to analyze: selected → else newest stored → else live
    const sessions = sessionStore.list();
    let selId = this._selectedSessionId;
    if (selId && !sessionStore.get(selId)) selId = null;
    if (selId === null && sessions.length) selId = sessions[0].id;
    this._selectedSessionId = selId;

    const record = selId ? sessionStore.get(selId) : null;
    if (record) {
      this.chartVM.setAnalysisSession(sessionStore.buildSessionData(selId));
    } else {
      this.chartVM.clearAnalysisSession();
    }

    const sessionOptions = `
      <option value="live"${!record ? ' selected' : ''}>— Dữ liệu trực tiếp (realtime) —</option>
      ${sessions.map(s => `
        <option value="${s.id}"${s.id === selId ? ' selected' : ''}>
          ${this._escape(s.patientName)} · ${new Date(s.startedAt).toLocaleString('vi-VN')} · ${s.durationSec}s
        </option>`).join('')}
    `;
    const sourceNote = record
      ? `Đang phân tích buổi tập của <strong>${this._escape(record.patientName)}</strong> — ${record.durationSec}s, ${record.frameCount} khung.`
      : 'Đang phân tích dữ liệu trực tiếp. Ghi một buổi tập để phân tích trên trọn buổi.';

    // Default joint for analysis
    this._clinicalJoint = 'jointAngles.leftElbowFlexion';
    this._clinicalJointLabel = 'Khuỷu tay trái';
    this._clinicalNormalMax = 145;

    // All main joints — used by the whole-session summary (shown for stored sessions)
    const joints = this._clinicalJoints();
    const summaryHtml = record ? `
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Tổng hợp buổi tập</div>
            <div class="section-subtitle">Toàn bộ khớp trong trọn buổi — biên độ, số lần lặp, vận tốc đỉnh, độ mượt</div>
          </div>
        </div>
        <div class="card" style="overflow-x:auto;">
          <div class="card-body" style="padding:0;">
            <table class="data-table">
              <thead><tr>
                <th>Khớp</th><th>ROM (°)</th><th>Bình thường</th><th>Mobility</th>
                <th>Số rep</th><th>Đỉnh (°/s)</th><th>SPARC</th>
              </tr></thead>
              <tbody id="clin-summary-tbody">
                ${joints.map(j => `<tr data-sum="${j.key}">
                  <td><strong style="color:${j.color}">${j.label}</strong></td>
                  <td data-c="rom">—</td><td>${j.normal}°</td><td data-c="mob">—</td>
                  <td data-c="reps">—</td><td data-c="peak">—</td><td data-c="sparc">—</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="chart-grid chart-grid-3col" style="margin-top:16px;">
          ${joints.map(j => `
            <div class="card chart-card">
              <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:${j.color}"></span>${j.label}</div></div>
              <div class="card-body"><div class="chart-container small"><canvas id="chart-sum-${j.key}"></canvas></div></div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    // Replay scrubber + 3D viewport — only for a stored session (per-frame samples)
    const replayHtml = record ? `
      <div class="page-section" id="clin-replay-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background:#38bdf8;"></span> Tua lại &amp; định vị bất thường</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Kéo thanh để xem tư thế tay tại thời điểm đó; ◀▶ nhảy tới spike. Con trỏ đồng bộ trên các biểu đồ dưới.</div>
          </div>
          <div class="card-body">
            <div style="display:grid; grid-template-columns: minmax(0, 300px) 1fr; gap:16px; align-items:center;">
              <div id="clin-replay-3d" style="height:240px; background:#0f1419; border-radius:8px; overflow:hidden;"></div>
              <div>
                <div id="clin-cursor-info" style="font-family:'JetBrains Mono',monospace; font-size:0.85rem; line-height:1.6; margin-bottom:12px; min-height:3em;">—</div>
                <input type="range" id="clin-scrub" min="0" max="0" value="0" step="1" style="width:100%;">
                <div style="display:flex; gap:8px; margin-top:12px; align-items:center; flex-wrap:wrap;">
                  <button class="btn btn-secondary btn-sm" id="clin-prev-spike">◀ Spike</button>
                  <button class="btn btn-primary btn-sm" id="clin-play">▶ Phát</button>
                  <button class="btn btn-secondary btn-sm" id="clin-next-spike">Spike ▶</button>
                  <span id="clin-spike-count" style="font-size:0.8rem; color: var(--text-muted);"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ` : '';

    this.$content.innerHTML = `
      <!-- Session selector -->
      <div class="page-section">
        <div class="card"><div class="card-body" style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
          <div>
            <label class="text-sm text-secondary" for="clin-session-select" style="display:block; margin-bottom:4px;">Buổi tập phân tích</label>
            <div class="select-wrapper" style="min-width:280px;">
              <select class="select-input" id="clin-session-select">${sessionOptions}</select>
            </div>
          </div>
          <div class="text-sm text-secondary" style="flex:1; min-width:220px;">${sourceNote}</div>
        </div></div>
      </div>

      ${summaryHtml}

      <!-- Clinical metric panels (Group A — US clinical standards) -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Chỉ số lâm sàng — <span id="clin-rom-label">${this._clinicalJointLabel}</span></div>
            <div class="section-subtitle">Đo chủ động (AROM) trên trọn buổi. Sàng lọc/theo dõi — không thay thế chẩn đoán.</div>
          </div>
        </div>
        <div class="chart-grid" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
          <!-- 1. ROM & biên độ -->
          <div class="card">
            <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:#3b82f6"></span>ROM &amp; biên độ (AROM)</div></div>
            <div class="card-body"><div class="connection-info">
              <div class="connection-info-row"><span class="connection-info-label">ROM đạt được</span><span class="connection-info-value"><span id="clin-rom">0</span>°</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Neutral-Zero (SFTR)</span><span class="connection-info-value" id="clin-sftr">0–0–0</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Bình thường (AAOS)</span><span class="connection-info-value"><span id="clin-rom-normal">${this._clinicalNormalMax}</span>°</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Thiếu hụt ROM (đầu vào AMA Guides)</span><span class="connection-info-value" id="clin-deficit">0%</span></div>
            </div></div>
          </div>
          <!-- 2. Đối xứng 2 bên -->
          <div class="card">
            <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:#06b6d4"></span>Đối xứng 2 bên (LSI)</div></div>
            <div class="card-body"><div class="connection-info">
              <div class="connection-info-row"><span class="connection-info-label">ROM bên này</span><span class="connection-info-value"><span id="clin-side-rom">0</span>°</span></div>
              <div class="connection-info-row"><span class="connection-info-label">ROM đối bên</span><span class="connection-info-value"><span id="clin-contra-rom">0</span>°</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Chỉ số đối xứng (LSI)</span><span class="connection-info-value" id="clin-lsi">—</span></div>
              <div class="connection-info-row"><span class="connection-info-label" style="font-size:0.72rem;">Đạt khi ≥ 90%</span><span class="connection-info-value"></span></div>
            </div></div>
          </div>
          <!-- 3. Độ mượt vận động -->
          <div class="card">
            <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:#a855f7"></span>Độ mượt vận động</div></div>
            <div class="card-body"><div class="connection-info">
              <div class="connection-info-row"><span class="connection-info-label">SPARC (tốt &gt; −2.5)</span><span class="connection-info-value" id="clin-sparc">0</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Jerk không thứ nguyên (LDLJ)</span><span class="connection-info-value" id="clin-ldlj">0</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Submovement / rep</span><span class="connection-info-value" id="clin-submov">0</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Tremor trội</span><span class="connection-info-value" id="clin-tremor-hz">0 Hz</span></div>
            </div></div>
          </div>
          <!-- 4. Động học & liều tập -->
          <div class="card">
            <div class="card-header"><div class="card-title"><span class="card-title-icon" style="background:#f97316"></span>Động học &amp; liều tập</div></div>
            <div class="card-body"><div class="connection-info">
              <div class="connection-info-row"><span class="connection-info-label">Vận tốc đỉnh</span><span class="connection-info-value"><span id="clin-peak-vel">0</span> °/s</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Time-to-peak</span><span class="connection-info-value" id="clin-ttp">—</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Số rep · nhịp</span><span class="connection-info-value"><span id="clin-reps">0</span> · <span id="clin-cadence">0</span>/ph</span></div>
              <div class="connection-info-row"><span class="connection-info-label">Độ ổn định (CV ROM / vận tốc)</span><span class="connection-info-value" id="clin-cv">—</span></div>
            </div></div>
          </div>
        </div>
      </div>

      <!-- Joint selector tabs -->
      <div class="page-section">
        <div class="section-header">
          <div>
            <div class="section-title">Phân tích Lâm sàng</div>
            <div class="section-subtitle">Chọn khớp cần phân tích — kết quả tính trên trọn buổi tập đã chọn</div>
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

      ${replayHtml}

      <!-- Chart 1: Full-session joint angle, phase-segmented -->
      <div class="page-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background: #8b5cf6;"></span> 1 — Góc khớp <span id="clin-joint-name">khuỷu tay</span> toàn buổi</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Trọn buổi tập, đổi màu theo từng lần lặp (rep). Bình thường 0–<span id="clin-normal-range">145</span>°</div>
          </div>
          <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-overview"></canvas></div></div>
        </div>
      </div>

      <!-- Charts 2 & 3: Velocity/Acceleration + Phase Portrait (per-rep) -->
      <div class="page-section">
        <div class="chart-grid chart-grid-2col">
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: #06b6d4;"></span> 2 — Vận tốc & Gia tốc</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">Độ mượt và phát hiện bradykinesia</div>
            </div>
            <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-vel-acc"></canvas></div></div>
          </div>
          <div class="card chart-card">
            <div class="card-header">
              <div class="card-title"><span class="card-title-icon" style="background: #a855f7;"></span> 3 — Phase Portrait (chân dung pha)</div>
              <div style="font-size: 0.8rem; color: var(--text-muted);">Góc θ vs vận tốc ω của 1 chu kỳ đại diện, tách theo pha: <span style="color:#6366f1;">đồng tâm (gập)</span> ↑ và <span style="color:#f97316;">ly tâm (duỗi)</span> ↓. Vòng tròn mượt = vận động trơn tru. Chọn rep để xem từng chu kỳ.</div>
            </div>
            <div class="card-body">
              <div id="clin-rep-selector" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;"></div>
              <div class="chart-container large"><canvas id="chart-clin-phase"></canvas></div>
              <div id="clin-rep-caption" style="font-size:0.78rem; color: var(--text-muted); margin-top:8px; min-height:1.2em;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart 4: Jerk / Smoothness -->
      <div class="page-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background: #ef4444;"></span> 4 — Jerk (Smoothness) theo thời gian</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Đạo hàm bậc 3 của vị trí. Spike cao = chuyển động giật cục. <span style="color: #22c55e;">■</span> Bình thường <span style="color: #ef4444;">■</span> Bất thường</div>
          </div>
          <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-jerk"></canvas></div></div>
        </div>
      </div>

      <!-- Chart 5: FFT Spectrum -->
      <div class="page-section">
        <div class="card chart-card">
          <div class="card-header">
            <div class="card-title"><span class="card-title-icon" style="background: #eab308;"></span> 5 — Biểu đồ phổ FFT (Frequency Spectrum)</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Phân tích phổ tần số của chuỗi góc khớp. Trục X là tần số (Hz), trục Y là biên độ phổ.</div>
          </div>
          <div class="card-body"><div class="chart-container large"><canvas id="chart-clin-fft"></canvas></div></div>
        </div>
      </div>
    `;

    // Selected rep for the phase portrait (null = show all reps overlaid)
    this._clinicalRep = null;

    // Initialize charts
    this._initChart('chart-clin-overview', 'line');
    this._initChart('chart-clin-vel-acc', 'line');
    this._initChart('chart-clin-phase', 'scatter', {
      plugins: {
        legend: { display: true, position: 'top', align: 'start',
          labels: { usePointStyle: true, boxWidth: 8, padding: 10 } },
      },
      scales: {
        x: { title: { display: true, text: 'Góc khớp θ (°)' } },
        y: { title: { display: true, text: 'Vận tốc góc ω (°/s)' } },
      },
    });
    // Hide the dense per-frame x labels on the jerk bar chart (time is implicit)
    this._initChart('chart-clin-jerk', 'bar', { scales: { x: { ticks: { display: false } } } });

    // Initialize FFT chart
    this._initChart('chart-clin-fft', 'line', {
      scales: {
        x: { title: { display: true, text: 'Tần số (Hz)' } },
        y: { title: { display: true, text: 'Biên độ phổ' } },
      },
    });

    // Session selector → re-render clinical with the chosen session
    document.getElementById('clin-session-select')?.addEventListener('change', (e) => {
      this._selectedSessionId = e.target.value === 'live' ? null : e.target.value;
      this.renderPage(Pages.CLINICAL);
    });

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
        this._clinicalRep = null; // reset rep selection when switching joints
        this._updateClinicalCharts(); // refreshes labels + charts (stored session is static)
      });
    });

    // Whole-session summary (stored sessions only — static, populated once)
    if (record) {
      joints.forEach(j => this._initChart(`sum-${j.key}`, 'line', {
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { display: false } } },
      }));
      this._renderSessionSummary(joints);
    }

    // Populate immediately so a stored session shows without waiting for live frames
    this._updateClinicalCharts();

    // Replay scrubber + 3D viewport (stored sessions only)
    if (record) this._initClinicalReplay();
  }

  // ═══════════════════════════════════════════
  //   CLINICAL REPLAY (scrubber + 3D + synced cursor)
  // ═══════════════════════════════════════════

  /** Build replay data, spike markers and the 3D viewport for a stored session. @private */
  _initClinicalReplay() {
    this._replayPos = 0;
    this._replay = this.chartVM.getReplayData(this._clinicalJoint);
    this._replayJoint = this._clinicalJoint;
    const r = this._replay;

    const scrub = document.getElementById('clin-scrub');
    if (scrub) { scrub.max = Math.max(0, r.count - 1); scrub.value = 0; }
    this._applySpikeMarkers();
    this._setTextContent('clin-spike-count', `${r.spikes.length} spike bất thường`);

    scrub?.addEventListener('input', (e) => { this._stopReplayPlay(); this._replaySeek(parseInt(e.target.value)); });
    document.getElementById('clin-prev-spike')?.addEventListener('click', () => this._jumpSpike(-1));
    document.getElementById('clin-next-spike')?.addEventListener('click', () => this._jumpSpike(1));
    document.getElementById('clin-play')?.addEventListener('click', () => this._toggleReplayPlay());

    this._replaySeek(0);
    // Load the realistic humanoid model (assets/models/human.glb) async, with a
    // cylinder fallback; poses the current frame once it's ready.
    this._loadReplayModel();
  }

  /**
   * Load the 3D viewport for replay: humanoid GLB first (more realistic), falling
   * back to the lightweight cylinder model if it fails. Guards against the user
   * leaving Clinical while the GLB is still loading.
   * @private
   */
  async _loadReplayModel() {
    const host = document.getElementById('clin-replay-3d');
    let view = null;
    try {
      view = new Arm3DViewHumanoid('clin-replay-3d', { modelUrl: 'assets/models/human.glb' });
      await view.init();
    } catch (e) {
      console.warn('[Replay] Humanoid model failed, falling back to cylinder:', e);
      if (view) { try { view.destroy(); } catch (_) { /* ignore */ } }
      if (host) host.innerHTML = '';
      try {
        view = new Arm3DView('clin-replay-3d');
        view.init();
      } catch (e2) {
        view = null;
        if (host) host.innerHTML = '<div style="color:#94a3b8;padding:12px;font-size:0.8rem;">Không tải được mô hình 3D (vẫn tua được con trỏ trên biểu đồ).</div>';
      }
    }

    // User navigated away while the model was loading → discard it.
    if (this._currentPage !== Pages.CLINICAL || !this._replay) {
      if (view) { try { view.destroy(); } catch (_) { /* ignore */ } }
      return;
    }

    this.clinicalArm3D = view;
    if (view) {
      // Use the first frame as the neutral reference for the humanoid, then pose.
      const s0 = this.chartVM.getSampleAt(0);
      if (s0 && typeof view.calibrateZero === 'function') view.calibrateZero(s0);
      view.poseFromSample(this.chartVM.getSampleAt(this._replayPos));
    }
  }

  /** Recompute replay data + markers when the analyzed joint changes. @private */
  _refreshClinicalReplay() {
    if (!this._replay || this._replayJoint === this._clinicalJoint) return;
    this._stopReplayPlay();
    this._replay = this.chartVM.getReplayData(this._clinicalJoint);
    this._replayJoint = this._clinicalJoint;
    const scrub = document.getElementById('clin-scrub');
    if (scrub) scrub.max = Math.max(0, this._replay.count - 1);
    this._applySpikeMarkers();
    this._setTextContent('clin-spike-count', `${this._replay.spikes.length} spike bất thường`);
    this._replaySeek(Math.min(this._replayPos, this._replay.count - 1));
  }

  /** Push spike marker fractions onto the time-domain clinical charts. @private */
  _applySpikeMarkers() {
    const fracs = this._replay.spikes.map(s => s.frac);
    ['chart-clin-overview', 'chart-clin-vel-acc', 'chart-clin-jerk']
      .forEach(id => this.chartView.setSpikeMarkers(id, fracs));
  }

  /** Move the cursor to sample i: sync chart cursors, readout, and pose the 3D model. @private */
  _replaySeek(i) {
    const r = this._replay;
    if (!r || !r.count) return;
    i = Math.max(0, Math.min(r.count - 1, i));
    this._replayPos = i;
    const frac = r.count > 1 ? i / (r.count - 1) : 0;

    this.chartView.setTimeCursor('chart-clin-overview', frac);
    this.chartView.setTimeCursor('chart-clin-vel-acc', frac);
    this.chartView.setTimeCursor('chart-clin-jerk', frac);
    const ang = r.angle[i] ?? 0, vel = r.velocity[i] ?? 0;
    this.chartView.setPointCursor('chart-clin-phase', { x: ang, y: vel });

    const k = r.reps.findIndex(rp => i >= rp.start && i <= rp.end);
    const repTxt = k < 0 ? '—' : `rep ${k + 1}`;
    const jv = r.jerk[i] ?? 0;
    const abn = jv > r.threshold;
    const info = document.getElementById('clin-cursor-info');
    if (info) {
      info.innerHTML = `t = ${r.times[i] ?? 0}s · ${repTxt} · góc ${Math.round(ang)}° · v ${Math.round(vel)}°/s<br>`
        + `jerk ${Math.round(jv)} (ngưỡng ${r.threshold}) `
        + (abn ? '<span style="color:#ef4444;font-weight:700;">⚠ BẤT THƯỜNG</span>'
          : '<span style="color:#22c55e;">bình thường</span>');
    }

    const scrub = document.getElementById('clin-scrub');
    if (scrub && parseInt(scrub.value) !== i) scrub.value = i;

    this.clinicalArm3D?.poseFromSample(this.chartVM.getSampleAt(i));
  }

  /** Jump to the previous/next spike relative to the current position. @private */
  _jumpSpike(dir) {
    this._stopReplayPlay();
    const r = this._replay;
    if (!r || !r.spikes.length) return;
    const cur = this._replayPos;
    let target = dir > 0
      ? r.spikes.find(s => s.index > cur)
      : [...r.spikes].reverse().find(s => s.index < cur);
    if (!target) target = dir > 0 ? r.spikes[0] : r.spikes[r.spikes.length - 1];
    this._replaySeek(target.index);
  }

  /** @private */
  _toggleReplayPlay() {
    if (this._replayTimer) this._stopReplayPlay();
    else this._startReplayPlay();
  }

  /** @private */
  _startReplayPlay() {
    const r = this._replay;
    if (!r || !r.count) return;
    this._setReplayPlayLabel(true);
    this._replayTimer = setInterval(() => {
      const next = this._replayPos + 1;
      if (next >= r.count) { this._stopReplayPlay(); return; }
      this._replaySeek(next);
    }, 40); // ~25 fps
  }

  /** @private */
  _stopReplayPlay() {
    if (this._replayTimer) { clearInterval(this._replayTimer); this._replayTimer = null; }
    this._setReplayPlayLabel(false);
  }

  /** @private */
  _setReplayPlayLabel(playing) {
    const b = document.getElementById('clin-play');
    if (b) b.textContent = playing ? '⏸ Dừng' : '▶ Phát';
  }

  /** Tear down replay timer + 3D viewport (on leaving/re-rendering Clinical). @private */
  _destroyClinicalReplay() {
    if (this._replayTimer) { clearInterval(this._replayTimer); this._replayTimer = null; }
    if (this.clinicalArm3D) { try { this.clinicalArm3D.destroy(); } catch (e) { /* ignore */ } this.clinicalArm3D = null; }
    this._replay = null;
    this._replayJoint = null;
    this._replayPos = 0;
  }

  /**
   * Config of the main joints used by the clinical summary.
   * Chỉ các góc CƠ BẢN: bả vai (gập), khuỷu tay, cổ tay — bỏ Elevation & Pro/Sup.
   * @private
   */
  _clinicalJoints() {
    return [
      { key: 'leftShoulderFlexion', label: 'Vai trái', normal: 180, color: '#3b82f6' },
      { key: 'rightShoulderFlexion', label: 'Vai phải', normal: 180, color: '#ef4444' },
      { key: 'leftElbowFlexion', label: 'Khuỷu trái', normal: 150, color: '#06b6d4' },
      { key: 'rightElbowFlexion', label: 'Khuỷu phải', normal: 150, color: '#f97316' },
      { key: 'leftWristFlexion', label: 'Cổ tay trái', normal: 80, color: '#8b5cf6' },
      { key: 'rightWristFlexion', label: 'Cổ tay phải', normal: 80, color: '#eab308' },
    ];
  }

  /**
   * Fill the whole-session summary table + per-joint mini traces for the selected
   * stored session. Computed once (the session is static).
   * @private
   */
  _renderSessionSummary(joints) {
    joints.forEach(j => {
      const path = `jointAngles.${j.key}`;
      const stats = this.chartVM.getClinicalStats(path);
      const reps = this.chartVM.getRepMetrics(path).length;
      const mob = Math.min(100, Math.round((stats.rom / j.normal) * 100)) || 0;

      const row = this.$content.querySelector(`tr[data-sum="${j.key}"]`);
      if (row) {
        const set = (c, v) => { const el = row.querySelector(`[data-c="${c}"]`); if (el) el.textContent = v; };
        set('rom', stats.rom);
        set('mob', `${mob}%`);
        set('reps', reps || '—');
        set('peak', stats.peakVelocity);
        set('sparc', stats.sparc);
      }

      this.chartView.updateChart(`sum-${j.key}`,
        this.chartVM.getJointAngleOverviewData(path, j.label, j.normal));
    });
  }

  /**
   * Render 3D Tracking & Exercise Guidance page
   * @private
   */
  async _render3DTracking() {
    this.$content.innerHTML = `
      <div class="tracking-section">
        <h2>3D Human Arm Tracking</h2>
        <p class="section-description">
          Mô hình người thật real-time. Kéo chuột để xoay, scroll để zoom.
          <br><small>Yêu cầu model GLB có skeleton (Mixamo recommended). Nếu chưa có model, sẽ hiển thị fallback.</small>
        </p>
        <div id="arm3d-container" style="height:600px"></div>
      </div>

      <div class="tracking-section">
        <h2>Exercise Guidance</h2>
        <p class="section-description">
          Chọn bài tập phục hồi chức năng và làm theo hướng dẫn.
          Hệ thống sẽ theo dõi và đưa ra feedback real-time.
        </p>
        <div id="exercise-guidance-container"></div>
      </div>
    `;

    // Try to load Humanoid model first, fallback to simple cylinder model
    try {
      this.arm3DView = new Arm3DViewHumanoid('arm3d-container', {
        modelUrl: 'assets/models/human.glb',
        // Nếu model không phải Mixamo, cập nhật boneMap ở đây:
        // boneMap: {
        //   left_upper_arm: 'TênXươngVaiTrái',
        //   left_forearm: 'TênXươngKhuỷuTrái',
        //   ...
        // }
      });
      await this.arm3DView.init();
      console.log('[DashboardView]  Humanoid 3D model loaded');
    } catch (err) {
      console.warn('[DashboardView] Humanoid model failed, falling back to cylinder model:', err);
      // Cleanup failed humanoid view
      if (this.arm3DView) {
        this.arm3DView.destroy();
        this.arm3DView = null;
      }
      // Clear container and recreate
      const container = document.getElementById('arm3d-container');
      if (container) container.innerHTML = '';
      // Fallback to simple cylinder model
      this.arm3DView = new Arm3DView('arm3d-container');
      this.arm3DView.init();
      console.log('[DashboardView]  Using fallback cylinder arm model');
    }

    // Expose for debug (console: window.__arm3d.listBones())
    window.__arm3d = this.arm3DView;

    // Initialize Exercise Guidance
    this.exerciseGuidance = new ExerciseGuidance();
    this.exerciseGuidance.init('exercise-guidance-container');
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
            <div class="section-title">Configuration</div>
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
              <div class="card-title">Madgwick Filter</div>
            </div>
            <div class="card-body">
              <div class="connection-info">
                <div class="connection-info-row">
                  <span class="connection-info-label">Beta (filter gain)</span>
                  <span class="connection-info-value" id="fusion-beta-value">${stats.fusionBeta}</span>
                </div>
              </div>
              <input type="range" id="slider-fusion-beta" min="0.01" max="0.5" step="0.01" value="${stats.fusionBeta}" style="width: 100%;">
              <p class="text-xs text-tertiary" style="margin-top: var(--space-2);">Lower β = smoother (slow drift correction). Higher β = responsive (more accel noise).</p>

              <button class="btn btn-primary btn-sm" id="btn-settings-calibrate" style="margin-top: var(--space-4); width: 100%;">Bắt đầu hiệu chuẩn (giữ yên tay)
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
                  <span class="connection-info-value">${stats.isCalibrated ? 'Có' : 'Không'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Connection Debug (moved off the overview page) -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Gỡ lỗi kết nối</div>
            </div>
            <div class="card-body">
              <div style="background: #0f172a; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 12px; color: #38bdf8; overflow-x: auto; white-space: pre-wrap; min-height: 120px; border: 1px solid #1e293b;">
                <div style="color: #94a3b8; margin-bottom: 8px;">Dữ liệu thô nhận gần nhất:</div>
                <div id="debug-raw-data" style="word-break: break-all;">Đang chờ dữ liệu... Hãy kết nối thiết bị.</div>
                <div style="margin-top: 12px; color: #94a3b8; border-top: 1px dashed #334155; padding-top: 8px;">Parse Errors: <span id="debug-parse-errors" style="color: #ef4444;">0</span> | Format: <span id="debug-data-format" style="color: #10b981;">N/A</span>
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

    document.getElementById('slider-fusion-beta')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.dataVM.setFusionBeta(val);
      document.getElementById('fusion-beta-value').textContent = val;
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

  /**
   * Toggle between the rolling live window and the whole buffered session.
   * Returns markup for a section header; bind with `_bindViewModeToggle()`.
   * @private
   */
  _renderViewModeToggle() {
    const full = this.chartVM.liveFullSession;
    return `
      <div class="section-actions">
        <button class="btn btn-sm ${full ? 'btn-secondary' : 'btn-primary'} view-mode-btn" data-mode="rolling">Cửa sổ trực tiếp</button>
        <button class="btn btn-sm ${full ? 'btn-primary' : 'btn-secondary'} view-mode-btn" data-mode="session">Toàn buổi</button>
      </div>`;
  }

  /** @private */
  _bindViewModeToggle() {
    this.$content.querySelectorAll('.view-mode-btn').forEach(b => {
      b.addEventListener('click', () => {
        const full = b.dataset.mode === 'session';
        this.chartVM.setLiveFullSession(full);
        localStorage.setItem('armtrack-live-window', full ? 'session' : 'rolling');
        this.$content.querySelectorAll('.view-mode-btn').forEach(x => {
          const isFullBtn = x.dataset.mode === 'session';
          x.className = `btn btn-sm ${isFullBtn === full ? 'btn-primary' : 'btn-secondary'} view-mode-btn`;
        });
        this._updateCharts(); // redraw current page with the new window
      });
    });
  }

  /**
   * A <select> of the 6 arm segments, for pages that show one segment at a time.
   * @private
   */
  _renderSegmentSelect(id, selected) {
    const opts = Object.values(ArmSegment).map(seg =>
      `<option value="${seg}"${seg === selected ? ' selected' : ''}>${SEGMENT_LABELS[seg]}</option>`).join('');
    return `<div class="select-wrapper" style="min-width:220px;"><select class="select-input" id="${id}">${opts}</select></div>`;
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
      { label: 'L-Shoulder Elevation', value: rom.leftShoulderElevation || 0, normal: 180, color: '#6366f1' },
      { label: 'L-Elbow Flexion', value: rom.leftElbowFlexion || 0, normal: 150, color: '#06b6d4' },
      { label: 'L-Forearm Pro/Sup', value: rom.leftForearmProSup || 0, normal: 85, color: '#14b8a6' },
      { label: 'R-Shoulder Flexion', value: rom.rightShoulderFlexion || 0, normal: 180, color: '#ef4444' },
      { label: 'R-Shoulder Elevation', value: rom.rightShoulderElevation || 0, normal: 180, color: '#ec4899' },
      { label: 'R-Elbow Flexion', value: rom.rightElbowFlexion || 0, normal: 150, color: '#f97316' },
      { label: 'R-Forearm Pro/Sup', value: rom.rightForearmProSup || 0, normal: 85, color: '#f59e0b' },
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
      case Pages.CLINICAL:
        // Stored sessions are static — populated on render/interaction, so skip the
        // per-frame recompute (the metrics involve a DFT). Live data still updates.
        if (!this.chartVM.isAnalysisSession) this._updateClinicalCharts();
        break;
    }
  }

  _updateClinicalCharts() {
    const joint = this._clinicalJoint || 'jointAngles.leftElbowFlexion';
    const normalMax = this._clinicalNormalMax || 145;

    // Per-rep metrics drive the rep count card + the phase-portrait selector
    const repMetrics = this.chartVM.getRepMetrics(joint);
    const repCount = repMetrics.length;
    // Clamp any stale selection (e.g. after switching to a joint with fewer reps)
    if (this._clinicalRep != null && this._clinicalRep >= repCount) this._clinicalRep = null;

    // Keep every joint-dependent text label in sync with the selected joint
    this._setTextContent('clin-rom-label', this._clinicalJointLabel);
    this._setTextContent('clin-rom-normal', normalMax);
    this._setTextContent('clin-joint-name', this._clinicalJointLabel);
    this._setTextContent('clin-normal-range', normalMax);

    // Group A clinical metric panels (US standards)
    const m = this.chartVM.getClinicalMetrics(joint, normalMax);
    // 1. ROM & biên độ
    this._setTextContent('clin-rom', m.rom);
    this._setTextContent('clin-sftr', m.sftr);
    this._setTextContent('clin-deficit', `${m.deficit}%`);
    // 2. Đối xứng 2 bên
    this._setTextContent('clin-side-rom', m.sideRom);
    this._setTextContent('clin-contra-rom', m.contraRom);
    this._setTextContent('clin-lsi', m.lsi == null ? '—' : `${m.lsi}%`);
    // 3. Độ mượt vận động
    this._setTextContent('clin-sparc', m.sparc);
    this._setTextContent('clin-ldlj', m.ldlj);
    this._setTextContent('clin-submov', m.submov || '—');
    this._setTextContent('clin-tremor-hz', m.tremorHz ? `${m.tremorHz} Hz · ${m.tremorFrac}%` : '—');
    // 4. Động học & liều tập
    this._setTextContent('clin-peak-vel', m.peakVel);
    this._setTextContent('clin-ttp', m.ttp == null ? '—' : `${m.ttp}%`);
    this._setTextContent('clin-reps', m.repCount || '—');
    this._setTextContent('clin-cadence', m.cadence || 0);
    this._setTextContent('clin-cv', (m.cvRom == null && m.cvPeak == null)
      ? '—' : `${m.cvRom == null ? '—' : m.cvRom + '%'} / ${m.cvPeak == null ? '—' : m.cvPeak + '%'}`);

    // Chart 1: Full-session joint angle, recolored per rep + normal threshold
    this.chartView.updateChart('chart-clin-overview',
      this.chartVM.getJointAngleOverviewData(joint, this._clinicalJointLabel + ' (°)', normalMax));

    // Chart 2: Velocity & Acceleration
    this.chartView.updateChart('chart-clin-vel-acc', this.chartVM.getVelocityAccelerationData(joint));

    // Chart 3: Phase Portrait — one representative rep as a phase-segmented loop
    const phaseData = this.chartVM.getPhasePortraitData(joint, this._clinicalRep);
    this.chartView.updateChart('chart-clin-phase', phaseData);
    this._renderRepSelector(repMetrics, phaseData._repShown);

    // Chart 4: Jerk
    this.chartView.updateChart('chart-clin-jerk', this.chartVM.getJerkData(joint));

    // Chart 5: FFT Spectrum
    this.chartView.updateChart('chart-clin-fft', this.chartVM.getClinicalFFTData(joint));

    // Re-point the replay scrubber/markers if the analyzed joint changed
    if (this._replay) this._refreshClinicalReplay();
  }

  /**
   * Render the phase-portrait rep selector (Tất cả / Rep 1..N) and the phase
   * read-out for the rep currently drawn. No-op if the page isn't mounted.
   * @param {{rom:number,peakVel:number,sparc:number,concPeakVel:number,
   *          eccPeakVel:number,concDur:number,eccDur:number}[]} repMetrics
   * @param {number|null} repShown - index of the rep actually drawn (representative)
   * @private
   */
  _renderRepSelector(repMetrics, repShown = null) {
    const host = document.getElementById('clin-rep-selector');
    const caption = document.getElementById('clin-rep-caption');
    if (!host) return;

    if (!repMetrics.length) {
      host.innerHTML = '';
      if (caption) caption.textContent = 'Không tách được chu kỳ lặp (chuyển động quá ngắn hoặc biên độ nhỏ) — hiển thị toàn bộ quỹ đạo.';
      return;
    }

    const btn = (label, val, active) =>
      `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'} clin-rep-btn" data-rep="${val}">${label}</button>`;
    host.innerHTML =
      btn('Tất cả', '', this._clinicalRep == null) +
      repMetrics.map((_, i) => btn(`Rep ${i + 1}`, i, this._clinicalRep === i)).join('');

    host.querySelectorAll('.clin-rep-btn').forEach(b => {
      b.addEventListener('click', () => {
        this._clinicalRep = b.dataset.rep === '' ? null : parseInt(b.dataset.rep);
        this._updateClinicalCharts();
      });
    });

    if (!caption) return;

    // The drawn rep is the selected one, or the representative (median) rep.
    const shown = this._clinicalRep != null ? this._clinicalRep : repShown;
    const m = (shown != null && repMetrics[shown]) ? repMetrics[shown] : null;
    if (!m) { caption.textContent = ''; return; }

    // Phase asymmetry: eccentric (return) markedly faster than concentric, or a
    // lopsided phase-duration split, both flag poor eccentric control.
    const velRatio = m.concPeakVel > 0 ? m.eccPeakVel / m.concPeakVel : 0;
    const dur = m.concDur + m.eccDur;
    const concPct = dur > 0 ? Math.round((m.concDur / dur) * 100) : 0;
    // Consistency of ROM across reps (lower CV = tighter, more repeatable loops).
    const roms = repMetrics.map(x => x.rom);
    const mean = roms.reduce((s, v) => s + v, 0) / roms.length;
    const cv = mean > 0
      ? Math.round(Math.sqrt(roms.reduce((s, v) => s + (v - mean) ** 2, 0) / roms.length) / mean * 100)
      : 0;

    const tag = this._clinicalRep != null ? `Rep ${shown + 1}` : `Rep đại diện (Rep ${shown + 1}/${repMetrics.length})`;
    caption.innerHTML =
      `<b>${tag}</b> — ROM ${m.rom}° · SPARC ${m.sparc} (độ mượt) · đồng đều ROM: CV ${cv}%<br>` +
      `<span style="color:#6366f1;">●</span> Đồng tâm (gập): đỉnh ${m.concPeakVel}°/s, ${m.concDur}s · ` +
      `<span style="color:#f97316;">●</span> Ly tâm (duỗi): đỉnh ${m.eccPeakVel}°/s, ${m.eccDur}s · ` +
      `tỉ lệ thời gian ${concPct}/${100 - concPct} · tỉ lệ vận tốc duỗi/gập ${velRatio.toFixed(2)}`;
  }

  _updateDashboardCharts() {
    this.chartView.updateChart('chart-dashboard-joints-left', this.chartVM.getArmJointAnglesData('left'));
    this.chartView.updateChart('chart-dashboard-joints-right', this.chartVM.getArmJointAnglesData('right'));
    this.chartView.updateChart('chart-dashboard-rom', this.chartVM.getROMData());
  }

  _updateRawDataCharts() {
    const type = this._rawType || 'accel';
    const latest = this.dataVM.session.getLatest();

    // 6-node overview grid + live numeric readout
    Object.values(ArmSegment).forEach(seg => {
      const data = type === 'gyro' ? this.chartVM.getGyroData(seg)
        : type === 'activity' ? this.chartVM.getNodeActivityData(seg)
          : this.chartVM.getAccelData(seg);
      this.chartView.updateChart(`chart-node-${seg}`, data);

      const el = document.getElementById(`node-readout-${seg}`);
      if (el) {
        const r = latest && latest.raw ? latest.raw[seg] : null;
        if (!r) { el.textContent = '—'; }
        else if (type === 'gyro') { el.textContent = `${(r.gx ?? 0).toFixed(0)}, ${(r.gy ?? 0).toFixed(0)}, ${(r.gz ?? 0).toFixed(0)}`; }
        else if (type === 'activity') {
          el.textContent = `|a| ${Math.hypot(r.ax || 0, r.ay || 0, r.az || 0).toFixed(2)}g · |ω| ${Math.hypot(r.gx || 0, r.gy || 0, r.gz || 0).toFixed(0)}`;
        } else { el.textContent = `${(r.ax ?? 0).toFixed(2)}, ${(r.ay ?? 0).toFixed(2)}, ${(r.az ?? 0).toFixed(2)}`; }
      }
    });

    // Single-node detail (always accel + gyro)
    const seg = this._rawSegment || ArmSegment.LEFT_UPPER_ARM;
    this.chartView.updateChart('chart-raw-accel', this.chartVM.getAccelData(seg));
    this.chartView.updateChart('chart-raw-gyro', this.chartVM.getGyroData(seg));
  }

  _updateAngleCharts() {
    this.chartView.updateChart('chart-joint-angles', this.chartVM.getJointAnglesData());
    const seg = this._angleSegment || ArmSegment.LEFT_UPPER_ARM;
    this.chartView.updateChart('chart-orientation', this.chartVM.getOrientationData(seg));
  }

  _updateROMCharts() {
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
    // SFTR: tách 1 góc có dấu thành 2 số ≥ 0 (chiều dương / chiều âm), mốc duỗi thẳng = 0°.
    // Số nào ≈ 0 nghĩa là đang không chuyển động theo chiều đó.
    const pair = (v) => {
      const x = v || 0;
      const pos = Math.max(0, x).toFixed(0);
      const neg = Math.max(0, -x).toFixed(0);
      return `<span title="chiều dương">${pos}</span>/<span title="chiều âm" style="opacity:.6">${neg}</span>°`;
    };
    const one = (v) => `${Math.max(0, v || 0).toFixed(1)}°`;
    tbody.innerHTML = samples.map(s => {
      const j = s.jointAngles || {};
      const time = s.timestamp ? (s.timestamp / 1000).toFixed(2) : (s.relativeTime ? (s.relativeTime / 1000).toFixed(2) : '—');
      return `
      <tr>
        <td>${s.frameIndex}</td>
        <td>${time}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_UPPER_ARM]}">${pair(j.leftShoulderFlexion)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_UPPER_ARM]}">${one(j.leftShoulderElevation)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_FOREARM]}">${one(j.leftElbowFlexion)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_FOREARM]}">${pair(j.leftForearmProSup)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.LEFT_WRIST]}">${pair(j.leftWristFlexion)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_UPPER_ARM]}">${pair(j.rightShoulderFlexion)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_UPPER_ARM]}">${one(j.rightShoulderElevation)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_FOREARM]}">${one(j.rightElbowFlexion)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_FOREARM]}">${pair(j.rightForearmProSup)}</td>
        <td style="color: ${SEGMENT_COLORS[ArmSegment.RIGHT_WRIST]}">${pair(j.rightWristFlexion)}</td>
      </tr>
    `;
    }).join('');
  }

  _updateROMBars() {
    const rom = this.dataVM.session.getROM();
    const items = [
      { label: 'L-Shoulder Flexion', value: rom.leftShoulderFlexion || 0, normal: 180 },
      { label: 'L-Shoulder Elevation', value: rom.leftShoulderElevation || 0, normal: 180 },
      { label: 'L-Elbow Flexion', value: rom.leftElbowFlexion || 0, normal: 150 },
      { label: 'L-Forearm Pro/Sup', value: rom.leftForearmProSup || 0, normal: 85 },
      { label: 'R-Shoulder Flexion', value: rom.rightShoulderFlexion || 0, normal: 180 },
      { label: 'R-Shoulder Elevation', value: rom.rightShoulderElevation || 0, normal: 180 },
      { label: 'R-Elbow Flexion', value: rom.rightElbowFlexion || 0, normal: 150 },
      { label: 'R-Forearm Pro/Sup', value: rom.rightForearmProSup || 0, normal: 85 },
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

    // Calculate Mobility Score (dynamic: works with any number of items)
    const scores = items.map(it => Math.min(100, Math.round((it.value / it.normal) * 100)) || 0);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    
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

    // Update the connection debug monitor wherever it's mounted (now on Settings)
    if (document.getElementById('debug-raw-data')) {
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
        [ConnectionState.CONNECTED]: 'Đã kết nối',
        [ConnectionState.CONNECTING]: 'Đang kết nối…',
        [ConnectionState.DEMO]: 'Chế độ Demo',
        [ConnectionState.ERROR]: 'Lỗi',
        [ConnectionState.DISCONNECTED]: 'Chưa kết nối',
      };
      label.textContent = labels[state] || 'Không rõ';
    }

    const isDemo = state === ConnectionState.DEMO;
    const isConnected = state === ConnectionState.CONNECTED;

    // Update Connect button
    if (this.$connectionBtn) {
      if (isConnected) {
        this.$connectionBtn.textContent = 'Ngắt kết nối';
        this.$connectionBtn.className = 'btn btn-danger btn-sm';
      } else {
        this.$connectionBtn.textContent = 'Bluetooth';
        this.$connectionBtn.className = 'btn btn-primary btn-sm';
      }
      this.$connectionBtn.disabled = isDemo; // can't BLE-connect while demoing
    }
    // USB button — hidden while connected or in demo
    if (this.$usbBtn) {
      this.$usbBtn.style.display = (isConnected || isDemo) ? 'none' : '';
    }
    // Demo button toggles label/style
    if (this.$demoBtn) {
      if (isDemo) {
        this.$demoBtn.textContent = 'Dừng Demo';
        this.$demoBtn.className = 'btn btn-danger btn-sm';
      } else {
        this.$demoBtn.textContent = 'Demo';
        this.$demoBtn.className = 'btn btn-secondary btn-sm';
      }
      this.$demoBtn.style.display = isConnected ? 'none' : '';
    }
  }

  _updateRecordButton() {
    if (this.$recordBtn) {
      if (this.dashboardVM.isRecording) {
        this.$recordBtn.textContent = 'Dừng ghi';
        this.$recordBtn.className = 'btn btn-danger btn-sm';
      } else {
        this.$recordBtn.textContent = 'Ghi buổi tập';
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
    
    // Tư thế hiệu chuẩn do người dùng chọn (mặc định: đứng nghiêm tay duỗi).
    // Tư thế giữ lúc hiệu chuẩn chính là mốc 0° của mọi góc khớp.
    const POSES = {
      arms_down: {
        label: 'Đứng nghiêm — tay duỗi xuống',
        tip: 'Đứng thẳng, <strong>duỗi thẳng 2 tay xuống dọc thân người</strong>, lòng bàn tay áp đùi. <em>Khuyến nghị</em>: khớp với mô hình 3D và chuẩn lâm sàng (góc = 0° ở tư thế này).',
      },
      t_pose: {
        label: 'Dang ngang — chữ T',
        tip: '<strong>Dang ngang 2 tay</strong> tạo hình chữ T, song song mặt đất. Lưu ý: mô hình 3D vẫn coi tư thế tay-duỗi là mốc 0°, nên chọn cách này avatar có thể lệch.',
      },
    };
    this._calibPose = localStorage.getItem('armtrack-calib-pose') || 'arms_down';
    const opt = (key) => `
      <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--border-color,#334155);border-radius:8px;cursor:pointer;flex:1;justify-content:center;">
        <input type="radio" name="calib-pose" value="${key}" ${this._calibPose === key ? 'checked' : ''}/> ${POSES[key].label}
      </label>`;

    const overlay = document.createElement('div');
    overlay.id = 'calibration-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 9999; display: flex; align-items: center; justify-content: center;';
    overlay.innerHTML = `
      <div style="background: var(--bg-card); border-radius: 16px; padding: 40px; max-width: 520px; text-align: center; box-shadow: 0 25px 60px rgba(0,0,0,0.5);">
        <h2 style="color: var(--text-primary); margin-bottom: 8px;">Hiệu chuẩn Cảm biến</h2>
        <p style="color: var(--text-muted); margin-bottom: 12px; font-size:0.85rem;">Chọn tư thế chuẩn (giữ yên trong lúc hiệu chuẩn — đây là mốc 0°):</p>
        <div style="display:flex; gap:10px; margin-bottom:14px;">${opt('arms_down')}${opt('t_pose')}</div>
        <p id="calib-pose-tip" style="color: var(--text-secondary); margin-bottom: 24px; font-size: 1.05rem; min-height:3em;">${POSES[this._calibPose].tip}</p>
        <div style="margin-bottom: 20px;">
          <div style="background: var(--bg-tertiary); border-radius: 8px; height: 12px; overflow: hidden;">
            <div id="calib-progress-bar" style="background: linear-gradient(90deg, #3b82f6, #06b6d4); height: 100%; width: 0%; transition: width 0.1s; border-radius: 8px;"></div>
          </div>
          <p id="calib-progress-text" style="color: var(--text-muted); margin-top: 8px;">Đang chờ...</p>
        </div>
        <button class="btn btn-primary" id="btn-start-calib">Bắt đầu hiệu chuẩn</button>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('input[name="calib-pose"]').forEach(r => {
      r.addEventListener('change', (e) => {
        this._calibPose = e.target.value;
        localStorage.setItem('armtrack-calib-pose', this._calibPose);
        const tip = document.getElementById('calib-pose-tip');
        if (tip) tip.innerHTML = POSES[this._calibPose].tip;
      });
    });

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
    if (text) text.textContent = 'Hiệu chuẩn thành công!';
    
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

  /**
   * Show a modal asking for the patient name (replaces native prompt()).
   * @param {(name: string|null) => void} onConfirm - called with trimmed name, or never if cancelled
   * @private
   */
  _promptPatientName(onConfirm) {
    document.getElementById('patient-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'patient-modal';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="patient-modal-title">
        <div class="modal-header">
          <div class="modal-title" id="patient-modal-title">Ghi buổi tập</div>
          <button class="modal-close" id="patient-modal-close" aria-label="Đóng">×</button>
        </div>
        <div class="modal-body">
          <label class="text-sm text-secondary" for="patient-name-input" style="display:block; margin-bottom: var(--space-2);">Tên bệnh nhân hoặc mã hồ sơ
          </label>
          <input class="input-field" id="patient-name-input" type="text" placeholder="VD: Nguyễn Văn A — BN001" autocomplete="off">
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="patient-modal-cancel">Hủy</button>
          <button class="btn btn-primary" id="patient-modal-ok">⏺ Bắt đầu ghi</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));

    const input = document.getElementById('patient-name-input');
    input?.focus();

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 250);
    };
    const confirm = () => {
      const name = (input?.value || '').trim();
      close();
      onConfirm(name);
    };

    document.getElementById('patient-modal-ok')?.addEventListener('click', confirm);
    document.getElementById('patient-modal-cancel')?.addEventListener('click', close);
    document.getElementById('patient-modal-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirm();
      if (e.key === 'Escape') close();
    });
  }
}
