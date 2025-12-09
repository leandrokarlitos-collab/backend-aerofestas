const fs = require('fs');

// --- CONFIGURAÇÃO ---
// Sua URL do Railway (já configurada)
let URL_RAILWAY = "https://backend-aerofestas-production.up.railway.app";
if (URL_RAILWAY.endsWith('/')) URL_RAILWAY = URL_RAILWAY.slice(0, -1);

async function iniciarMigracao() {
    console.log("🚀 Lendo arquivos locais...");

    try {
        // Lendo os arquivos JSON (Certifique-se que os nomes estão corretos na pasta)
        const rawDadosCompletos = fs.readFileSync('./dados-completos-2025-12-05.json', 'utf8');
        const rawDadosFinanceiros = fs.readFileSync('./dados-financeiros-2025-12-05.json', 'utf8');

        const dadosCompletos = JSON.parse(rawDadosCompletos);
        const dadosFinanceiros = JSON.parse(rawDadosFinanceiros);

        // Prepara o pacote de dados
        // Importante: O backend espera exatamente estas chaves
        const payload = {
            // Dados Financeiros (Gastos e Pagamentos)
            financeDataV30: dadosFinanceiros.financeDataV30,

            // Dados Operacionais
            toys: dadosCompletos.toys,
            events: dadosCompletos.events,
            clients: dadosCompletos.clients || [],
            companies: dadosCompletos.companies || [] // Garante envio das empresas
        };

        console.log(`📦 Pacote montado! Enviando para: ${URL_RAILWAY}...`);
        console.log("---------------------------------------------------");
        console.log(`🏢 Empresas:     ${payload.companies?.length || 0}`);
        console.log(`👥 Clientes:     ${payload.clients?.length || 0}`);
        console.log(`🧸 Brinquedos:   ${payload.toys?.length || 0}`);
        console.log(`📅 Eventos:      ${payload.events?.length || 0}`);
        console.log(`💰 Gastos:       ${payload.financeDataV30?.gastos?.length || 0}`);
        console.log(`👷 Pagamentos:   ${payload.financeDataV30?.pagamentosMonitores?.length || 0}`);
        console.log("---------------------------------------------------");

        // Envia para a rota de migração completa
        const response = await fetch(`${URL_RAILWAY}/api/migrar-completo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const textoResposta = await response.text();

        try {
            const jsonResposta = JSON.parse(textoResposta);
            if (response.ok) {
                console.log("\n✅ SUCESSO ABSOLUTO!");
                console.log("Mensagem do Servidor:", jsonResposta.message);
            } else {
                console.log("\n❌ ERRO NO SERVIDOR:", jsonResposta);
            }
        } catch (e) {
            console.log("\n❌ ERRO DE RESPOSTA (Não é JSON):", textoResposta);
        }

    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error("\n❌ ERRO: Arquivo JSON não encontrado!");
            console.error("Verifique se 'dados-completos-2025-12-05.json' e 'dados-financeiros-2025-12-05.json' estão na mesma pasta.");
        } else {
            console.error("\n❌ ERRO GERAL:", error.message);
        }
    }
}

iniciarMigracao();