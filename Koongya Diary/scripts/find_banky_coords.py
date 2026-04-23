from PIL import Image

def find_match(large_path, small_path):
    large = Image.open(large_path).convert('RGBA')
    small = Image.open(small_path).convert('RGBA')
    lw, lh = large.size
    sw, sh = small.size
    
    l_data = large.getdata()
    s_data = small.getdata()
    
    # 60x60 매칭을 위해 첫 몇 픽셀만 먼저 확인하여 속도 향상
    s_top_left = s_data[0]
    
    for y in range(lh - sh + 1):
        for x in range(lw - sw + 1):
            if l_data[y * lw + x] == s_top_left:
                # 첫 픽셀 일치 시 전체 매칭 확인
                match = True
                for j in range(sh):
                    for i in range(sw):
                        if l_data[(y + j) * lw + (x + i)] != s_data[j * sw + i]:
                            match = True # 일단 True로 두고 아니면 False
                            # 여기서 투명도나 색상 오차를 고려할 수도 있지만, 
                            # 샘플이 원본에서 정확히 크롭되었다면 pixel-perfect 매칭이어야 함.
                            if l_data[(y + j) * lw + (x + i)] != s_data[j * sw + i]:
                                match = False
                                break
                    if not match: break
                if match:
                    return (x, y)
    return None

if __name__ == "__main__":
    result = find_match("koongya.png", "assets/images/banky/step1.png")
    if result:
        print(f"Match found at: {result}")
    else:
        print("No exact match found.")
