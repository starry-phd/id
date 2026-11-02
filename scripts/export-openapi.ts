// Writes the OpenAPI 3.1 document generated from the route definitions (spec S-PLT-03).
// CI regenerates it and fails when the committed file is stale; oasdiff then checks it
// for breaking changes against the base branch. Apps generate types with openapi-typescript.
import { writeFileSync } from 'node:fs';
import { openApiDocument } from '../src/app';

const target = 'openapi/starry-id.v1.json';
writeFileSync(target, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
console.log(`Wrote ${target}`);
