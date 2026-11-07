// Preloaded into every unit-test process (see "test:unit" in package.json): the two Apps that migration 0028 registers
// in the database, so tests that look an App up without a database still find them. test/unit/shipped-apps.test.ts
// checks that this fixture and the migration say the same thing.
import { parseApp, setDynamicApps } from '../../src/apps/registry';
import shipped from './shipped-apps.json';

export const SHIPPED_APPS = (shipped as unknown[]).map((definition) => parseApp(definition));
setDynamicApps(new Map(SHIPPED_APPS.map((a) => [a.app_id, a])));
