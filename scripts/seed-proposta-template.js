/**
 * Cria o template padrão de propostas se não existir nenhum com isDefault=true.
 * Idempotente — pode ser rodado quantas vezes quiser sem efeitos colaterais.
 *
 * Uso: node scripts/seed-proposta-template.js
 */
require('dotenv').config();
const PropostaTemplateService = require('../services/PropostaTemplateService');

(async () => {
    try {
        const template = await PropostaTemplateService.ensureDefaultTemplate();
        console.log('Template padrão pronto:');
        console.log('  id:', template.id);
        console.log('  nome:', template.nome);
        console.log('  isDefault:', template.isDefault);
        process.exit(0);
    } catch (err) {
        console.error('Erro ao criar template padrão:', err);
        process.exit(1);
    }
})();
