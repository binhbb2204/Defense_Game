# Enemy 3D Models (Single Source of Truth)

Toàn bộ model `.glb` và file nguồn của từng loại enemy được quản lý tập trung tại **`packages/shared/enemies/<TenEnemy>/`** (không cần copy trùng sang `public/`):

- `packages/shared/enemies/Normal/Normal.glb`
- `packages/shared/enemies/Speedy/Speedy.glb` (kèm `generate.mjs`)
- `packages/shared/enemies/Armored/Armored.glb` *(khi sẵn sàng)*
- `packages/shared/enemies/Boss/Boss.glb` *(khi sẵn sàng)*

Client import trực tiếp qua alias `@enemies-assets/<TenEnemy>/<File>.glb?url` (Vite tự phục vụ ở chế độ dev và đóng gói vào `dist/assets/` khi build Web / Tauri).
