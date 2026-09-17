require('dotenv/config');

const {
  pool
} = require('../src/db/pool.js');

const {
  listStaffByRole
} = require('../src/models/users.model.js');

const {
  updateAgency
} = require('../src/models/agencies.model.js');

async function main() {
  const rms = (await listStaffByRole('relationship_manager')).filter((rm) => rm.status === 'active');

  if (rms.length === 0) {
    console.log('No active Relationship Managers found — nothing to assign to. Activate or create one first.');
    await pool.end();
    return;
  }

  const { rows: unassigned } = await pool.query(
    `SELECT id, name FROM agencies WHERE rm_user_id IS NULL ORDER BY created_at ASC`
  );

  if (unassigned.length === 0) {
    console.log('Every agency already has a Relationship Manager assigned — nothing to do.');
    await pool.end();
    return;
  }

  console.log(`Assigning ${unassigned.length} agenc${unassigned.length === 1 ? 'y' : 'ies'} across ${rms.length} active RM(s), round-robin:`);

  for (let i = 0; i < unassigned.length; i += 1) {
    const agency = unassigned[i];
    const rm = rms[i % rms.length];
    await updateAgency(agency.id, { rmUserId: rm.id });
    console.log(`  ${agency.name} -> ${rm.full_name}`);
  }

  console.log('Done.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
