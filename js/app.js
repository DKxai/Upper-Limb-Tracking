/**
 * App.js - Application Bootstrap
 * Wires up all MVVM components and initializes the dashboard.
 */

import { BluetoothService } from './services/BluetoothService.js';
import { ConnectionViewModel } from './viewmodels/ConnectionViewModel.js';
import { DataProcessingViewModel } from './viewmodels/DataProcessingVM.js';
import { ChartViewModel } from './viewmodels/ChartViewModel.js';
import { DashboardViewModel } from './viewmodels/DashboardViewModel.js';
import { DashboardView } from './views/DashboardView.js';
import { themeManager } from './utils/ThemeManager.js';
import { sessionStore } from './services/SessionStore.js';

class App {
  constructor() {
    // Services
    this.bluetoothService = new BluetoothService();

    // ViewModels
    this.connectionVM = new ConnectionViewModel(this.bluetoothService);
    this.dataProcessingVM = new DataProcessingViewModel();
    this.chartVM = new ChartViewModel(this.dataProcessingVM);
    this.dashboardVM = new DashboardViewModel(this.connectionVM, this.dataProcessingVM, this.chartVM);

    // View
    this.dashboardView = null;
  }

  /**
   * Initialize the application
   */
  init() {
    console.log('[App] Arm Motion Tracking Dashboard initializing...');

    // Apply theme (system default + remembered choice) before rendering
    themeManager.init();

    // Start capturing training sessions to local storage
    sessionStore.init();

    // Initialize MVVM chain
    this.dashboardVM.init();

    // Initialize View (after DOM is ready)
    this.dashboardView = new DashboardView(
      this.dashboardVM,
      this.chartVM,
      this.dataProcessingVM
    );
    this.dashboardView.init();

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.dashboardView.chartView.resizeAll();
      }, 250);
    });

    console.log('[App] Dashboard ready!');

    // Attempt to auto-connect to any previously permitted Bluetooth devices
    this.bluetoothService.autoConnect().then(connected => {
      if (connected) {
        console.log('[App] Auto-connected successfully!');
      }
    });

    // Show Web Serial API support status
    if (!this.bluetoothService.isSupported) {
      console.warn('[App] Web Serial API not supported. Use Chrome/Edge browser.');
    }
  }
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();

  // Expose for debugging
  window.__app = app;

  // --- Helper tool for Thesis Calibration Evaluation ---
  window.printCalibrationStats = async () => {
    const fusion = app.dashboardVM.dataVM.fusion;
    const session = app.dashboardVM.dataVM.session;
    const sample = session.getLatest();
    if (!sample) {
      console.log("⚠️ Chưa có dữ liệu. Hãy kết nối cảm biến trước.");
      return;
    }

    console.log("\n========================================================");
    console.log("   BẢNG 6.3: KẾT QUẢ HIỆU CHUẨN NHÀ MÁY (TĨNH)");
    console.log("========================================================");
    console.log("Lưu ý: Đặt cảm biến NẰM YÊN trên mặt bàn phẳng.\n");

    const { applyCalibration } = await import('./utils/CalibrationData.js');

    for (let i = 1; i <= 6; i++) {
      const segName = Object.keys(fusion._states).find(k => fusion._states[k].nodeId === i);
      if (!segName) continue;

      const raw = sample.raw[segName];
      if (!raw) continue;

      // 1. Gia tốc:
      const rawNorm_g = Math.sqrt(raw.ax * raw.ax + raw.ay * raw.ay + raw.az * raw.az);
      const rawNorm_ms2 = rawNorm_g * 9.80665;
      const errRaw = Math.abs(rawNorm_ms2 - 9.80665);

      const cal = applyCalibration(i, raw.ax, raw.ay, raw.az, raw.gx, raw.gy, raw.gz);
      const calNorm_ms2 = Math.sqrt(cal.ax * cal.ax + cal.ay * cal.ay + cal.az * cal.az);
      const errCal = Math.abs(calNorm_ms2 - 9.80665);

      // 2. Con quay:
      const rawGyroBias = Math.sqrt(raw.gx * raw.gx + raw.gy * raw.gy + raw.gz * raw.gz);
      const calGyroBias = Math.sqrt(cal.gx * cal.gx + cal.gy * cal.gy + cal.gz * cal.gz);

      console.log(`[Node ${i} - ${segName}]`);
      console.log(`  - Sai số ||a|| TRƯỚC : ${errRaw.toFixed(3)} m/s²  (Độ lớn thô: ${rawNorm_ms2.toFixed(3)})`);
      console.log(`  - Sai số ||a|| SAU   : ${errCal.toFixed(3)} m/s²  (Độ lớn calib: ${calNorm_ms2.toFixed(3)})`);
      console.log(`  - Độ lệch Gyro TRƯỚC : ${rawGyroBias.toFixed(3)} °/s`);
      console.log(`  - Độ lệch Gyro SAU   : ${calGyroBias.toFixed(3)} °/s\n`);
    }

    console.log("========================================================");
    console.log("   BẢNG 6.4: ĐỘ LỆCH CON QUAY (HIỆU CHUẨN THỜI GIAN THỰC)");
    console.log("========================================================");

    for (let i = 1; i <= 6; i++) {
      const segName = Object.keys(fusion._states).find(k => fusion._states[k].nodeId === i);
      if (!segName) continue;
      const state = fusion._states[segName];
      if (!state.isCalibrated) {
        console.log(`[Node ${i}] Chưa chạy hiệu chuẩn thời gian thực (nhấn nút Calibrate).`);
        continue;
      }
      console.log(`[Node ${i} - ${segName}]`);
      console.log(`  b_gx = ${state.gyroBias.x.toFixed(3)} °/s`);
      console.log(`  b_gy = ${state.gyroBias.y.toFixed(3)} °/s`);
      console.log(`  b_gz = ${state.gyroBias.z.toFixed(3)} °/s\n`);
    }
    console.log("========================================================\n");
  };
});
