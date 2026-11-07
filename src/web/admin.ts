// Admin Lite entry point: the sections register their routes on the shared app in this order (order matters for routing).
import './admin-members';
import './admin-battery';
import './admin-tickets';
import './admin-apps';
import './admin-quantum';
import './admin-integrations';
import './admin-audit';

export { adminApp } from './admin-lib';
export { setApiDocument } from './admin-audit';
