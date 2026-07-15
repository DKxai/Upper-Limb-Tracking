import os
import glob
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import pearsonr
import sys

# Fix lỗi in tiếng Việt trên Terminal Windows (cp1252)
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

# Cấu hình form đồ thị báo cáo luận văn
plt.rcParams.update({
    'font.size': 12, 'axes.labelsize': 13, 'axes.titlesize': 14,
    'xtick.labelsize': 11, 'ytick.labelsize': 11, 'legend.fontsize': 11,
    'figure.dpi': 300, 'figure.autolayout': True, 'font.family': 'serif'
})
sns.set_style("whitegrid")

# =====================================================================
# TỰ ĐỘNG ĐỌC FILE EXCEL ĐỂ VẼ SO SÁNH SAI SỐ GIA TỐC
# =====================================================================
def plot_factory_calibration_from_excel(folder_path="."):
    files = glob.glob(os.path.join(folder_path, "accel_*_report*.xlsx"))
    if not files: return
    
    nodes, error_before, error_after = [], [], []

    for f in sorted(files):
        try:
            filename = os.path.basename(f)
            node_name = filename.split('_')[1].replace('calib', 'Node ') 
            if node_name == "report1": node_name = "Node 1"
            
            df = pd.read_excel(f, sheet_name=0, header=None)
            rms_row = df[df[0].astype(str).str.contains("RMS sai", na=False)]
            if len(rms_row) > 0:
                nodes.append(node_name)
                error_before.append(float(rms_row.iloc[0, 1]))
                error_after.append(float(rms_row.iloc[0, 2]))
        except:
            pass

    if not nodes: return

    x = np.arange(len(nodes))
    width = 0.35

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.bar(x - width/2, error_before, width, label='Trước hiệu chuẩn', color='#e74c3c', edgecolor='black')
    ax.bar(x + width/2, error_after, width, label='Sau hiệu chuẩn', color='#2ecc71', edgecolor='black')

    ax.set_ylabel(r'RMS Sai số chuẩn gia tốc (g)')
    ax.set_title('Hiệu quả bù trừ sai số gia tốc tĩnh trên hệ thống')
    ax.set_xticks(x)
    ax.set_xticklabels(nodes)
    ax.axhline(0.01, color='gray', linestyle='--', linewidth=1.5, label='Mục tiêu (< 0.01g)')
    ax.legend()

    plt.savefig('calib_accel_result.png')
    plt.close()

# =====================================================================
# TỰ ĐỘNG ĐỌC CSV ĐỂ VẼ TIME-SERIES VÀ BLAND-ALTMAN (ĐỘNG)
# =====================================================================
def plot_angle_errors_from_csv(csv_path):
    if not os.path.exists(csv_path): return
        
    df = pd.read_csv(csv_path)
    t, est, ref = df.iloc[:, 0].values, df.iloc[:, 1].values, df.iloc[:, 2].values
    error = est - ref
    mean_error = np.mean(error)
    std_error = np.std(error)
    loa_upper, loa_lower = mean_error + 1.96*std_error, mean_error - 1.96*std_error

    # Đồ thị 1: Time-series
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), gridspec_kw={'height_ratios': [2, 1]}, sharex=True)
    ax1.plot(t, ref, 'k--', linewidth=2, label='Tham chiếu (Reference)')
    ax1.plot(t, est, 'b-', linewidth=1.5, alpha=0.8, label='Hệ thống (Estimate)')
    ax1.set_ylabel(r'Góc (độ)')
    ax1.set_title('So sánh góc khớp theo thời gian')
    ax1.legend()

    ax2.plot(t, error, 'r-', linewidth=1.2)
    ax2.axhline(0, color='k', linestyle='--', linewidth=1)
    ax2.set_ylabel('Sai số (độ)')
    ax2.set_xlabel('Thời gian (s)')
    plt.savefig('timeseries_error.png')
    plt.close()

    # Đồ thị 2: Bland-Altman
    plt.figure(figsize=(8, 6))
    means = (est + ref) / 2
    plt.scatter(means, error, alpha=0.6, edgecolors='w', s=50, color='#3498db')
    
    plt.axhline(mean_error, color='#e74c3c', linestyle='-', linewidth=2, label=f'Bias: {mean_error:.2f}°')
    plt.axhline(loa_upper, color='#7f8c8d', linestyle='--', linewidth=2, label=f'+1.96 SD: {loa_upper:.2f}°')
    plt.axhline(loa_lower, color='#7f8c8d', linestyle='--', linewidth=2, label=f'-1.96 SD: {loa_lower:.2f}°')

    plt.xlabel('Giá trị trung bình của hệ thống và tham chiếu (độ)')
    plt.ylabel('Sai số (Hệ thống - Tham chiếu) (độ)')
    plt.title('Phân tích Bland-Altman')
    plt.legend()
    plt.savefig('bland_altman.png')
    plt.close()


# =====================================================================
# TỰ ĐỘNG TÍNH TOÁN BẢNG ĐỘ CHÍNH XÁC TĨNH TỪ CSV
# =====================================================================
def calc_static_accuracy(csv_path):
    if not os.path.exists(csv_path):
        return
        
    df = pd.read_csv(csv_path)
    print("\n--- BẢNG 5.2: ĐỘ CHÍNH XÁC TĨNH TỔNG HỢP (STATIC ACCURACY) ---")
    print(f"{'Trục':<10} | {'RMSE (độ)':<10} | {'MAE (độ)':<10}")
    print("-" * 35)
    
    fig, axes = plt.subplots(1, 3, figsize=(15, 5), sharey=True)
    fig.suptitle('Đánh giá sai số góc tĩnh trên 6 cảm biến (5 lần đo)', fontsize=16)
    
    nodes = ["Node1", "Node2", "Node3", "Node4", "Node5", "Node6"]
    axes_list = ["Roll", "Pitch", "Yaw"]
    
    for i, axis in enumerate(axes_list):
        df_axis = df[df["Truc"] == axis]
        if len(df_axis) == 0: continue
        
        ref = df_axis["Ref_Angle"].values
        
        all_errors = []
        for node in nodes:
            est = df_axis[node].values
            
            # Chỉ lấy các điểm dữ liệu đã được điền thật sự (bỏ qua dòng 0,0,0 nếu rỗng)
            valid_idx = (est != 0) | (ref == 0)
            if np.any(valid_idx) and np.sum(est) != 0:
                error = est[valid_idx] - ref[valid_idx]
                all_errors.extend(error)
                
                # Seaborn lineplot tự động tính trung bình các lần đo tại cùng 1 góc và vẽ dải sai số
                sns.lineplot(x=ref[valid_idx], y=error, ax=axes[i], label=node, marker='o', errorbar=None)
        
        axes[i].set_title(f'Trục {axis}')
        axes[i].set_xlabel('Góc tham chiếu (độ)')
        axes[i].set_xticks([0, 30, 45, 60, 90])
        axes[i].axhline(0, color='black', linestyle='--', linewidth=1)
        if i == 0: axes[i].set_ylabel('Sai số (độ)')
        if i == 2: axes[i].legend(loc='upper right', bbox_to_anchor=(1.2, 1))

        if len(all_errors) > 0:
            all_errors = np.array(all_errors)
            rmse = np.sqrt(np.mean(all_errors**2))
            mae = np.mean(np.abs(all_errors))
            print(f"{axis:<10} | {rmse:<10.2f} | {mae:<10.2f}")
        else:
            print(f"{axis:<10} | {'(Trống)':<10} | {'(Trống)':<10}")

    plt.tight_layout()
    plt.savefig('static_accuracy_chart.png')
    plt.close()
    print(">> Đã xuất ảnh: static_accuracy_chart.png")


if __name__ == "__main__":
    # 1. Vẽ đồ thị so sánh gia tốc
    plot_factory_calibration_from_excel(r"c:\Users\Lenovo\Documents\Calib")
    
    # 2. Vẽ đồ thị góc động (nhớ tạo góc test trước)
    plot_angle_errors_from_csv(r"c:\Users\Lenovo\Documents\Calib\angle_test.csv")
    
    # 3. In ra Bảng 5.2 (Sai số góc tĩnh)
    calc_static_accuracy(r"c:\Users\Lenovo\Documents\Calib\static_angle_template.csv")
