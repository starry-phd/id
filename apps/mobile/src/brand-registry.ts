/** AI-4 Phase 0: config-driven Starry-only app template (not a dynamic tenant registry). */
export type Platform = 'ios' | 'android' | 'web' | 'pwa';
export type StarryAppTemplate = Readonly<{
  brandId: 'starry';
  appId: 'starry-id';
  memberService: 'starry-id';
  platforms: readonly Platform[];
  routes: readonly string[];
  memberAuthEnabled: false;
  crossBrandSyncEnabled: false;
}>;
export const STARRY_ID_TEMPLATE: StarryAppTemplate = Object.freeze({
  brandId:'starry',
  appId:'starry-id',
  memberService:'starry-id',
  platforms:Object.freeze(['ios','android','web','pwa'] as const),
  routes:Object.freeze(['/', '/about', '/member', '/member/sign-in', '/member/profile', '/member/session'] as const),
  memberAuthEnabled:false,
  crossBrandSyncEnabled:false
});
/** Runtime inputs cannot select a different brand, member authority, or enable undeveloped features. */
export function assertStarryTemplate(value: unknown): StarryAppTemplate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_STARRY_TEMPLATE');
  const cfg = value as Partial<Record<keyof StarryAppTemplate, unknown>>;
  if (cfg.brandId !== 'starry' || cfg.appId !== 'starry-id' || cfg.memberService !== 'starry-id'
    || cfg.memberAuthEnabled !== false || cfg.crossBrandSyncEnabled !== false)
    throw new Error('STARRY_SCOPE_MISMATCH');
  if (!Array.isArray(cfg.platforms) || !Array.isArray(cfg.routes)
    || cfg.platforms.length !== 4 || cfg.routes.length !== 6
    || !STARRY_ID_TEMPLATE.platforms.every((x,i)=>cfg.platforms?.[i]===x)
    || !STARRY_ID_TEMPLATE.routes.every((x,i)=>cfg.routes?.[i]===x)) throw new Error('INVALID_STARRY_TEMPLATE');
  return STARRY_ID_TEMPLATE;
}
