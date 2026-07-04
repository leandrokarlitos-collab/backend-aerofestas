const express = require('express');
const { authenticate } = require('../middleware/auth');
const AIService = require('../services/AIService');

const router = express.Router();

router.post('/instagram-posts', authenticate, async (req, res, next) => {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(503).json({
                error: 'IA não configurada. Defina ANTHROPIC_API_KEY no servidor.',
            });
        }

        const result = await AIService.generateInstagramPosts(req.body || {});
        res.json({ success: true, data: result });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ error: err.message });
        }
        if (err.status === 401 || err.name === 'AuthenticationError') {
            return res.status(503).json({ error: 'Chave da IA inválida no servidor.' });
        }
        if (err.status === 429) {
            return res.status(429).json({ error: 'Limite da IA atingido. Tente em alguns minutos.' });
        }
        console.error('[AI] Erro generate-instagram-posts:', err);
        next(err);
    }
});

// ===================== CRM v3: análise de cliente =====================

// Mesmo modelo do AIService (Haiku 4.5): tarefa de resumo/copy de baixo risco,
// custo baixo mantendo boa qualidade.
const ANALYZE_MODEL = 'claude-haiku-4-5';

const ANALYZE_SYSTEM_PROMPT = `Você é o assistente de CRM da Aero Festas, empresa de aluguel de brinquedos infláveis e atrações para festas em Belo Horizonte, MG.

Você recebe os dados de UM cliente (cadastro, estágio no funil, notas internas, follow-ups e histórico de eventos/locações) e produz uma análise em português do Brasil.

Existem dois modos:

MODO "resumo":
- Produza um resumo executivo do cliente em texto corrido curto e escaneável.
- Estruture em: quem é o cliente; histórico e relacionamento (eventos, valores, recorrência); situação atual no funil; pontos de atenção; próxima ação recomendada.
- Seja objetivo (máx ~200 palavras). Nunca invente dados que não estão no material recebido.

MODO "mensagens":
- Gere EXATAMENTE 3 sugestões de mensagem de follow-up prontas para enviar por WhatsApp, numeradas 1, 2 e 3.
- Cada mensagem com ângulo diferente: (1) retomada calorosa/pessoal, (2) valor/oferta ou ocasião próxima, (3) direta e objetiva.
- Tom da marca: caloroso, próximo, fala "você", 0-2 emojis por mensagem, curtas (2-4 linhas cada).
- Use os dados reais do cliente (nome, último evento, brinquedos alugados) quando disponíveis. Nunca invente preço, data ou desconto.

Responda somente com o texto solicitado, sem preâmbulos.`;

// Cliente Anthropic criado sob demanda (depois da checagem de ANTHROPIC_API_KEY)
let anthropicClient = null;
function getAnthropicClient() {
    if (!anthropicClient) {
        const Anthropic = require('@anthropic-ai/sdk');
        anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return anthropicClient;
}

router.post('/analyze-client', authenticate, async (req, res, next) => {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            return res.status(503).json({
                error: 'IA não configurada. Defina ANTHROPIC_API_KEY no servidor.',
            });
        }

        const { client: clientData, mode } = req.body || {};
        if (!clientData || typeof clientData !== 'object') {
            return res.status(400).json({ error: 'Campo "client" é obrigatório.' });
        }
        if (mode !== 'resumo' && mode !== 'mensagens') {
            return res.status(400).json({ error: 'Campo "mode" deve ser "resumo" ou "mensagens".' });
        }

        // Limita o payload para proteger contexto/custo
        let clientJson = JSON.stringify(clientData, null, 2);
        if (clientJson.length > 20000) {
            clientJson = clientJson.slice(0, 20000) + '\n... (dados truncados)';
        }

        const userPrompt = [
            `Modo: ${mode}`,
            `Dados do cliente:\n${clientJson}`,
            mode === 'resumo'
                ? 'Gere o resumo executivo agora.'
                : 'Gere as 3 sugestões de mensagem de follow-up agora.',
        ].join('\n\n');

        const anthropic = getAnthropicClient();
        const response = await anthropic.messages.create({
            model: ANALYZE_MODEL,
            max_tokens: 1500,
            system: [
                {
                    type: 'text',
                    text: ANALYZE_SYSTEM_PROMPT,
                    cache_control: { type: 'ephemeral' },
                },
            ],
            messages: [
                {
                    role: 'user',
                    content: userPrompt,
                },
            ],
        });

        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock || !textBlock.text) {
            return res.status(502).json({ error: 'Resposta da IA sem texto.' });
        }

        res.json({ success: true, text: textBlock.text });
    } catch (err) {
        if (err.status === 400) {
            return res.status(400).json({ error: err.message });
        }
        if (err.status === 401 || err.name === 'AuthenticationError') {
            return res.status(503).json({ error: 'Chave da IA inválida no servidor.' });
        }
        if (err.status === 429) {
            return res.status(429).json({ error: 'Limite da IA atingido. Tente em alguns minutos.' });
        }
        console.error('[AI] Erro analyze-client:', err);
        next(err);
    }
});

module.exports = router;
