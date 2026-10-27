/**
 * AI-4 versioned INTERNAL SDK preview. NOT exported by packages/sdk/src/index.ts.
 * No HTTP request, no login token, no region bypass, no live route.
 */
export const STARRY_ROLLOUT_DRAFT_VERSION='starry-rollout.v0-draft' as const;
export type RolloutPreview=Readonly<{
 schema_version:typeof STARRY_ROLLOUT_DRAFT_VERSION;
 brand_id:'starry'; member_service:'starry-id'; standalone_store_app:false;
 deployment:'blocked'; cross_brand_sync:false; ads_enabled:false;
 gates:Readonly<{identity:'blocked';battery:'blocked';billing:'blocked'}>;
}>;
export function getOfflineRolloutPreview():RolloutPreview {
  return Object.freeze({
    schema_version:STARRY_ROLLOUT_DRAFT_VERSION,
    brand_id:'starry' as const,member_service:'starry-id' as const,
    standalone_store_app:false as const,deployment:'blocked' as const,
    cross_brand_sync:false as const,ads_enabled:false as const,
    gates:Object.freeze({identity:'blocked' as const,
      battery:'blocked' as const,billing:'blocked' as const}),
  });
}
