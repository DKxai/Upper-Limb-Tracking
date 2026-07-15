import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import pearsonr

# Cấu hình font và kích thước chuẩn cho đồ án (LaTeX)
plt.rcParams.update({
    'font.size': 12, 'axes.labelsize': 13, 'axes.titlesize': 14,
    'xtick.labelsize': 11, 'ytick.labelsize': 11, 'legend.fontsize': 11,
    'figure.dpi': 300, 'figure.autolayout': True, 'font.family': 'serif'
})
sns.set_style("whitegrid")

# =====================================================================
# ĐỒ THỊ 1: SO SÁNH SAI SỐ GIA TỐC TRƯỚC/SAU HIỆU CHUẨN (FACTORY CALIB)
# =====================================================================
def plot_calibration_before_after():
    # TODO: Thay các con số này bằng dữ liệu thực tế từ 6 file report của bạn
    nodes = ['Node 1', 'Node 2', 'Node 3', 'Node 4', 'Node 5', 'Node 6']
    error_before = [0.021, 0.035, 0.018, 0.040, 0.022, 0.028]  # Đơn vị: g
    error_after  = [0.001, 0.002, 0.001, 0.003, 0.001, 0.002]  # Đơn vị: g

    x = np.arange(len(nodes))
    width = 0.35

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.bar(x - width/2, error_before, width, label='Trước hiệu chuẩn', color='#e74c3c', edgecolor='black')
    ax.bar(x + width/2, error_after, width, label='Sau hiệu chuẩn', color='#2ecc71', edgecolor='black')

    ax.set_ylabel(r'Sai số chuẩn gia tốc $||a|| - g$ (g)')
    ax.set_title('Hiệu quả hiệu chuẩn gia tốc kế trên 6 nút cảm biến')
    ax.set_xticks(x)
    ax.set_xticklabels(nodes)
    ax.legend()
    
    # Kẻ đường mục tiêu 0.01g (~0.1 m/s^2)
    ax.axhline(0.01, color='gray', linestyle='--', linewidth=1.5, label='Mục tiêu (< 0.01g)')
    ax.legend()

    plt.savefig('calib_before_after.png')
    print(" Đã tạo: calib_before_after.png")
    plt.close()

# =====================================================================
# ĐỒ THỊ 2 & 3: TIME-SERIES VÀ BLAND-ALTMAN CHO GÓC KHỚP
# =====================================================================
def plot_angle_errors():
    # TẠO DỮ LIỆU MÔ PHỎNG (SINE WAVE) - Thay bằng pd.read_csv('data_cua_ban.csv')
    t = np.linspace(0, 10, 500)
    ref = 90 + 45 * np.sin(2 * np.pi * 0.5 * t)
    # Estimate bị trễ một chút và có nhiễu, có bias nhẹ
    est = 90 + 43 * np.sin(2 * np.pi * 0.5 * (t - 0.05)) + np.random.normal(0, 1.5, 500) + 2.0
    
    error = est - ref
    mean_error = np.mean(error)
    std_error = np.std(error)
    loa_upper, loa_lower = mean_error + 1.96*std_error, mean_error - 1.96*std_error

    # Tính các thông số in ra báo cáo
    rmse = np.sqrt(np.mean(error**2))
    mae = np.mean(np.abs(error))
    r_pearson, _ = pearsonr(est, ref)
    print(f"\n--- KẾT QUẢ THỐNG KÊ (Cho phần góc khớp) ---")
    print(f"RMSE: {rmse:.2f} deg | MAE: {mae:.2f} deg | Pearson (r): {r_pearson:.4f}")

    # --- Đồ thị Time-series ---
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), gridspec_kw={'height_ratios': [2, 1]}, sharex=True)
    ax1.plot(t, ref, 'k--', linewidth=2, label='Tham chiếu (Goniometer)')
    ax1.plot(t, est, 'b-', linewidth=1.5, alpha=0.8, label='Hệ thống đo (IMU)')
    ax1.set_ylabel(r'Góc $\theta$ (độ)')
    ax1.set_title('So sánh góc khớp theo thời gian')
    ax1.legend()

    ax2.plot(t, error, 'r-', linewidth=1.2)
    ax2.axhline(0, color='k', linestyle='--', linewidth=1)
    ax2.fill_between(t, 0, error, where=(error > 0), color='red', alpha=0.3)
    ax2.fill_between(t, 0, error, where=(error < 0), color='blue', alpha=0.3)
    ax2.set_ylabel('Sai số (độ)')
    ax2.set_xlabel('Thời gian (s)')
    plt.savefig('timeseries_error.png')
    print(" Đã tạo: timeseries_error.png")
    plt.close()

    # --- Đồ thị Bland-Altman ---
    plt.figure(figsize=(8, 6))
    means = (est + ref) / 2
    plt.scatter(means, error, alpha=0.6, edgecolors='w', s=50, color='#3498db')
    
    plt.axhline(mean_error, color='#e74c3c', linestyle='-', linewidth=2, label=f'Bias (Trung bình): {mean_error:.2f}°')
    plt.axhline(loa_upper, color='#7f8c8d', linestyle='--', linewidth=2, label=f'+1.96 SD: {loa_upper:.2f}°')
    plt.axhline(loa_lower, color='#7f8c8d', linestyle='--', linewidth=2, label=f'-1.96 SD: {loa_lower:.2f}°')

    plt.xlabel('Giá trị trung bình của hệ thống và tham chiếu (độ)')
    plt.ylabel('Sai số (Hệ thống - Tham chiếu) (độ)')
    plt.title('Phân tích Bland-Altman (Giới hạn tương hợp)')
    plt.legend()
    plt.savefig('bland_altman.png')
    print(" Đã tạo: bland_altman.png")
    plt.close()

if __name__ == "__main__":
    plot_calibration_before_after()
    plot_angle_errors()
