from PIL import Image

def find_offsets(block_path, sample_path):
    block = Image.open(block_path).convert('RGBA')
    sample = Image.open(sample_path).convert('RGBA')
    
    bw, bh = block.size
    sw, sh = sample.size
    
    b_pix = block.load()
    s_pix = sample.load()
    
    for y in range(bh - sh + 1):
        for x in range(bw - sw + 1):
            match = True
            for sy in range(sh):
                for sx in range(sw):
                    # 투명도가 0인 경우 패스하거나, 색상과 투명도를 모두 체크
                    if b_pix[x + sx, y + sy] != s_pix[sx, sy]:
                        match = False
                        break
                if not match: break
            if match:
                return (x, y)
    return None

if __name__ == "__main__":
    offsets = find_offsets("banky_block.png", "assets/images/banky/step1.png")
    if offsets:
        print(f"Match found at X={offsets[0]}, Y={offsets[1]}")
    else:
        print("No match found.")
