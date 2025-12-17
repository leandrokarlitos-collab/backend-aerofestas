// Script de inicialização dos gráficos - previne loop infinito

// Função global para renderizar gráficos (chamada explicitamente)
window.refreshCharts = function () {
    if (window.state && window.renderAllCharts) {
        console.log('🔄 Renderizando gráficos financeiros...');
        try {
            renderAllCharts(window.state);
            console.log('✅ Gráficos renderizados com sucesso');
        } catch (error) {
            console.error('❌ Erro ao renderizar gráficos:', error);
        }
    } else {
        console.warn('⚠️ State ou renderAllCharts não disponível ainda');
    }
};

// Aguarda 1.5 segundos após o load para renderizar
window.addEventListener('load', () => {
    console.log('📊 Página carregada, agendando renderização dos gráficos...');
    setTimeout(window.refreshCharts, 1500);
});

console.log('✅ Inicializador de gráficos carregado');
