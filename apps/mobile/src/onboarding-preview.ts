/**
 * AI-4 Expo onboarding preview for Q93=A/Q106=A/Q107=B.
 * Pure client-side date check only. NEVER a membership age-verification proof:
 * trusted age, risk, jurisdiction and App Store policy remain AI-1/server Gate.
 * Do not retain raw birthdate, link it to a user, or send it to analytics.
 */
export type AgePreview = Readonly<{
  status:'invalid'|'under_18'|'server_and_region_review_required';
  may_register:false; age_verified:false; date_of_birth_stored:false;
  region_enabled:false; advertisements_enabled:false;
}>;
function answer(status:AgePreview['status']):AgePreview{
  return Object.freeze({status,may_register:false as const,age_verified:false as const,
    date_of_birth_stored:false as const,region_enabled:false as const,
    advertisements_enabled:false as const});
}
function utcDate(s:unknown):readonly [number,number,number]|null{
  if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const [y,m,d]=s.split('-').map(Number);
  if(y<1900||y>9999||m<1||m>12||d<1||d>31)return null;
  const date=new Date(Date.UTC(y,m-1,d));
  if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;
  return [y,m,d];
}
/**
 * currentDate is injected for deterministic offline tests. An untrusted clock
 * cannot create permission; even adult result requires backend region/risk Gate.
 * For Feb29 births in non-leap years the cutoff is conservatively March 1.
 */
export function previewAgeSelfDeclaration(
  birthDate:unknown, currentUtcDate:unknown, regionCode:unknown,
):AgePreview{
  const birth=utcDate(birthDate), today=utcDate(currentUtcDate);
  if(!birth||!today||typeof regionCode!=='string'
    ||!/^[A-Z]{2}$/.test(regionCode))return answer('invalid');
  const [by,bm,bd]=birth,[ty,tm,td]=today;
  const beforeBirthday=tm<bm||(tm===bm&&td<bd);
  const age=ty-by-(beforeBirthday?1:0);
  if(age<0)return answer('invalid');
  if(age<18)return answer('under_18');
  // No region auto-allowlist: global rollout requires country-by-country Gate.
  return answer('server_and_region_review_required');
}
