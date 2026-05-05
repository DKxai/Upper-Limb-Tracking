/**
 * DashboardViewModel - Central ViewModel managing page state and coordination
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, Pages, ConnectionState } from '../utils/Constants.js';
import { ExportService } from '../services/ExportService.js';

export class DashboardViewModel {
  /**
   * @param {import('./ConnectionViewModel.js').ConnectionViewModel} connectionVM
   * @param {import('./DataProcessingVM.js').DataProcessingViewModel} dataVM
   * @param {import('./ChartViewModel.js').ChartViewModel} chartVM
   */
  constructor(connectionVM, dataVM, chartVM) {
    this.connectionVM = connectionVM;
    this.dataVM = dataVM;
    this.chartVM = chartVM;

    this._currentPage = Pages.DASHBOARD;
    this._isRecording = false;
  }

  /** @returns {string} Current page */
  get currentPage() {
    return this._currentPage;
  }

  /** @returns {boolean} */
  get isRecording() {
    return this._isRecording;
  }

  /**
   * Initialize
   */
  init() {
    this.connectionVM.init();
    this.dataVM.init();
    this.chartVM.init();
  }

  /**
   * Navigate to a page
   * @param {string} page - Pages enum value
   */
  navigateTo(page) {
    if (this._currentPage === page) return;
    this._currentPage = page;
    eventBus.emit(Events.TAB_CHANGED, page);
  }

  /**
   * Connect to device (BLE Bluetooth - default)
   */
  async connect() {
    await this.connectionVM.connect();
  }

  /**
   * Connect to device via USB cable
   */
  async connectUSB() {
    await this.connectionVM.connectUSB();
  }

  /**
   * Disconnect from device
   */
  async disconnect() {
    await this.connectionVM.disconnect();
  }

  /**
   * Start demo mode
   */
  startDemo() {
    this.dataVM.reset();
    this.connectionVM.startDemo();
  }

  /**
   * Stop demo mode
   */
  stopDemo() {
    this.connectionVM.stopDemo();
  }

  /**
   * Toggle recording
   */
  toggleRecording(patientName) {
    if (this._isRecording) {
      this._isRecording = false;
      this.dataVM.stopRecording();
    } else {
      this._isRecording = true;
      this.dataVM.startRecording(patientName);
    }
  }

  /**
   * Start calibration
   */
  startCalibration() {
    this.dataVM.startCalibration();
  }

  /**
   * Reset all data
   */
  resetData() {
    this.dataVM.reset();
  }

  /**
   * Export data as CSV
   */
  exportCSV() {
    ExportService.exportCSV(this.dataVM.session);
  }

  /**
   * Export data as JSON
   */
  exportJSON() {
    ExportService.exportJSON(this.dataVM.session);
  }

  /**
   * Get complete dashboard state for rendering
   * @returns {Object}
   */
  getState() {
    return {
      page: this._currentPage,
      connection: this.connectionVM.getDisplayInfo(),
      stats: this.chartVM.getCurrentStats(),
      processing: this.dataVM.getStats(),
      isRecording: this._isRecording,
    };
  }
}
