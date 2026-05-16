// Tenta um findMany leve em cada model usado pelas telas. Só leitura.
const p = require('../prisma/client');

const checks = [
  ['event', () => p.event.findMany({ take: 1, include: { items: { include: { toy: true } }, company: true } })],
  ['client', () => p.client.findMany({ take: 1 })],
  ['company', () => p.company.findMany({ take: 1 })],
  ['toy', () => p.toy.findMany({ take: 1 })],
  ['monitor', () => p.monitor.findMany({ take: 1, include: { desempenho: true, pagamentos: true } })],
  ['transaction', () => p.transaction.findMany({ take: 1 })],
  ['bankAccount', () => p.bankAccount.findMany({ take: 1 })],
  ['fixedExpense', () => p.fixedExpense.findMany({ take: 1 })],
  ['funcionario', () => p.funcionario.findMany({ take: 1 })],
  ['faixaComissao', () => p.faixaComissao.findMany({ take: 1 })],
  ['task', () => p.task.findMany({ take: 1 })],
  ['dailyPlan', () => p.dailyPlan.findMany({ take: 1 })],
  ['expenseCategory', () => p.expenseCategory.findMany({ take: 1 })],
  ['fixedExpenseCategory', () => p.fixedExpenseCategory.findMany({ take: 1 })],
  ['toyUnit', () => p.toyUnit.findMany({ take: 1 })],
  ['toyPhoto', () => p.toyPhoto.findMany({ take: 1 })],
  ['toyMaintenance', () => p.toyMaintenance.findMany({ take: 1 })],
  ['eventExternalRental', () => p.eventExternalRental.findMany({ take: 1 })],
];

(async () => {
  for (const [name, fn] of checks) {
    try {
      await fn();
      console.log(`OK   ${name}`);
    } catch (e) {
      console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
      // imprime a 1a linha relevante do erro
      const detail = e.message.split('\n').find(l => l.includes('column') || l.includes('does not exist'));
      if (detail) console.log(`     -> ${detail.trim()}`);
    }
  }
  await p.$disconnect();
})();
