# ADR 0002：Starry ID 登入與 Token 設計

日期：2026-11-03　狀態：採用

## 背景

規格 S-ID-01～S-ID-09 要求：App 原生 Apple／Google 登入、以 provider＋sub 辨識會員、Refresh Token 輪替與重用偵測、登出所有裝置立即生效、個資修改不可覆蓋較新資料。Echo 等 App 後端需要自行驗證會員身分，不應共用秘密。

## 決定

1. **Nonce 由伺服器發放**：`POST /v1/auth/nonce` 產生單次有效、綁定 app_id、10 分鐘到期的 nonce。ID Token 內的 nonce 可以是原值或 SHA-256 hex（Apple 與部分 SDK 會先雜湊）。驗證成功才消耗 nonce，消耗以單一 `UPDATE … WHERE consumed_at IS NULL` 完成，避免並行重放。
2. **ID Token 驗證**只接受 RS256、只接受 header 的 alg／kid／typ；provider 公鑰快取 1 小時，遇到未知 kid 強制重抓一次。audience 來自 `config/apps.json` 每款 App 的 `auth` 清單。任何失敗都回同一個 `INVALID_TOKEN`，不透露哪一項檢查失敗。
3. **Access Token 用 ES256**（15 分鐘，`aud=starry`、`iss=starry-id:<環境>`、帶 kid），公鑰放在 `/.well-known/jwks.json`。App 後端用公鑰驗證，不需要共用秘密；換鑰時可同時公布新舊兩把（之後的工作）。
4. **每個需要登入的請求都查 D1 的 Session**：撤銷、登出所有裝置（`session_version` 遞增）與停權立即生效，不必等 Access Token 過期。代價是每個請求一次 D1 讀取，以目前規模可接受。
5. **Refresh Token 格式 `<session_id>.<secret>`**，只存 SHA-256(secret)；輪替時保留上一個雜湊，若有人拿上一個 Token 來換，整個 Session 撤銷並寫入安全稽核。
6. **測試替身只在 development 生效**：`AUTH_TEST_JWKS`、`AUTH_TEST_AUDIENCES` 在 staging／production 一律忽略，並有測試確認。
7. **Fail closed**：未設定簽章私鑰或 App 未設定 client ID 時回 503，不簽發任何 Token。

## 後果

- 上線前業主需提供 Echo 的 iOS bundle ID、Apple Services ID 與 Google client ID，填入 `config/apps.json`。
- 每個環境需設定 `ACCESS_TOKEN_PRIVATE_JWK` Workers Secret（可在取得 Cloudflare API Token 後由 CI 一次設定）。
- 服務條款與隱私權政策目前版本為 `draft-2026-11-03`；正式文件上線時更新 `TERMS_VERSION`／`PRIVACY_VERSION`，所有會員會被要求重新同意。
