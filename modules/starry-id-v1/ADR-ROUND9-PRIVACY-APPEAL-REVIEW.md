# AI-1 R9｜匿名申訴審閱權限 × 隱私稽核安全交接

基於 [AI-0 第八輪整合 #71](https://github.com/starry-phd/id/pull/71) 已核固定 SHA \`e130bfde68ef0fa40c628a24ec0abade0611d68f\`、[CI/SOP #70](https://github.com/starry-phd/id/pull/70)、[Issue #1 最新驗收](https://github.com/starry-phd/id/issues/1#issuecomment-6435693075) 和 [AI-3 Issue #4](https://github.com/starry-phd/id/issues/4)。業主核准 Q98=B（高風險 Step-up）、Q114=A（匿名申訴）、Q115=A（一般稽核原則90日、重大管理至少一年／法律更長優先）、Q117=A（身份故障 fail-closed）、Q122=B（Starry 單最高管理員＋分級）。Q104 跨系同意撤回、Q119 首次贈送合法最小化防重仍未通過 Privacy Gate。

## 可執行 AI-1 程式與權限介面
- \`src/round9-appeal-reviewer.ts\`：**預設關閉**、僅 Starry dev/staging、server-only 最小審閱。必須持有 AI-1 WeakSet \`TrustedPrincipal\`，每次重讀目前 ACTIVE Member + auth_version、同 App/環境未撤銷且未過期 Session、五分鐘內有效的 Passkey/TOTP 二次驗證。
- 唯一信任後端 D1 的 \`starry_privacy_review_grants\` + \`starry_admin_roles\` + \`starry_members\` 固定 SQL。包括最高管理員在內，不得僅憑角色名稱開啟申訴；明確要求 \`appeal:review_status\` 或 \`privacy:review_retention\` 各自授予、同 App/環境、當前會員版本、未過期未撤銷。Delegated role 也只有獲明確最小授權後才可使用。
- 依序通過後端速率限制、AI-3 隱私／合法審閱政策、AI-3 最小案件狀態 reader，再要求 AI-3 **持久、append-only** 存取稽核證據回執。任何後端不可用／超時／撤權／審閱未批准／未有持久 audit，整個 API deny。只回傳 WeakSet sealed 的 \`case_ref,purpose,status,updated_ms,checked_at\`，**不含**匿名查詢 secret、\`credential_digest\`、附件、OAuth subject、Email、申訴者／管理者資料。不能修改案件、審核結果、資料實體刪除或做法定同意撤回。
- \`schema/009_starry_privacy_review_grants.UP/DOWN.DRAFT.sql\`：可反覆 apply／rollback 的 SQLite \`:memory:\` 唯一、外鍵、權限與撤權測試；**未套用真 D1**。授權管理／高風險角色異動的後端 Step-up、稽核與合法治理仍待 AI-0 批准。
- Node fail-close 測試：仿造 principal、錯品牌／App／環境、suspended/deleted Member、revoked/stale Session、錯誤／未經授權 capability、role 撤銷、step-up 過期、服務故障、法律/隱私 hold 未核准、限流與稽核存入失敗。SQLite 真 \`:memory:\` 加上授權唯一與 rollback。
- 這份權威 **不**建立真申訴工作流程／上傳掃毒／限制速率／郵件通知／付費、也不做自動稽核刪除；Q115 仍需要 AI-3 \`audit-retention.ts\` 的法律保留和合規期限裁決，AI-1 不替 AI-3 資料域自行清除。

## 其它 AI 分工與 Gate
- AI-3：\`anonymous-appeals.ts\` 提供 \`case_ref\`、\`received/reviewing/closed\`；實際連結須提供 backend-only \`privacyCanReview\`, \`abuseLimit\`, \`readMinimalCase\`, \`appendAuditAccess\`，**真實持久成功**才回 \`persisted:true\`，不允許 HTTP client \`ack:true\`。Q114 匿名查詢只用自己的 secret，和管理審閱的 Auth/Role 完全分離。
- AI-4：Worker 實際若批准，強制序列 Principal→active Member/Session→精確 grant→Rate limit→Legal/Privacy→case→Audit；外部絕不能返回 sealed proof、\`credential_digest\`、Secret/附件資訊。現在公開敏感路由仍 disabled。
- AI-0：審法律政策、權限指派、審閱行為稽核保存和資料主體合法請求。完整 128 條的 source-clause 仍待 Gate、Q104/Q119 未解除。
- **Release G00～G10 11/11 BLOCKED**、P05不可發布、H-Global 暫停；禁止 main merge、部署任何環境、真 D1/Queues/OAuth/Secrets/Store/EAS、付費。
