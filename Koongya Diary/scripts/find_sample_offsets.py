from PIL import Image

def find_match(large_path, small_path):
    large = Image.open(large_path).convert('RGBA')
    small = Image.open(small_path).convert('RGBA')
    
    lw, lh = large.size
    sw, sh = small.size
    
    l_pix = large.load()
    s_pix = small.load()
    
    # 투명하지 않은 픽셀들만 추출하여 매칭에 사용
    non_transparent_pts = []
    for y in range(sh):
        for x in range(sw):
            r, g, b, a = s_pix[x, y]
            if a > 0:
                non_transparent_pts.append((x, y, (r, g, b, a)))
    
    if not non_transparent_pts:
        return "No non-transparent pixels in sample"

    # 전체 이미지 스캔
    for y in range(lh - sh + 1):
        for x in range(lw - sw + 1):
            match = True
            for sx, sy, color in non_transparent_pts:
                # 색상과 투명도 비교
                if l_pix[x + sx, y + sy] != color:
                    match = False
                    break
            if match:
                return (x, y)
    
    return None

if __name__ == "__main__":
    # Banky는 4번째 행, 1번째 열 (인덱스 3, 0)
    # block_x = 0, block_y = 3 * 162 = 486
    # block_w = 115, block_h = 162
    
    large_img = "koongya.png"
    sample_img = "assets/images/banky/step1.png"
    
    result = find_match(large_img, sample_img)
    if result:
        print(f"Match found at global coordinates: {result}")
        # 로컬 오프셋 계산 (Banky 블록 시작점 기준)
        local_x = result[0] - 0
        local_y = result[1] - 486
        print(f"Local offsets in block: x={local_x}, y={local_y}")
    else:
        print("No match found.")
