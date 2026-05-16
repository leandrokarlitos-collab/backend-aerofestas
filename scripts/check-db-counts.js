// Lê o estado atual do banco. NÃO altera nada.
const p = require('../prisma/client');

(async () => {
  const r = await Promise.all([
    p.event.count(),
    p.client.count(),
    p.company.count(),
    p.toy.count(),
    p.monitor.count(),
    p.transaction.count(),
    p.bankAccount.count(),
    p.fixedExpense.count(),
    p.funcionario.count(),
    p.faixaComissao.count(),
    p.task.count(),
    p.dailyPlan.count(),
    p.expenseCategory.count(),
    p.fixedExpenseCategory.count(),
    p.eventItem.count(),
    p.desempenho.count(),
    p.pagamentoMonitor.count(),
    p.toyUnit.count(),
    p.toyPhoto.count(),
    p.toyMaintenance.count(),
    p.eventExternalRental.count(),
  ]);
  console.log(JSON.stringify({
    eventos: r[0],
    clientes: r[1],
    empresas: r[2],
    brinquedos: r[3],
    monitores: r[4],
    transacoes: r[5],
    contasBancarias: r[6],
    contasFixas: r[7],
    funcionarios: r[8],
    faixasComissao: r[9],
    tarefas: r[10],
    planosDiarios: r[11],
    categoriasGastos: r[12],
    categoriasFixas: r[13],
    eventItems: r[14],
    desempenhos: r[15],
    pagamentosMonitor: r[16],
    toyUnits: r[17],
    toyPhotos: r[18],
    toyMaintenances: r[19],
    eventExternalRentals: r[20],
  }, null, 2));
  await p.$disconnect();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
