from PIL import Image
import os

def get_content_bbox(img_path):
    img = Image.open(img_path).convert('RGBA')
    width, height = img.size
    pixels = img.load()
    
    left, top, right, bottom = width, height, 0, 0
    found = False
    
    for y in range(height):
        for x in range(width):
            if pixels[x, y][3] > 10: # 투명도가 있는 픽셀
                found = True
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y
                
    if not found:
        return None
    return (left, top, right, bottom)

def analyze_sample():
    sample_path = "assets/images/banky/step1.png"
    if os.path.exists(sample_path):
        bbox = get_content_bbox(sample_path)
        if bbox:
            print(f"Sample BBox: {bbox} (Size: {bbox[2]-bbox[0]+1}x{bbox[3]-bbox[1]+1})")
        else:
            print("Sample is empty/fully transparent.")
    else:
        print("Sample not found.")

if __name__ == "__main__":
    analyze_sample()
