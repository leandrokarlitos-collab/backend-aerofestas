const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// Haiku 4.5 — escolhido deliberadamente: tarefa de geração de copy de alto volume
// e baixo risco; custo ~10x menor que Opus mantendo qualidade ótima pra esse uso.
const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `Você é o redator oficial da Aero Festas, empresa de aluguel de brinquedos infláveis e atrações para festas em Belo Horizonte, MG.

Sua tarefa: gerar 3 variações de post pro Instagram da Aero Festas com base em uma seleção de brinquedos, ocasião e tom de voz.

VOZ DA MARCA:
- Calorosa e próxima, fala "você" (não "vocês" ou formal)
- Foco na experiência do cliente, não em catálogo seco
- Equilibra emoção (a alegria da festa) com prática (logística, datas, segurança)
- Usa emojis com moderação — 1-3 por post, sempre relevantes
- Curtas e escaneáveis: parágrafos de 1-2 linhas, listas com ✅ ou 📌

PADRÃO DAS 3 VARIAÇÕES:
Sempre gere posts com ângulos DIFERENTES entre si. Não repita estrutura:
1. Uma variação direta (apresentar o produto/combo, CTA claro)
2. Uma variação engajamento (pergunta, prova social, bastidores, lista)
3. Uma variação urgência leve, sazonal ou educativa

Cada post tem:
- "titulo": rótulo curto (max 30 chars) que identifica o ângulo (ex: "Lançamento", "Bastidores", "Urgência junina")
- "legenda": texto pro Instagram (max 600 chars). Use **negrito** com asteriscos duplos para destaque. Use \\n pra quebras de linha. Comece com hook forte na primeira linha.
- "hashtags": string com 5-8 hashtags relevantes. Sempre inclua #AeroFestas. Mescle: marca + nicho + cidade (BH/BeloHorizonte) + ocasião.

REGRAS:
- Sempre adapte ao tom e ocasião pedidos
- Para múltiplos brinquedos, trate como combo/pacote, não como lista solta
- Nunca invente preço, data específica ou desconto que o usuário não mencionou
- Nunca prometa coisas que não constam no briefing (ex: "frete grátis", "parcelamento")
- Para ocasião "junina" use junho como referência; "infantil" foco em 3-10 anos; "corporativo" tom mais sóbrio; "casamento" elegante
- CTA pode ser: "chama no direct", "WhatsApp na bio", "comenta aqui", "salva pra depois"

EXEMPLOS DE LEGENDAS BOAS:
"🦕 **A festa da criançada vai virar AVENTURA!**\\n\\nO Combo Dino chegou pra transformar..." (hook + emoji + negrito)
"Sabe o que rolou no fim de semana? 👀\\n\\n3 festas, 2 confraternizações..." (engajamento via curiosidade)
"⏰ Calendário de junho fechando rápido!\\n\\n..." (urgência sem pressão)

EXEMPLOS RUINS A EVITAR:
- "🎉🎊🎈 OFERTA IMPERDÍVEL!!! 🎉🎊🎈" (excesso de emoji, tom forçado)
- "Nossa empresa Aero Festas é a melhor de BH..." (auto-elogio vazio)
- "Compre já com 50% de desconto" (inventou desconto)
- "Atendemos toda a região metropolitana de Belo Horizonte com excelência..." (genérico, sem alma)

Retorne EXATAMENTE 3 variações, sempre na mesma estrutura JSON.`;

const SCHEMA = {
    type: 'object',
    properties: {
        posts: {
            type: 'array',
            description: 'Exatamente 3 variações de post',
            items: {
                type: 'object',
                properties: {
                    titulo: {
                        type: 'string',
                        description: 'Rótulo curto identificando o ângulo do post (max 30 chars)',
                    },
                    legenda: {
                        type: 'string',
                        description: 'Texto da legenda pro Instagram (max 600 chars)',
                    },
                    hashtags: {
                        type: 'string',
                        description: 'String com 5-8 hashtags relevantes, separadas por espaço',
                    },
                },
                required: ['titulo', 'legenda', 'hashtags'],
                additionalProperties: false,
            },
        },
    },
    required: ['posts'],
    additionalProperties: false,
};

function buildUserPrompt({ brinquedos, ocasiao, tom, detalhes }) {
    const lista = brinquedos.map((b) => `- ${b.nome}${b.emoji ? ` ${b.emoji}` : ''}`).join('\n');
    const partes = [
        `Brinquedo(s) selecionado(s):\n${lista}`,
        `Ocasião: ${ocasiao}`,
        `Tom de voz: ${tom}`,
    ];
    if (detalhes && detalhes.trim()) {
        partes.push(`Detalhes extras do usuário: ${detalhes.trim()}`);
    }
    partes.push('Gere as 3 variações agora.');
    return partes.join('\n\n');
}

async function generateInstagramPosts(input) {
    const { brinquedos, ocasiao, tom, detalhes } = input;

    if (!Array.isArray(brinquedos) || brinquedos.length === 0) {
        const err = new Error('Selecione pelo menos um brinquedo.');
        err.status = 400;
        throw err;
    }
    if (!ocasiao || !tom) {
        const err = new Error('Ocasião e tom de voz são obrigatórios.');
        err.status = 400;
        throw err;
    }

    const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: [
            {
                type: 'text',
                text: SYSTEM_PROMPT,
                cache_control: { type: 'ephemeral' },
            },
        ],
        messages: [
            {
                role: 'user',
                content: buildUserPrompt({ brinquedos, ocasiao, tom, detalhes }),
            },
        ],
        output_config: {
            format: {
                type: 'json_schema',
                schema: SCHEMA,
            },
        },
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
        throw new Error('Resposta da IA sem texto.');
    }

    let parsed;
    try {
        parsed = JSON.parse(textBlock.text);
    } catch (e) {
        throw new Error('Resposta da IA não veio em JSON válido.');
    }

    if (!parsed.posts || !Array.isArray(parsed.posts) || parsed.posts.length === 0) {
        throw new Error('Resposta da IA sem posts.');
    }

    return {
        posts: parsed.posts,
        usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            cache_read_input_tokens: response.usage.cache_read_input_tokens || 0,
            cache_creation_input_tokens: response.usage.cache_creation_input_tokens || 0,
        },
        model: MODEL,
    };
}

module.exports = { generateInstagramPosts };
