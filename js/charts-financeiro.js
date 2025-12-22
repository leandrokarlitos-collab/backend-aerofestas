// Arquivo para renderizar gráficos financeiros no estilo bolsa de valores
// Deve ser carregado após Chart.js

// Paleta de cores profissional estilo mercado financeiro
const COLORS = {
    profit: '#10b981',      // Verde (lucro)
    loss: '#ef4444',        // Vermelho (prejuízo)
    blue: '#3b82f6',        // Azul
    purple: '#8b5cf6',      // Roxo
    orange: '#f59e0b',      // Laranja
    pink: '#ec4899',        // Rosa
    teal: '#14b8a6',        // Teal
    indigo: '#6366f1',      // Indigo
    gradient: {
        green: ['rgba(16, 185, 129, 0.8)', 'rgba(16, 185, 129, 0.1)'],
        red: ['rgba(239, 68, 68, 0.8)', 'rgba(239, 68, 68, 0.1)'],
        blue: ['rgba(59, 130, 246, 0.8)', 'rgba(59, 130, 246, 0.1)']
    }
};

// Configurações globais do Chart.js para estilo bolsa
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#6b7280';

// Variáveis globais para armazenar instâncias dos gráficos
let chartEmpresas = null;
let chartDespGerais = null;
let chartGastosCompras = null;
let chartContasFixas = null;
let chartPagMonitores = null;
let chartDaily = null;
let chartMonitorPerf = null;

/**
 * Cria gradiente vertical para gráficos de área
 */
function createGradient(ctx, colorTop, colorBottom) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, colorTop);
    gradient.addColorStop(1, colorBottom);
    return gradient;
}

/**
 * Renderiza todos os gráficos do dashboard
 */
function renderAllCharts(state) {
    const month = state.selectedMonth;
    renderEmpresasChart(state);
    renderDespesasGeraisChart(state);
    renderContasFixasChart(state);
    renderPagamentosMonitoresChart(state);
    renderDailyChart(state, month);
    // renderMonitorPerformanceChart(state); // Desativado a pedido
}

/**
 * 1. Gráfico: Receita por Empresa (Barra Horizontal Estilo Mercado)
 */
function renderEmpresasChart(state) {
    const ctx = document.getElementById('empresas-chart')?.getContext('2d');
    if (!ctx) return;

    const eventosDoMes = (state.eventos || []).filter(e => e.data && e.data.startsWith(state.selectedMonth));

    // Agrupa por empresa
    const empresasMap = {};
    eventosDoMes.forEach(evt => {
        const emp = evt.empresa || 'Sem Empresa';
        empresasMap[emp] = (empresasMap[emp] || 0) + (parseFloat(evt.valor) || 0);
    });

    // Ordenação personalizada: Aero Festas, ABC Festas, Outros
    const sortedLabels = Object.keys(empresasMap).sort((a, b) => {
        if (a === 'Aero Festas') return -1;
        if (b === 'Aero Festas') return 1;
        if (a === 'ABC Festas') return -1;
        if (b === 'ABC Festas') return 1;
        return a.localeCompare(b);
    });

    const data = sortedLabels.map(label => empresasMap[label]);

    // Cores específicas: Aero (Blue), ABC (Red), Outros (Teal/Padrão)
    const backgroundColors = sortedLabels.map(label => {
        if (label === 'Aero Festas') return COLORS.blue;
        if (label === 'ABC Festas') return COLORS.loss; // Vermelho
        return COLORS.teal;
    });

    if (chartEmpresas) chartEmpresas.destroy();

    chartEmpresas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedLabels,
            datasets: [{
                label: 'Receita (R$)',
                data,
                backgroundColor: backgroundColors,
                borderColor: backgroundColors,
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => `R$ ${context.parsed.x.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        callback: (value) => `R$ ${value.toLocaleString('pt-BR')}`
                    }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });
}

/**
 * 2. Gráfico: Distribuição de Despesas (Doughnut Moderno)
 */
function renderDespesasGeraisChart(state) {
    const ctx = document.getElementById('despesas-gerais-chart')?.getContext('2d');
    if (!ctx) return;

    const gastosDoMes = (state.gastos || []).filter(g => g.data && g.data.startsWith(state.selectedMonth));
    const pagamentosMonitoresDoMes = (state.pagamentosMonitores || []).filter(p => p.data && p.data.startsWith(state.selectedMonth));

    // Agrupa por categoria
    const categorias = {};
    gastosDoMes.forEach(gasto => {
        const cat = gasto.categoria || 'Sem Categoria';
        categorias[cat] = (categorias[cat] || 0) + (parseFloat(gasto.valor) || 0);
    });

    // Adiciona pagamentos de monitores como categoria separada
    const totalMonitores = pagamentosMonitoresDoMes.reduce((acc, p) => {
        const total = (parseFloat(p.valorBase) || 0) + (parseFloat(p.horasExtras) || 0) + (parseFloat(p.adicional) || 0);
        return acc + total;
    }, 0);
    if (totalMonitores > 0) {
        categorias['Monitores'] = totalMonitores;
    }

    const labels = Object.keys(categorias);
    const data = Object.values(categorias);
    const colors = [COLORS.orange, COLORS.purple, COLORS.blue, COLORS.pink, COLORS.teal, COLORS.indigo];

    if (chartDespGerais) chartDespGerais.destroy();

    chartDespGerais = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 15, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.label}: R$ ${context.parsed.toFixed(2)}`
                    }
                }
            }
        }
    });
}

/**
 * 4. Gráfico: Contas Fixas (Barra com Status)
 */
function renderContasFixasChart(state) {
    const ctx = document.getElementById('contas-fixas-chart')?.getContext('2d');
    if (!ctx) return;

    const contasFixas = state.contasFixas || [];
    const labels = contasFixas.map(cf => cf.descricao);
    const values = contasFixas.map(cf => parseFloat(cf.valor) || 0);

    if (chartContasFixas) chartContasFixas.destroy();

    chartContasFixas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Valor (R$)',
                data: values,
                backgroundColor: COLORS.blue,
                borderColor: COLORS.blue,
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

/**
 * 5. Gráfico: Pagamentos Monitores (Barra Agrupada)
 */
function renderPagamentosMonitoresChart(state) {
    const ctx = document.getElementById('pagamentos-monitores-chart')?.getContext('2d');
    if (!ctx) return;

    const pagamentosDoMes = (state.pagamentosMonitores || []).filter(p => p.data && p.data.startsWith(state.selectedMonth));

    const pagamentosPorMonitor = {};
    pagamentosDoMes.forEach(p => {
        const total = (parseFloat(p.valorBase) || 0) + (parseFloat(p.horasExtras) || 0) + (parseFloat(p.adicional) || 0);
        pagamentosPorMonitor[p.nome] = (pagamentosPorMonitor[p.nome] || 0) + total;
    });

    const labels = Object.keys(pagamentosPorMonitor);
    const data = Object.values(pagamentosPorMonitor);

    if (chartPagMonitores) chartPagMonitores.destroy();

    chartPagMonitores = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.length > 0 ? labels : ['Nenhum dado'],
            datasets: [{
                label: 'Pagamentos (R$)',
                data: data.length > 0 ? data : [0],
                backgroundColor: COLORS.purple,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                }
            }
        }
    });
}

/**
 * 6. Gráfico: Fluxo de Caixa Diário (Linha Estilo Bolsa - PRINCIPAL!)
 */
function renderDailyChart(state, month) {
    const ctx = document.getElementById('daily-chart')?.getContext('2d');
    if (!ctx) return;

    const [year, monthNum] = month.split('-');
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    // Cria array de todos os dias do mês
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const labels = days.map(d => `${String(d).padStart(2, '0')}/${monthNum}`);

    // Inicializa arrays de receitas e despesas por dia
    const receitasPorDia = new Array(daysInMonth).fill(0);
    const despesasPorDia = new Array(daysInMonth).fill(0);

    // Processa eventos (receitas)
    (state.eventos || []).forEach(evt => {
        if (evt.data && evt.data.startsWith(month)) {
            const dayStr = evt.data.split('-')[2];
            const day = parseInt(dayStr) - 1;
            if (day >= 0 && day < daysInMonth) {
                receitasPorDia[day] += parseFloat(evt.valor) || 0;
            }
        }
    });

    // Processa gastos (despesas)
    (state.gastos || []).forEach(gasto => {
        if (gasto.data && gasto.data.startsWith(month)) {
            const dayStr = gasto.data.split('-')[2];
            const day = parseInt(dayStr) - 1;
            if (day >= 0 && day < daysInMonth) {
                despesasPorDia[day] += parseFloat(gasto.valor) || 0;
            }
        }
    });

    // Processa pagamentos de monitores (despesas)
    (state.pagamentosMonitores || []).forEach(pag => {
        if (pag.data && pag.data.startsWith(month)) {
            const dayStr = pag.data.split('-')[2];
            const day = parseInt(dayStr) - 1;
            if (day >= 0 && day < daysInMonth) {
                const total = (parseFloat(pag.valorBase) || 0) + (parseFloat(pag.horasExtras) || 0) + (parseFloat(pag.adicional) || 0);
                despesasPorDia[day] += total;
            }
        }
    });

    // Processa receitas manuais
    (state.receitas || []).forEach(rec => {
        if (rec.data && rec.data.startsWith(month)) {
            const dayStr = rec.data.split('-')[2];
            const day = parseInt(dayStr) - 1;
            if (day >= 0 && day < daysInMonth) {
                receitasPorDia[day] += parseFloat(rec.valor) || 0;
            }
        }
    });

    // Calcula saldo acumulado (estilo bolsa)
    const saldoAcumulado = [];
    let acumulado = 0;
    for (let i = 0; i < daysInMonth; i++) {
        acumulado += receitasPorDia[i] - despesasPorDia[i];
        saldoAcumulado.push(acumulado);
    }

    if (chartDaily) chartDaily.destroy();

    // Cria gradiente para área
    const gradientGreen = createGradient(ctx, ...COLORS.gradient.green);
    const gradientRed = createGradient(ctx, ...COLORS.gradient.red);

    chartDaily = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Receitas Diárias',
                    data: receitasPorDia,
                    borderColor: COLORS.profit,
                    backgroundColor: gradientGreen,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: COLORS.profit,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 6
                },
                {
                    label: 'Despesas Diárias',
                    data: despesasPorDia,
                    borderColor: COLORS.loss,
                    backgroundColor: gradientRed,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: COLORS.loss,
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 6
                },
                {
                    label: 'Saldo Acumulado',
                    data: saldoAcumulado,
                    borderColor: COLORS.blue,
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    borderDash: [5, 5],
                    tension: 0.4,
                    pointRadius: 3,
                    pointBackgroundColor: COLORS.blue
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: (context) => `${context.dataset.label}: R$ ${context.parsed.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        callback: (value) => `R$ ${value.toLocaleString('pt-BR')}`
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

/**
 * 7. Gráfico: Performance Monitores (Radar/Polar)
 */
function renderMonitorPerformanceChart(state) {
    const ctx = document.getElementById('monitor-geral-performance-chart')?.getContext('2d');
    if (!ctx) return;

    const monitores = state.monitores || [];
    let avgForca = 0, avgAgil = 0, avgProat = 0, avgComun = 0, avgDisp = 0, avgResp = 0;

    if (monitores.length > 0) {
        monitores.forEach(m => {
            if (m.habilidades) {
                avgForca += m.habilidades.forca || 0;
                avgAgil += m.habilidades.agilidade || 0;
                avgProat += m.habilidades.proatividade || 0;
                avgComun += m.habilidades.comunicacao || 0;
                avgDisp += m.habilidades.disponibilidade || 0;
                avgResp += m.habilidades.respeito || 0;
            }
        });
        avgForca /= monitores.length;
        avgAgil /= monitores.length;
        avgProat /= monitores.length;
        avgComun /= monitores.length;
        avgDisp /= monitores.length;
        avgResp /= monitores.length;
    }

    if (chartMonitorPerf) chartMonitorPerf.destroy();

    chartMonitorPerf = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels: ['Força', 'Agilidade', 'Proatividade', 'Comunicação', 'Dispo.', 'Respeito'],
            datasets: [{
                data: [avgForca, avgAgil, avgProat, avgComun, avgDisp, avgResp].map(v => v * 10), // Escala 0-100
                backgroundColor: [
                    'rgba(16, 185, 129, 0.6)',
                    'rgba(59, 130, 246, 0.6)',
                    'rgba(139, 92, 246, 0.6)',
                    'rgba(245, 158, 11, 0.6)',
                    '#3b82f699',
                    '#ec489999'
                ],
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 15, font: { size: 10 } }
                }
            },
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        stepSize: 20
                    }
                }
            }
        }
    });
}

// Exporta funcções para uso global
window.renderAllCharts = renderAllCharts;

console.log('📊 Módulo de gráficos financeiros carregado (estilo bolsa de valores)');
