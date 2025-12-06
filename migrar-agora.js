const fs = require('fs');

// --- CONFIGURAÇÃO ---
// ⚠️ MUDANÇA IMPORTANTE: Adicionei https:// e garanti que não tenha barra no final
let URL_RAILWAY = "https://backend-aerofestas-production.up.railway.app";

// Pequena segurança: Remove barra do final se você copiar errado sem querer
if (URL_RAILWAY.endsWith('/')) {
    URL_RAILWAY = URL_RAILWAY.slice(0, -1);
}

async function iniciarMigracao() {
    console.log("🚀 Lendo arquivos locais...");

    try {
        // 1. Lendo os arquivos JSON
        // Certifique-se que os arquivos .json estão na MESMA PASTA deste script
        const rawDadosCompletos = fs.readFileSync('./dados-completos-2025-12-05.json', 'utf8');
        const rawDadosFinanceiros = fs.readFileSync('./dados-financeiros-2025-12-05.json', 'utf8');

        const dadosCompletos = JSON.parse(rawDadosCompletos);
        const dadosFinanceiros = JSON.parse(rawDadosFinanceiros);

        // 2. Montando o pacote para envio
        const payload = {
            financeDataV30: dadosFinanceiros.financeDataV30,
            toys: dadosCompletos.toys,
            events: dadosCompletos.events,
            clients: dadosCompletos.clients || []
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

        // Tenta ler como texto primeiro para evitar o crash se vier HTML
        const textoResposta = await response.text();

        try {
            const jsonResposta = JSON.parse(textoResposta);
            
            if (response.ok) {
                console.log("\n✅ SUCESSO ABSOLUTO!");
                console.log("Mensagem do Servidor:", jsonResposta.message);
                console.log("Seus dados agora vivem na nuvem (PostgreSQL).");
            } else {
                console.log("\n❌ ERRO NO SERVIDOR (JSON):");
                console.log(jsonResposta);
            }
        } catch (e) {
            console.log("\n❌ ERRO CRÍTICO (HTML/TEXTO):");
            console.log("O servidor não devolveu um JSON. Provavelmente a rota não existe ou deu erro interno.");
            console.log("Conteúdo recebido:");
            console.log("---------------------------------------------------");
            console.log(textoResposta.substring(0, 500)); // Mostra só o começo para não poluir
            console.log("---------------------------------------------------");
            console.log("DICA: Verifique se você deu 'git push' com as alterações no server.js!");
        }

    } catch (erro) {
        console.error("\n❌ ERRO AO EXECUTAR:");
        if (erro.code === 'ENOENT') {
            console.error("Não encontrei os arquivos JSON. Verifique se o nome está igual ao do código.");
        } else {
            console.error(erro);
        }
    }
}

iniciarMigracao();