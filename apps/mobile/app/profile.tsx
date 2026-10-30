import {MemberProfileScreen} from '../src/member-profile-screen';
import type {MemberProfilePort} from '../src/member-profile-screen';

// The real M1 SDK contract exists, but its server auth + Cloudflare-only
// staging provider is not provisioned. Do not invent a bearer, local profile,
// fake Google sign-in or cross-brand API. Promotion needs a reviewed Auth port.
const disabledPort:MemberProfilePort=Object.freeze({
 async getSelf(){throw Error('STARRY_SELF_DISABLED');},
 async patchSelf(){throw Error('STARRY_SELF_DISABLED');},
 async logout(){throw Error('STARRY_SELF_DISABLED');},
});
export default function ProfileRoute(){
 return <MemberProfileScreen port={disabledPort} enabled={false}/>;
}
