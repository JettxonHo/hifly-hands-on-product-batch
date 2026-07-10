# 人物素材池

当 `products/products.csv` 里的 `person_image_path` 为空时，脚本会按 `category` 到这里自动轮换人物图：

```text
assets/person_pool/<category>/
```

例如 `category=fresh_food` 会优先读取：

```text
assets/person_pool/fresh_food/
```

如果对应品类没有图片，会读取 `assets/person_pool/default/`。如果默认池也为空，并且 `config.local.json` 允许 `personPool.fallbackToRecommended`，脚本会退回飞影弹窗里的推荐人物。

建议每个品类至少准备 3-5 张竖图，人物姿势、场景和景别尽量不同。这样批量视频会更像不同达人在不同场景种草，而不是同一个坐姿模板反复换商品。
