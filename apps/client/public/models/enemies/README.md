# Enemy 3D Models (`/models/enemies/`)

Đặt toàn bộ file model `.glb` (nên nén Draco) cho các loại zombie/enemy vào thư mục này.

## Quy ước đặt tên (khớp `packages/shared/config/zombies.json`)
- `normal.glb` — Walker (cao ~1.75m)
- `speedy.glb` — Sprinter (cao ~1.55m)
- `armored.glb` — Riot Brute (cao ~2.05m)
- `boss.glb` — Juggernaut Alpha (cao ~3.10m)

## Chuẩn export từ Blender / Blockbench
- **Định dạng:** `.glb` (Binary glTF 2.0, bật Draco compression nếu nặng).
- **Tỉ lệ:** `1 unit = 1 meter`.
- **Gốc tọa độ (Pivot/Origin):** nằm ngay dưới bàn chân (`y = 0`) và chính giữa trục X/Z.
- **Hướng mặt (Forward):** nhìn về trục `+Z` để khớp hướng di chuyển của `PathSystem`.
- **Animation clips (tùy chọn cho Phase 4):** đặt tên clip là `Walk`, `Run`, `Death`, `Slam` (cho Boss).
