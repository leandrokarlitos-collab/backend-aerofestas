const fs = require('fs');

// --- CONFIGURAÇÃO ---
let URL_RAILWAY = "https://backend-aerofestas-production.up.railway.app";
if (URL_RAILWAY.endsWith('/')) URL_RAILWAY = URL_RAILWAY.slice(0, -1);

async function iniciarMigracao() {
    console.log("🚀 Lendo arquivos locais...");

    try {
        const rawDadosCompletos = fs.readFileSync('./dados-completos-2025-12-05.json', 'utf8');
        const rawDadosFinanceiros = fs.readFileSync('./dados-financeiros-2025-12-05.json', 'utf8');

        const dadosCompletos = JSON.parse(rawDadosCompletos);
        const dadosFinanceiros = JSON.parse(rawDadosFinanceiros);

        // EXTRAINDO EMPRESAS (Se estiverem na raiz ou dentro de alguma chave)
        // Ajuste aqui se suas empresas estiverem salvas com outro nome no JSON
        const companies = dadosCompletos.companies || []; 

        const payload = {
            financeDataV30: dadosFinanceiros.financeDataV30,
            toys: dadosCompletos.toys,
            events: dadosCompletos.events,
            clients: dadosCompletos.clients || [],
            companies: companies // <--- ADICIONADO: Envia as empresas
        };

        console.log(`📦 Pacote montado! Enviando para: ${URL_RAILWAY}...`);
        console.log(`   - Empresas: ${payload.companies?.length || 0}`);
        console.log(`   - Monitores: ${payload.financeDataV30?.monitores?.length || 0}`);
        console.log(`   - Brinquedos: ${payload.toys?.length || 0}`);
        console.log(`   - Eventos: ${payload.events?.length || 0}`);

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
                console.log("Mensagem:", jsonResposta.message);
            } else {
                console.log("\n❌ ERRO NO SERVIDOR:", jsonResposta);
            }
        } catch (e) {
            console.log("\n❌ ERRO CRÍTICO (HTML):", textoResposta.substring(0, 300));
        }

    } catch (erro) {
        console.error("\n❌ ERRO:", erro.message);
    }
}

iniciarMigracao();