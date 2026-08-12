ALTER TABLE asset_assets DROP CONSTRAINT IF EXISTS asset_assets_kind_check;
ALTER TABLE asset_assets
  ADD CONSTRAINT asset_assets_kind_check CHECK (kind IN ('product_image', 'avatar_image', 'work_video'));
