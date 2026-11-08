// Account center entry point: the sections register their routes on the shared app in this order (order matters for routing).
import './account-home';
import './account-profile';
import './account-network';
import './account-apps';
import './account-passkeys';
import './account-danger';

export { accountApp, publicPages, passkeyScript } from './account-lib';
