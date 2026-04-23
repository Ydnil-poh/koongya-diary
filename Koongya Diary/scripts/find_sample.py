from PIL import Image

def find_match(large_path, small_path):
    large = Image.open(large_path).convert('RGB')
    small = Image.open(small_path).convert('RGB')
    
    lw, lh = large.size
    sw, sh = small.size
    
    l_pixels = large.load()
    s_pixels = small.load()
    
    # 소량의 샘플 포인트로 매칭 속도 향상 (예: 5x5 지점)
    sample_points = []
    for dy in range(0, sh, sh//5):
        for dx in range(0, sw, sw//5):
            sample_points.append((dx, dy, s_pixels[dx, dy]))

    # 전체 이미지 스캔
    for y in range(lh - sh + 1):
        for x in range(lw - sw + 1):
            match = True
            for dx, dy, color in sample_points:
                if l_pixels[x + dx, y + dy] != color:
                    match = False
                    break
            if match:
                # 샘플 포인트가 일치하면 전체 체크
                full_match = True
                for sy in range(sh):
                    for sx in range(sw):
                        if l_pixels[x + sx, y + sy] != s_pixels[sx, sy]:
                            full_match = False
                            break
                    if not full_match: break
                if full_match:
                    return (x, y)
    return None

if __name__ == "__main__":
    result = find_match("koongya.png", "assets/images/banky/step1.png")
    if result:
        print(f"Match found at: {result}")
    else:
        print("No match found.")
