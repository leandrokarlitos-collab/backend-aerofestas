const fs = require('fs');

// --- CONFIGURAÇÃO ---
// ⚠️ COLE SUA URL DO RAILWAY AQUI (SEM BARRA NO FINAL)
const URL_RAILWAY = "https://backend-aerofestas-production.up.railway.app"; 

async function iniciarMigracao() {
    console.log("🚀 Lendo arquivos locais...");

    try {
        // 1. Lendo os arquivos JSON
        const rawDadosCompletos = fs.readFileSync('./dados-completos-2025-12-05.json', 'utf8');
        const rawDadosFinanceiros = fs.readFileSync('./dados-financeiros-2025-12-05.json', 'utf8');

        const dadosCompletos = JSON.parse(rawDadosCompletos);
        const dadosFinanceiros = JSON.parse(rawDadosFinanceiros);

        // 2. Montando o pacote para envio
        // O backend espera: { financeDataV30, toys, events, clients }
        const payload = {
            financeDataV30: dadosFinanceiros.financeDataV30, // Pega a chave certa dentro do arquivo
            toys: dadosCompletos.toys,
            events: dadosCompletos.events,
            clients: dadosCompletos.clients || [] // Garante que não quebre se não tiver clientes
        };

        console.log(`📦 Pacote montado! Enviando para: ${URL_RAILWAY}...`);
        console.log(`   - Monitores: ${payload.financeDataV30?.monitores?.length || 0}`);
        console.log(`   - Brinquedos: ${payload.toys?.length || 0}`);
        console.log(`   - Eventos: ${payload.events?.length || 0}`);

        // 3. Enviando para a Nuvem
        const response = await fetch(`${URL_RAILWAY}/api/migrar-completo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const resultado = await response.json();

        if (response.ok) {
            console.log("\n✅ SUCESSO ABSOLUTO!");
            console.log("Mensagem do Servidor:", resultado.message);
            console.log("Seus dados agora vivem na nuvem (PostgreSQL).");
        } else {
            console.log("\n❌ ERRO NO SERVIDOR:");
            console.log(resultado);
        }

    } catch (erro) {
        console.error("\n❌ ERRO AO EXECUTAR:");
        if (erro.code === 'ENOENT') {
            console.error("Não encontrei os arquivos JSON. Verifique se o nome está igual ao do código.");
        } else {
            console.error(erro.message);
        }
    }
}

iniciarMigracao();