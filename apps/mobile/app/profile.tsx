import {useMemo} from 'react';
import {MemberProfileScreen} from '../src/member-profile-screen';
import type {MemberProfilePort} from '../src/member-profile-screen';
import {createMemberProfilePreview} from '../src/member-profile-preview';

// Real Auth, dedicated Starry D1, Access and official Google credentials
// are not provisioned. Development-only disposable screen interaction is
// never promoted to a signed Session or published membership backend.
const disabledPort:MemberProfilePort=Object.freeze({
 async getSelf(){throw Error('STARRY_SELF_DISABLED');},
 async patchSelfForUser(){throw Error('STARRY_SELF_DISABLED');},
 async logout(){throw Error('STARRY_SELF_DISABLED');},
});
export default function ProfileRoute(){
 const preview=__DEV__===true;
 const fixture=useMemo(()=>preview?createMemberProfilePreview():null,[preview]);
 return <MemberProfileScreen
  port={fixture??disabledPort} enabled={fixture!==null}
  preview={preview} previewTools={fixture??undefined}
 />;
}
