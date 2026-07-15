import os
import glob
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import pearsonr
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

plt.rcParams.update({
    'font.size': 12, 'axes.labelsize': 13, 'axes.titlesize': 14,
    'xtick.labelsize': 11, 'ytick.labelsize': 11, 'legend.fontsize': 11,
    'figure.dpi': 300, 'figure.autolayout': True, 'font.family': 'serif'
})
sns.set_style("whitegrid")

# =====================================================================
# BẢNG 5.2: ĐỘ CHÍNH XÁC GÓC TĨNH
# =====================================================================
def process_static_accuracy(csv_path="static_angle_template.csv"):
    if not os.path.exists(csv_path): return
    df = pd.read_csv(csv_path)
    
    print("\n" + "="*50)
    print("--- BẢNG 5.2: ĐỘ CHÍNH XÁC GÓC TĨNH ---")
    print(f"{'Góc đặt':<10} | {'Ước lượng TB':<15} | {'Sai số':<10} | {'Độ lệch chuẩn':<15}")
    print("-" * 55)
    
    all_errors = []
    for ang in sorted(df['Ref_Angle'].unique()):
        df_ang = df[df['Ref_Angle'] == ang]
        nodes_data = df_ang[['Node1', 'Node2', 'Node3', 'Node4', 'Node5', 'Node6']].values.flatten()
        
        # Bỏ qua data rỗng
        valid_idx = (nodes_data != 0) | (ang == 0)
        if not np.any(valid_idx) or np.sum(nodes_data) == 0:
            print(f"{ang:<10} | {'(Trống)':<15} | {'(Trống)':<10} | {'(Trống)':<15}")
            continue
            
        valid_data = nodes_data[valid_idx]
        mean_est = np.mean(valid_data)
        error = mean_est - ang
        std_dev = np.std(valid_data)
        all_errors.extend(valid_data - ang)
        
        print(f"{ang:<10} | {mean_est:<15.2f} | {error:<10.2f} | {std_dev:<15.2f}")
        
    if all_errors:
        rmse = np.sqrt(np.mean(np.array(all_errors)**2))
        print("-" * 55)
        print(f"RMSE TỔNG HỢP: {rmse:.2f} độ")
        
    # Vẽ đồ thị Hình 5.2
    plt.figure(figsize=(8, 6))
    ref_angles = []
    mean_ests = []
    
    for ang in sorted(df['Ref_Angle'].unique()):
        df_ang = df[df['Ref_Angle'] == ang]
        nodes_data = df_ang[['Node1', 'Node2', 'Node3', 'Node4', 'Node5', 'Node6']].values.flatten()
        valid_data = nodes_data[(nodes_data != 0) | (ang == 0)]
        if len(valid_data) > 0 and np.sum(valid_data) != 0:
            ref_angles.append(ang)
            mean_ests.append(np.mean(valid_data))
            
    if ref_angles:
        plt.plot(ref_angles, mean_ests, 'bo-', label='Góc ước lượng', linewidth=2, markersize=8)
        plt.plot(ref_angles, ref_angles, 'k--', label='Góc tham chiếu (y = x)', linewidth=1.5)
        plt.xlabel('Góc đặt tham chiếu (độ)')
        plt.ylabel('Góc đo được trung bình (độ)')
        plt.title('Tương quan giữa góc ước lượng và góc đặt tĩnh')
        plt.legend()
        plt.grid(True, linestyle=':', alpha=0.7)
        plt.savefig('static_accuracy.png')
        print(">> Đã xuất ảnh minh họa: static_accuracy.png")
    plt.close()

# =====================================================================
# BẢNG 5.3 & ĐỒ THỊ 5.3, 5.4: ĐỘ CHÍNH XÁC ĐỘNG
# =====================================================================
def process_dynamic_accuracy(csv_path="dynamic_angle_template.csv"):
    if not os.path.exists(csv_path): return
    df = pd.read_csv(csv_path)
    
    print("\n" + "="*50)
    print("--- BẢNG 5.3: ĐỘ CHÍNH XÁC ĐỘNG (DYNAMIC ACCURACY) ---")
    print(f"{'Khớp':<10} | {'RMSE (độ)':<10} | {'MAE (độ)':<10} | {'Pearson r':<10}")
    print("-" * 50)
    
    for khop in df['Khop'].unique():
        df_k = df[df['Khop'] == khop]
        # Lọc bỏ data 0 giả
        valid_idx = (df_k['Est_Angle'] != 0) | (df_k['Ref_Angle'] != 0)
        df_k = df_k[valid_idx]
        
        if len(df_k) < 2:
            print(f"{khop:<10} | {'(Trống)':<10} | {'(Trống)':<10} | {'(Trống)':<10}")
            continue
            
        est, ref = df_k['Est_Angle'].values, df_k['Ref_Angle'].values
        error = est - ref
        rmse = np.sqrt(np.mean(error**2))
        mae = np.mean(np.abs(error))
        r_pearson, _ = pearsonr(est, ref)
        print(f"{khop:<10} | {rmse:<10.2f} | {mae:<10.2f} | {r_pearson:<10.3f}")
        
        # Chỉ vẽ đồ thị cho cái khớp cuối cùng làm ví dụ (hoặc gộp nếu muốn)
        # Để tiết kiệm, ta vẽ đồ thị cho Khớp đầu tiên có data thật
        if len(df_k) > 10 and not os.path.exists('timeseries_error.png'):
            t = df_k['Time'].values
            
            # 1. Time Series
            fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), gridspec_kw={'height_ratios': [2, 1]}, sharex=True)
            ax1.plot(t, ref, 'k--', linewidth=2, label='Tham chiếu')
            ax1.plot(t, est, 'b-', linewidth=1.5, alpha=0.8, label='Hệ thống')
            ax1.set_ylabel('Góc (độ)')
            ax1.set_title(f'So sánh góc khớp {khop} theo thời gian')
            ax1.legend()
            ax2.plot(t, error, 'r-', linewidth=1.2)
            ax2.axhline(0, color='k', linestyle='--', linewidth=1)
            ax2.set_ylabel('Sai số')
            ax2.set_xlabel('Thời gian (s)')
            plt.savefig('d:/DATN/figures/dynamic_tracking.png')
            plt.close()
            print(f">> Đã xuất ảnh minh họa góc động: dynamic_tracking.png (của khớp {khop})")

# =====================================================================
# BẢNG 5.4: TẦM VẬN ĐỘNG (ROM)
# =====================================================================
def process_rom(csv_path="rom_template.csv"):
    if not os.path.exists(csv_path): return
    df = pd.read_csv(csv_path)
    print("\n" + "="*50)
    print("--- BẢNG 5.4: TẦM VẬN ĐỘNG HỆ THỐNG VS GONIOMETER ---")
    print(f"{'Động tác':<15} | {'Hệ thống':<10} | {'Goniometer':<10} | {'Sai số':<10}")
    print("-" * 55)
    
    all_est = []
    all_ref = []
    for idx, row in df.iterrows():
        dong_tac = row['DongTac']
        sys_val = row['HeThong']
        gon_val = row['Goniometer']
        
        if pd.isna(sys_val) or pd.isna(gon_val):
            print(f"{dong_tac:<15} | {'(Trống)':<10} | {'(Trống)':<10} | {'(Trống)':<10}")
            continue
            
        err = sys_val - gon_val
        all_est.append(sys_val)
        all_ref.append(gon_val)
        print(f"{dong_tac:<15} | {sys_val:<10.1f} | {gon_val:<10.1f} | {err:<10.1f}")
        
    if all_est and all_ref:
        est = np.array(all_est)
        ref = np.array(all_ref)
        error = est - ref
        mean_error = np.mean(error)
        std_error = np.std(error)
        
        plt.figure(figsize=(8, 6))
        plt.scatter((est+ref)/2, error, alpha=0.8, edgecolors='w', s=80, color='#2ecc71')
        plt.axhline(mean_error, color='#e74c3c', linestyle='-', linewidth=2, label=f'Bias: {mean_error:.2f}')
        plt.axhline(mean_error + 1.96*std_error, color='#7f8c8d', linestyle='--', linewidth=2)
        plt.axhline(mean_error - 1.96*std_error, color='#7f8c8d', linestyle='--', linewidth=2)
        plt.xlabel('Trung bình Hệ thống và Goniometer (độ)')
        plt.ylabel('Sai số: Hệ thống - Goniometer (độ)')
        plt.title('Phân tích Bland-Altman: Hệ thống IMU vs Thước Goniometer')
        plt.legend()
        plt.grid(True, linestyle=':', alpha=0.7)
        plt.savefig('d:/DATN/figures/bland_altman.png')
        plt.close()
        print(">> Đã xuất ảnh Bland-Altman: bland_altman.png (cho phần ROM)")

# =====================================================================
# BẢNG 5.5: CHỈ SỐ MƯỢT SPARC VÀ LDLJ
# =====================================================================
def process_smoothness(csv_path="smoothness_template.csv"):
    if not os.path.exists(csv_path): return
    df = pd.read_csv(csv_path)
    print("\n" + "="*50)
    print("--- BẢNG 5.5: CHỈ SỐ MƯỢT CHUYỂN ĐỘNG ---")
    print(f"{'Kiểu vận động':<15} | {'SPARC':<10} | {'LDLJ':<10}")
    print("-" * 45)
    for _, row in df.iterrows():
        kieu = row['KieuVanDong']
        sparc = row['SPARC']
        ldlj = row['LDLJ']
        if sparc == 0 and ldlj == 0:
            print(f"{kieu:<15} | {'(Trống)':<10} | {'(Trống)':<10}")
        else:
            print(f"{kieu:<15} | {sparc:<10.2f} | {ldlj:<10.2f}")

# =====================================================================
# HÌNH 5.5: ĐỘ TRÔI KHI ĐỨNG YÊN (DRIFT)
# =====================================================================
def process_drift(csv_path="drift_template.csv"):
    if not os.path.exists(csv_path): return
    df = pd.read_csv(csv_path)
    
    valid = (df['Roll'] != 0) | (df['Pitch'] != 0) | (df['Yaw'] != 0)
    df_valid = df[valid]
    
    print("\n" + "="*50)
    print("--- TỐC ĐỘ TRÔI KHI TĨNH (DRIFT RATE) ---")
    if len(df_valid) < 2:
        print("(Chưa có dữ liệu drift)")
        return
        
    t = df_valid['Time'].values
    dt = t[-1] - t[0]
    
    fig, ax = plt.subplots(figsize=(10, 4))
    for ax_name, color in zip(['Roll', 'Pitch', 'Yaw'], ['#3498db', '#2ecc71', '#e74c3c']):
        vals = df_valid[ax_name].values
        drift_rate = (vals[-1] - vals[0]) / dt if dt > 0 else 0
        print(f"Tốc độ trôi {ax_name}: {drift_rate*3600:.2f} độ/giờ (hay {drift_rate:.5f} độ/s)")
        
        # Để dễ nhìn trên đồ thị, ta trừ đi góc ban đầu để đồ thị bắt đầu từ 0
        ax.plot(t, vals - vals[0], label=f'{ax_name} (Drift: {drift_rate*3600:.1f}°/h)', color=color)
        
    ax.set_ylabel('Góc trôi dạt (độ)')
    ax.set_xlabel('Thời gian (s)')
    ax.set_title('Độ trôi của các góc Euler theo thời gian')
    ax.legend()
    plt.tight_layout()
    plt.savefig('d:/DATN/figures/drift_test.png')
    plt.close()
    print(">> Đã xuất ảnh đo độ trôi: drift_test.png")

if __name__ == "__main__":
    print("\n[HỆ THỐNG TỰ ĐỘNG XỬ LÝ BÁO CÁO LUẬN VĂN]")
    
    # 1. Bảng 5.2: Độ chính xác tĩnh
    process_static_accuracy()
    
    # 2. Bảng 5.3: Độ chính xác động
    process_dynamic_accuracy()
    
    # 3. Hình 5.5: Độ trôi khi tĩnh
    process_drift()
    
    # 4. Bảng 5.4: ROM
    process_rom()
    
    # 5. Bảng 5.5: Smoothness
    process_smoothness()
    print("\nHOÀN TẤT! COPY CÁC BẢNG TRÊN VÀO FILE TEX VÀ CHÈN CÁC FILE ẢNH VÀO LÀ XONG.")
