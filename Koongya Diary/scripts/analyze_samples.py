from PIL import Image

def analyze_sprite(path):
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    px = img.load()
    
    l, t, r, b = w, h, 0, 0
    found = False
    
    for y in range(h):
        for x in range(w):
            rgba = px[x, y]
            # 투명하지 않고 완전히 흰색이 아닌 픽셀
            if rgba[3] > 10 and (rgba[0] < 255 or rgba[1] < 255 or rgba[2] < 255):
                found = True
                l = min(l, x)
                r = max(r, x)
                t = min(t, y)
                b = max(b, y)
    
    if not found:
        return f"{path}: No content found"
    
    return {
        "path": path,
        "size": (w, h),
        "bbox": (l, t, r, b),
        "content_size": (r - l + 1, b - t + 1),
        "center_point": ((l + r) / 2, (t + b) / 2)
    }

if __name__ == "__main__":
    import os
    results = []
    base_path = "assets/images/banky"
    for f in os.listdir(base_path):
        if f.endswith(".png"):
            results.append(analyze_sprite(os.path.join(base_path, f)))
    
    for res in results:
        print(res)
