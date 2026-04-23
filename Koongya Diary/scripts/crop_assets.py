import os
from PIL import Image

def remove_white_background(img):
    img = img.convert("RGBA")
    pix = img.load()
    width, height = img.size
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pix[x, y]
            # 흰색에 가까운 픽셀은 투명하게 처리
            if r > 245 and g > 245 and b > 245:
                pix[x, y] = (255, 255, 255, 0)
    return img

def get_content_center(block):
    width, height = block.size
    pixels = block.load()
    
    left, top, right, bottom = width, height, 0, 0
    found = False
    
    def is_content(rgba):
        r, g, b, a = rgba
        # 흰색(배경)이 아니면 내용으로 간주
        return r < 245 or g < 245 or b < 245

    for y in range(height):
        for x in range(width):
            if is_content(pixels[x, y]):
                found = True
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y
                
    if not found:
        return width // 2, height // 2
    
    return (left + right) // 2, (top + bottom) // 2

def crop_koongya_v3(input_path, output_dir):
    character_map = [
        ['celery', 'cabbage'],
        ['peemang', 'riceball'],
        ['onion', 'garlic'],
        ['banky', 'mushy']
    ]
    
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found.")
        return

    master_img = Image.open(input_path).convert('RGBA')
    width, height = master_img.size
    
    row_count = 4
    col_count = 2
    stages = 5
    
    group_w = width // col_count # 576
    group_h = height // row_count # 162
    stage_w = group_w // stages # 115
    
    target_size = 60
    half_target = target_size // 2

    for r in range(row_count):
        for c in range(col_count):
            char_name = character_map[r][c]
            char_dir = os.path.join(output_dir, char_name)
            os.makedirs(char_dir, exist_ok=True)
            
            group_left = c * group_w
            group_top = r * group_h
            
            for s in range(stages):
                # 1. 원본 블록 추출 (115x162)
                left = group_left + (s * stage_w)
                top = group_top
                right = left + stage_w
                bottom = top + group_h
                
                block = master_img.crop((left, top, right, bottom))
                
                # 2. 중심점 추출
                cx, cy = get_content_center(block)
                
                # 3. 60x60 크롭
                crop_l = cx - half_target
                crop_t = cy - half_target
                crop_r = crop_l + target_size
                crop_b = crop_t + target_size
                
                sprite = block.crop((crop_l, crop_t, crop_r, crop_b))
                
                # 4. 배경 제거 (흰색 -> 투명)
                processed_sprite = remove_white_background(sprite)
                
                # 5. 저장
                output_name = f"step{s + 1}.png"
                output_path = os.path.join(char_dir, output_name)
                processed_sprite.save(output_path)
                print(f"Processed: {output_path} (Center: {cx}, {cy})")

if __name__ == "__main__":
    crop_koongya_v3("koongya.png", "assets/images")
