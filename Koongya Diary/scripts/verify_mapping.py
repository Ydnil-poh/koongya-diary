from PIL import Image

def verify_mapping():
    img = Image.open("koongya.png")
    w, h = img.size
    
    # 4행 2열 블록 가이드
    row_h = h // 4 # 162
    col_w = w // 2 # 576
    stage_w = col_w // 5 # 115
    
    # 각 블록의 첫 번째 스테이지만 잘라서 저장
    mapping = [
        ['celery', 'cabbage'],
        ['peemang', 'riceball'],
        ['onion', 'garlic'],
        ['banky', 'mushy']
    ]
    
    for r in range(4):
        for c in range(2):
            name = mapping[r][c]
            left = c * col_w
            top = r * row_h
            # 1단계 스프라이트 추출 (115x162)
            sprite = img.crop((left, top, left + stage_w, top + row_h))
            sprite.save(f"test_{name}_raw.png")
            print(f"Saved test_{name}_raw.png at ({left}, {top})")

if __name__ == "__main__":
    verify_mapping()
