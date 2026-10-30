import {useMemo} from 'react';
import {AccountDeletionScreen} from '../src/account-deletion-screen';
import {createDeletionPreview} from '../src/account-deletion-preview';
import {M2DeletionClientError} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';
import type {M2DeletionPort} from '../../../packages/sdk/src/m2-local-deletion-request-client.ts';

// Explicitly *NO* test bearer, Auth fixture, SQLite, provider token or live API.
// The only interactive route is a dev-only in-memory demonstration. Production
// shows the information screen with a disabled port until real owner approval.
const disabledPort:M2DeletionPort=Object.freeze({
 async getStatus(){throw new M2DeletionClientError('DISABLED');},
 async requestDeletion(){throw new M2DeletionClientError('DISABLED');},
 async confirmDeletion(){throw new M2DeletionClientError('DISABLED');},
});
export default function AccountDeletionRoute(){
 const preview=__DEV__===true;
 const demo=useMemo(()=>preview?createDeletionPreview():null,[preview]);
 return <AccountDeletionScreen
  port={demo??disabledPort} preview={preview}
  previewTools={demo??undefined}
 />;
}
