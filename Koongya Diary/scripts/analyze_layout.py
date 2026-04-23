from PIL import Image

def analyze_image(path):
    img = Image.open(path).convert('RGBA')
    width, height = img.size
    pixels = img.load()

    # 가로/세로 빈 줄 찾기 (투명도 0인 줄)
    empty_cols = []
    for x in range(width):
        is_empty = True
        for y in range(height):
            if pixels[x, y][3] > 0:
                is_empty = False
                break
        if is_empty:
            empty_cols.append(x)

    empty_rows = []
    for y in range(height):
        is_empty = True
        for x in range(width):
            if pixels[x, y][3] > 0:
                is_empty = False
                break
        if is_empty:
            empty_rows.append(y)

    print(f"Dimensions: {width}x{height}")
    print(f"Empty columns count: {len(empty_cols)}")
    print(f"Empty rows count: {len(empty_rows)}")
    
    # 연속된 빈 줄을 뭉쳐서 경계선 찾기
    def get_boundaries(empty_list, total_size):
        boundaries = [0]
        for i in range(len(empty_list) - 1):
            if empty_list[i+1] != empty_list[i] + 1:
                # 비어있지 않은 구간 발견
                boundaries.append(empty_list[i] + 1)
                boundaries.append(empty_list[i+1])
        boundaries.append(total_size)
        return boundaries

    # 이 로직대신 그냥 투명하지 않은 영역의 시작과 끝을 반환하는 함수
    def find_content_regions(empty_list, total_size):
        regions = []
        is_content = False
        start = 0
        
        # 0부터 total_size까지 스캔
        empty_set = set(empty_list)
        for i in range(total_size):
            if i not in empty_set: # 내용 있음
                if not is_content:
                    start = i
                    is_content = True
            else: # 비어 있음
                if is_content:
                    regions.append((start, i))
                    is_content = False
        if is_content:
            regions.append((start, total_size))
        return regions

    col_regions = find_content_regions(empty_cols, width)
    row_regions = find_content_regions(empty_rows, height)

    print("Content Columns:", col_regions)
    print("Content Rows:", row_regions)

if __name__ == "__main__":
    analyze_image("koongya.png")
