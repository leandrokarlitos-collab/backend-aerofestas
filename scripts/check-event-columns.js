// Lista colunas da tabela Event no banco. Só leitura.
const p = require('../prisma/client');

(async () => {
  const rows = await p.$queryRawUnsafe(
    "SELECT column_name, data_type, column_default, is_nullable " +
    "FROM information_schema.columns WHERE table_name = 'Event' ORDER BY ordinal_position;"
  );
  console.log('Colunas atuais da tabela Event:');
  for (const r of rows) console.log(`  - ${r.column_name} (${r.data_type})`);

  const hasEventType = rows.some(r => r.column_name === 'eventType');
  console.log('\neventType existe?', hasEventType);
  await p.$disconnect();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
