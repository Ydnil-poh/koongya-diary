from PIL import Image

def get_content_bbox(img_path):
    img = Image.open(img_path).convert('RGBA')
    width, height = img.size
    pix = img.load()
    
    # 텍스트 라벨과 배경을 제외하고 실제 캐릭터만 찾기
    # 보통 라벨은 상단이나 하단에 위치하고 캐릭터는 중앙에 위치함
    # 배경이 흰색(255, 255, 255)이라고 가정
    
    l, t, r, b = width, height, 0, 0
    found = False
    
    for y in range(height):
        for x in range(width):
            color = pix[x, y]
            # 흰색이 아니고 투명하지 않은 픽셀 찾기
            if color[0] < 250 or color[1] < 250 or color[2] < 250:
                found = True
                l = min(l, x)
                r = max(r, x)
                t = min(t, y)
                b = max(b, y)
                
    if not found:
        return None
    return (l, t, r, b)

if __name__ == "__main__":
    # 샘플 분석
    sample_bbox = get_content_bbox("assets/images/banky/step1.png")
    # 원본 블록 분석
    raw_bbox = get_content_bbox("banky_block_raw.png")
    
    print(f"Sample BBox: {sample_bbox}") # 60x60 내 위치
    print(f"Raw Block BBox: {raw_bbox}") # 115x162 내 위치
    
    if sample_bbox and raw_bbox:
        # 두 영역의 크기가 비슷하다면 오프셋을 찾을 수 있음
        sample_w = sample_bbox[2] - sample_bbox[0] + 1
        sample_h = sample_bbox[3] - sample_bbox[1] + 1
        raw_w = raw_bbox[2] - raw_bbox[0] + 1
        raw_h = raw_bbox[3] - raw_bbox[1] + 1
        
        print(f"Sample Content Size: {sample_w}x{sample_h}")
        print(f"Raw Content Size: {raw_w}x{raw_h}")
