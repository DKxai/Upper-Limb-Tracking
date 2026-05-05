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
});
