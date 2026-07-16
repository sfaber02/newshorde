// Run one full poll cycle against the DB (all enabled sources), then exit.
import { pollAll } from '../src/poller.js';
import { activeItems } from '../src/db.js';

const result = await pollAll();
console.log(JSON.stringify(result, null, 2));
console.log(`\nActive items now: ${activeItems().length}`);
process.exit(0);
