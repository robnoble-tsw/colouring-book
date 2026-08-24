from PIL import Image, ImageDraw

SIZE = 1024
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)

# Background: soft gradient-ish (two-tone) rounded square
bg_top = (109, 90, 220)
bg_bottom = (73, 58, 176)
grad = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
gdraw = ImageDraw.Draw(grad)
for y in range(SIZE):
    t = y / SIZE
    r = int(bg_top[0] + (bg_bottom[0] - bg_top[0]) * t)
    g = int(bg_top[1] + (bg_bottom[1] - bg_top[1]) * t)
    b = int(bg_top[2] + (bg_bottom[2] - bg_top[2]) * t)
    gdraw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

mask = Image.new("L", (SIZE, SIZE), 0)
mdraw = ImageDraw.Draw(mask)
mdraw.rounded_rectangle([0, 0, SIZE, SIZE], radius=220, fill=255)
img.paste(grad, (0, 0), mask)
draw = ImageDraw.Draw(img)

# Paint palette (white ellipse with a thumb-hole cut out)
cx, cy = SIZE * 0.46, SIZE * 0.56
draw.ellipse([cx - 300, cy - 230, cx + 300, cy + 230], fill=(255, 255, 255, 255))
# thumb hole (cut using background colour circle)
hole_cx, hole_cy = cx + 190, cy + 40
draw.ellipse([hole_cx - 70, hole_cy - 70, hole_cx + 70, hole_cy + 70], fill=(0, 0, 0, 0))
# redraw background behind hole so it shows the gradient, not transparency
hole_mask = Image.new("L", (SIZE, SIZE), 0)
hmdraw = ImageDraw.Draw(hole_mask)
hmdraw.ellipse([hole_cx - 70, hole_cy - 70, hole_cx + 70, hole_cy + 70], fill=255)
img.paste(grad, (0, 0), Image.composite(hole_mask, Image.new("L", (SIZE, SIZE), 0), mask))

draw = ImageDraw.Draw(img)

# Colour blobs on the palette
blobs = [
    (cx - 190, cy - 120, (255, 99, 91)),
    (cx - 40, cy - 190, (255, 191, 71)),
    (cx + 120, cy - 150, (255, 214, 92)),
    (cx - 210, cy + 40, (97, 197, 140)),
    (cx - 60, cy + 130, (74, 158, 255)),
    (cx - 190, cy + 170, (186, 122, 255)),
]
r = 62
for bx, by, colour in blobs:
    draw.ellipse([bx - r, by - r, bx + r, by + r], fill=colour + (255,))

# Paintbrush across the top-right corner
brush_colour = (63, 47, 40, 255)
ferrule = (196, 168, 120, 255)
bristle = (255, 143, 107, 255)

# handle
draw.line([(SIZE * 0.62, SIZE * 0.30), (SIZE * 0.88, SIZE * 0.08)], fill=brush_colour, width=46)
draw.ellipse([SIZE * 0.62 - 23, SIZE * 0.30 - 23, SIZE * 0.62 + 23, SIZE * 0.30 + 23], fill=brush_colour)
# ferrule
draw.line([(SIZE * 0.66, SIZE * 0.245), (SIZE * 0.735, SIZE * 0.175)], fill=ferrule, width=54)
# bristle tip
draw.polygon([
    (SIZE * 0.60, SIZE * 0.335),
    (SIZE * 0.685, SIZE * 0.255),
    (SIZE * 0.655, SIZE * 0.225),
    (SIZE * 0.555, SIZE * 0.30),
], fill=bristle)

img.save("icon-1024.png")

for size in (180, 192, 512):
    img.resize((size, size), Image.LANCZOS).save(f"icon-{size}.png")

print("done")
