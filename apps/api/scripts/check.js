// Launch check for the current .env: `npm run api:check` (or NODE_ENV=production … for the server's own file).
import { preflight } from '../src/services/preflight.js';

const { blockers, warnings } = preflight();
const tick = s => console.log(`  ✓ ${s}`);
console.log(`\nPhysioCare launch check (${process.env.NODE_ENV || 'development'})\n`);
if (!blockers.length) tick('No blockers: the API will start in production.');
else { console.log(`BLOCKERS (${blockers.length}) — the API refuses to start in production until these are fixed:`); blockers.forEach(b => console.log(`  ✗ ${b}`)); }
if (warnings.length) { console.log(`\nTo do before or soon after launch (${warnings.length}):`); warnings.forEach(w => console.log(`  ! ${w}`)); }
console.log('');
process.exit(blockers.length && process.env.NODE_ENV === 'production' ? 1 : 0);
