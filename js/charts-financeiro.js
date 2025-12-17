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
    renderGastosComprasChart(state);
    renderContasFixasChart(state);
    renderPagamentosMonitoresChart(state);
    renderDailyChart(state, month);
    renderMonitorPerformanceChart(state);
}

/**
 * 1. Gráfico: Receita por Empresa (Barra Horizontal Estilo Mercado)
 */
function renderEmpresasChart(state) {
    const ctx = document.getElementById('empresas-chart')?.getContext('2d');
    if (!ctx) return;

    const eventosDoMes = (state.eventos || []).filter(e => e.date && e.date.startsWith(state.selectedMonth));

    // Agrupa por empresa
    const empresas = {};
    eventosDoMes.forEach(evt => {
        const emp = evt.company || 'Sem Empresa';
        empresas[emp] = (empresas[emp] || 0) + (parseFloat(evt.totalPrice) || 0);
    });

    const labels = Object.keys(empresas);
    const data = Object.values(empresas);

    if (chartEmpresas) chartEmpresas.destroy();

    chartEmpresas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Receita (R$)',
                data,
                backgroundColor: COLORS.profit,
                borderColor: COLORS.profit,
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

    const gastosDoMes = (state.gastos || []).filter(g => g.date && g.date.startsWith(state.selectedMonth));

    // Agrupa por categoria
    const categorias = {};
    gastosDoMes.forEach(gasto => {
        const cat = gasto.categoria || 'Sem Categoria';
        categorias[cat] = (categorias[cat] || 0) + (parseFloat(gasto.valor) || 0);
    });

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
 * 3. Gráfico: Gastos & Compras (Pizza com Animação)
 */
function renderGastosComprasChart(state) {
    const ctx = document.getElementById('gastos-compras-chart')?.getContext('2d');
    if (!ctx) return;

    const gastosDoMes = (state.gastos || []).filter(g => g.date && g.date.startsWith(state.selectedMonth));

    // Separa por tipo de pagamento
    const tipos = {};
    gastosDoMes.forEach(gasto => {
        const tipo = gasto.metodoPagamento || 'Não especificado';
        tipos[tipo] = (tipos[tipo] || 0) + (parseFloat(gasto.valor) || 0);
    });

    const labels = Object.keys(tipos);
    const data = Object.values(tipos);
    const colors = [COLORS.blue, COLORS.purple, COLORS.orange, COLORS.teal];

    if (chartGastosCompras) chartGastosCompras.destroy();

    chartGastosCompras = new Chart(ctx, {
        type: 'pie',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 15 }
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

    // Este gráfico precisa de dados de pagamentos de monitores
    // Por enquanto vou criar um exemplo básico

    if (chartPagMonitores) chartPagMonitores.destroy();

    chartPagMonitores = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Monitor 1', 'Monitor 2', 'Monitor 3'],
            datasets: [{
                label: 'Pagamentos (R$)',
                data: [1200, 1500, 980],
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
        if (evt.date && evt.date.startsWith(month)) {
            const day = parseInt(evt.date.split('-')[2]) - 1;
            receitasPorDia[day] += parseFloat(evt.totalPrice) || 0;
        }
    });

    // Processa gastos (despesas)
    (state.gastos || []).forEach(gasto => {
        if (gasto.date && gasto.date.startsWith(month)) {
            const day = parseInt(gasto.date.split('-')[2]) - 1;
            despesasPorDia[day] += parseFloat(gasto.valor) || 0;
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

    if (chartMonitorPerf) chartMonitorPerf.destroy();

    chartMonitorPerf = new Chart(ctx, {
        type: 'polarArea',
        data: {
            labels: ['Pontualidade', 'Qualidade', 'Feedback', 'Eventos'],
            datasets: [{
                data: [85, 90, 78, 92],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.6)',
                    'rgba(59, 130, 246, 0.6)',
                    'rgba(139, 92, 246, 0.6)',
                    'rgba(245, 158, 11, 0.6)'
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
                    labels: { padding: 15 }
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
