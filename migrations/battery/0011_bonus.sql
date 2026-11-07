-- Battery bonus multiplier: a member who makes more profile fields public earns more free Battery.
-- multiplier_x10 = 10 means 1.0x; every public bonus field adds 1 (0.1x). No row means 1.0x.
-- It is kept in step with the profile by the identity side (setBonus); only the free monthly Battery and
-- free Battery codes are multiplied. Purchases, Quantum Battery and staff adjustments never are.
CREATE TABLE battery_bonus (
  user_id TEXT PRIMARY KEY,
  multiplier_x10 INTEGER NOT NULL CHECK (multiplier_x10 BETWEEN 10 AND 100),
  updated_at INTEGER NOT NULL
);
