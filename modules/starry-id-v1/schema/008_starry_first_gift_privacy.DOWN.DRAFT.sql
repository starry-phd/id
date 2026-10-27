-- DISPOSABLE SQLite :memory: DRAFT ONLY.
-- Actual production retention/erasure legally unresolved; never blindly DROP
-- a live anti-reissue claim registry or release the associated HMAC key.
BEGIN IMMEDIATE;
DROP TABLE IF EXISTS starry_first_gift_claims;
COMMIT;
