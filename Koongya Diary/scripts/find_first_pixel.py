from PIL import Image

def find_first_non_white(img_path):
    img = Image.open(img_path).convert('RGBA')
    width, height = img.size
    pixels = img.load()
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            # 투명하지 않고 완전히 흰색이 아닌 픽셀 찾기
            if a > 0 and (r < 250 or g < 250 or b < 250):
                return (x, y, (r, g, b, a))
    return None

if __name__ == "__main__":
    sample_pt = find_first_non_white("assets/images/banky/step1.png")
    block_pt = find_first_non_white("banky_block.png")
    
    print(f"Sample first pixel at: {sample_pt}")
    print(f"Block first pixel at: {block_pt}")
    
    if sample_pt and block_pt:
        # 블록 상의 좌표에서 샘플 상의 좌표를 빼면 오프셋이 나옴?
        # 아니, 블록 상의 좌표 - 샘플 상의 좌표 = 오프셋
        # 예: 샘플 상에서 (5, 5)에 첫 픽셀이 있고, 블록 상에서 (20, 20)에 있다면
        # 샘플의 (0,0)은 블록의 (15, 15)에 해당함.
        offset_x = block_pt[0] - sample_pt[0]
        offset_y = block_pt[1] - sample_pt[1]
        print(f"Possible offsets: X={offset_x}, Y={offset_y}")
