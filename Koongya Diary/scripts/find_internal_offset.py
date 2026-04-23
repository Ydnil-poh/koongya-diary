from PIL import Image

def find_offset(raw_path, sample_path):
    raw = Image.open(raw_path).convert('RGBA')
    sample = Image.open(sample_path).convert('RGBA')
    
    rw, rh = raw.size
    sw, sh = sample.size
    
    raw_px = raw.load()
    sample_px = sample.load()
    
    # 픽셀 매칭 (투명도 고려)
    for y in range(rh - sh + 1):
        for x in range(rw - sw + 1):
            match = True
            for sy in range(sh):
                for sx in range(sw):
                    rp = raw_px[x + sx, y + sy]
                    sp = sample_px[sx, sy]
                    
                    # 샘플이 거의 투명하다면(배경) 무시하거나 대략 매칭
                    if sp[3] < 10:
                        continue
                    
                    # 색상 비교 (약간의 오차 허용 가능하지만 일단 엄격하게)
                    if rp[0] != sp[0] or rp[1] != sp[1] or rp[2] != sp[2]:
                        match = False
                        break
                if not match: break
            if match:
                return (x, y)
    return None

if __name__ == "__main__":
    offset = find_offset("test_banky_raw.png", "assets/images/banky/step1.png")
    if offset:
        print(f"Internal Offset Found: {offset}")
    else:
        print("No match found. The sample might be resized or cleaned up manually.")
