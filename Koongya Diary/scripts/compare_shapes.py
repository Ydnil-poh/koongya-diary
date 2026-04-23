from PIL import Image

def get_bbox(img_path):
    img = Image.open(img_path).convert('RGBA')
    width, height = img.size
    pixels = img.load()
    
    left, top, right, bottom = width, height, 0, 0
    found = False
    
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] > 10: # 투명도가 어느 정도 있는 픽셀만
                found = True
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y
                
    if not found: return None
    return (left, top, right, bottom)

def find_shapes():
    # 샘플의 경계 상자
    sample_bbox = get_bbox("assets/images/banky/step1.png")
    # 원본 블록의 경계 상자
    block_bbox = get_bbox("banky_block.png")
    
    print(f"Sample BBox: {sample_bbox} (Size: {sample_bbox[2]-sample_bbox[0]+1}x{sample_bbox[3]-sample_bbox[1]+1})")
    print(f"Block BBox: {block_bbox} (Size: {block_bbox[2]-block_bbox[0]+1}x{block_bbox[3]-block_bbox[1]+1})")

if __name__ == "__main__":
    find_shapes()
