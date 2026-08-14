/**
 * PncpService — monitoramento diário de licitações abertas no PNCP.
 *
 * O QUE FAZ
 * Varre, uma vez por dia, os municípios do Tier A/B da prospecção na API oficial
 * do PNCP (Portal Nacional de Contratações Públicas), guarda os editais que
 * casam com o nosso ramo e dispara push quando aparece coisa nova.
 *
 * POR QUE EXISTE
 * Antes, os editais eram um snapshot congelado dentro do arquivo de dados do
 * frontend: edital vencido continuava aparecendo como aberto e nada novo entrava
 * sozinho. Agora "aberto agora" é DERIVADO de dataEncerramentoProposta — nenhum
 * booleano precisa ser corrigido para um edital vencido sumir da tela.
 *
 * CONTRATO DA API (verificado ao vivo em 14/08/2026, não copiado da doc)
 *   GET https://pncp.gov.br/api/consulta/v1/contratacoes/proposta
 *   - dataFinal (AAAAMMDD) OBRIGATÓRIO. Filtra por dataEncerramentoProposta:
 *     devolve o que está com proposta aberta e encerra ATÉ essa data.
 *     dataFinal=hoje trouxe 4 registros em GO; dataFinal=+1 ano trouxe 471.
 *   - pagina OBRIGATÓRIO; tamanhoPagina MÁXIMO 50 (500 responde 400
 *     "Tamanho de página inválido").
 *   - codigoModalidadeContratacao é OPCIONAL neste endpoint (sem ele vêm todas
 *     as modalidades) — é o que permite 1 requisição por município em vez de 6.
 *   - codigoMunicipioIbge funciona e é o filtro que usamos.
 *   - Resposta: { data: [...], totalRegistros, totalPaginas, numeroPagina }.
 *
 * ARMADILHAS JÁ PAGAS
 * 1. O PNCP responde 504 por longos períodos (o gateway estoura em ~70 s) e
 *    responde 429 com folga: 200 ms entre requisições derrubou 27 de 90
 *    municípios num teste real. Daí a pausa de 1,5 s, o backoff e o
 *    autoajuste de ritmo.
 * 2. "parque" e "lazer" sozinhos são ruído: no teste contra dados reais
 *    trouxeram pavimentação, rodeio e show de artista. Viraram termos FRACOS —
 *    entram na tela, mas não acordam ninguém com push.
 * 3. O filtro por município traz também órgão estadual e federal sediado ali
 *    (174 de 824 itens no teste). Só gravamos esfera "M" (municipal).
 *
 * LIMITE CONHECIDO — NÃO É BUG
 * O PNCP não cobre dispensa de baixo valor, que é justamente como Araguaína,
 * Gurupi e Jacobina compram. Ausência de edital aqui NÃO significa que a
 * prefeitura não esteja comprando: significa que ela não publica no PNCP.
 * Essas praças continuam sendo trabalho de relacionamento, não de robô.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');
const webpush = require('../config/webpush');

const HOST = 'https://pncp.gov.br';
const CAMINHO = '/api/consulta/v1/contratacoes/proposta';
const TAMANHO_PAGINA = 50;     // teto da API
const MAX_PAGINAS = 10;        // 500 editais abertos num único município já é anomalia
const JANELA_DIAS = 365;       // dataFinal = hoje + 1 ano (superset barato: 471 vs 461 registros em GO)

// Consulta de um município responde em menos de 1 s quando o PNCP está de pé
// (medido); o 504 dele leva ~70 s. 20 s é folga larga para o caso bom e corte
// rápido para o ruim.
const TIMEOUT_MS = 20000;
const TENTATIVAS = 3;
// Depois de 2 municípios seguidos falhando, o problema não é o município — é o
// PNCP. Uma tentativa por município a partir daí derruba a detecção de queda de
// ~10 min para ~3 min, que é o que o gestor aguenta olhando a barra de progresso.
const FALHAS_ATE_MODO_RAPIDO = 2;
const PAUSA_BASE_MS = 1500;    // 200 ms provocou 429 em 30% dos municípios
const PAUSA_TETO_MS = 5000;
const FALHAS_SEGUIDAS_ABORTA = 5;

const TETO_CRON_MS = 20 * 60 * 1000;
const TETO_MANUAL_MS = 12 * 60 * 1000;

const CAMINHO_SNAPSHOT = path.join(__dirname, '..', 'js', 'data', 'prospeccao-municipios.js');

const dormir = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Alvos: municípios Tier A/B lidos do MESMO snapshot que a tela usa
// ---------------------------------------------------------------------------
// Ler o snapshot em vez de manter uma lista paralela evita dessincronizar: quando
// o pipeline recalcular os tiers e o arquivo for deployado, a varredura passa a
// seguir o novo Tier A/B sozinha, sem editar código de backend.

let cacheAlvos = null; // { mtimeMs, lista }

function carregarAlvos() {
    try {
        const stat = fs.statSync(CAMINHO_SNAPSHOT);
        if (cacheAlvos && cacheAlvos.mtimeMs === stat.mtimeMs) return cacheAlvos.lista;

        const txt = fs.readFileSync(CAMINHO_SNAPSHOT, 'utf8');
        const i = txt.indexOf('window.PROSPECCAO_MUNICIPIOS');
        if (i === -1) throw new Error('marcador window.PROSPECCAO_MUNICIPIOS não encontrado');
        const j = txt.indexOf('=', i);
        const json = txt.slice(j + 1).trim().replace(/;\s*$/, '');
        const payload = JSON.parse(json);

        const lista = (payload.municipios || [])
            .filter(m => m.tier === 'A' || m.tier === 'B')
            .map(m => ({ cod: String(m.cod), nome: m.nome, uf: m.uf, tier: m.tier }))
            // Tier A primeiro: se o teto de tempo cortar a varredura no meio,
            // o que sobrou de fora é a parte menos valiosa.
            .sort((a, b) => (a.tier === b.tier ? a.nome.localeCompare(b.nome) : a.tier === 'A' ? -1 : 1));

        cacheAlvos = { mtimeMs: stat.mtimeMs, lista };
        return lista;
    } catch (err) {
        console.error('[pncp] não consegui ler os alvos do snapshot:', err.message);
        return cacheAlvos ? cacheAlvos.lista : [];
    }
}

// ---------------------------------------------------------------------------
// Filtro de palavras-chave
// ---------------------------------------------------------------------------

const semAcento = s => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ');

// FORTES: termo inequívoco do nosso ramo. Gera push.
const TERMOS_FORTES = [
    ['inflável', /INFLAVE(L|IS)/],
    ['pula-pula', /PULA[ -]?PULA/],
    ['brinquedo', /BRINQUED/],                       // brinquedo, brinquedos, brinquedão
    ['recreação', /RECREA(CAO|TIV)/],                // recreação, recreativo, equipamentos recreativos
    ['dia das crianças', /DIA DAS CRIANCAS/],
    ['parque de diversões', /PARQUE (DE )?(DIVERS|AQUATIC|INFANTIL)/],
    ['parquinho', /PARQUINHO/],
    ['playground', /PLAYGROUND/],
    ['cama elástica', /CAMA ELASTICA/],
    ['tobogã', /TOBOGA/],
    ['piscina de bolinhas', /PISCINA DE BOLINH/],
    ['touro mecânico', /TOURO MECANICO/],
    ['escorregador', /ESCORREGADOR/],
    ['trenzinho/carreta', /TRENZINHO|CARRETA DA ALEGRIA/]
];

// FRACOS: pedidos pelo dono ("parque"), mas ambíguos na prática. Aparecem na
// tela marcados como achado fraco e NÃO disparam push — ver armadilha 2 acima.
const TERMOS_FRACOS = [
    ['parque', /PARQUE/],
    ['lazer', /LAZER/],
    ['animação', /ANIMA(CAO|DOR)/],
    ['evento infantil', /(EVENTO|FESTA)S? INFANT/],
    ['semana da criança', /SEMANA DA CRIANCA/],
    ['estrutura para eventos', /ESTRUTURA(S)? PARA (EVENTO|FESTA)/]
];

// --- Termos vindos do banco (editáveis pela tela) ---------------------------
// As listas acima são só a SEMENTE. A verdade em runtime é a tabela
// LicitacaoTermo, para o gestor conseguir acrescentar "colchão inflável" ou
// desligar "parque" sem esperar deploy.

const CACHE_TERMOS_MS = 5 * 60 * 1000;
let cacheTermos = null; // { em, lista: [{ nome, re, forca }] }

/**
 * Monta regex a partir do texto digitado pelo gestor. NÃO é a regex dele:
 * escapamos tudo e só afrouxamos acento (já removido) e separador, para
 * "pula pula" casar com "PULA-PULA" e "PULAPULA". Aceitar expressão regular
 * escrita à mão em produção convidaria erro de sintaxe e ReDoS.
 */
function regexDoTexto(termo) {
    const escapado = semAcento(termo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escapado.replace(/[\s-]+/g, '[ -]?'));
}

function compilar(linhas) {
    const lista = [];
    for (const t of linhas) {
        try {
            lista.push({
                nome: t.termo,
                forca: t.forca === 'fraco' ? 'fraco' : 'forte',
                re: t.padrao ? new RegExp(t.padrao) : regexDoTexto(t.termo)
            });
        } catch (err) {
            // Padrão inválido no banco não pode derrubar a varredura inteira
            console.warn(`[pncp] termo "${t.termo}" ignorado (padrão inválido):`, err.message);
        }
    }
    return lista;
}

/** Lista embutida, usada como semente e como rede de segurança. */
function termosDeFabrica() {
    return [
        ...TERMOS_FORTES.map(([termo, re]) => ({ termo, padrao: re.source, forca: 'forte', deFabrica: true })),
        ...TERMOS_FRACOS.map(([termo, re]) => ({ termo, padrao: re.source, forca: 'fraco', deFabrica: true }))
    ];
}

/**
 * Garante que os termos de fábrica existam no banco. Idempotente: roda a cada
 * subida do servidor e só cria o que falta — nunca reativa nem reclassifica o
 * que o gestor desligou ou mudou de força.
 */
async function semearTermos() {
    try {
        for (const t of termosDeFabrica()) {
            await prisma.licitacaoTermo.upsert({
                where: { termo: t.termo },
                create: t,
                update: {} // decisão do gestor sobre um termo existente é soberana
            });
        }
        cacheTermos = null;
    } catch (err) {
        console.error('[pncp] semearTermos falhou:', err.message);
    }
}

/** Termos ativos, com cache curto. Cai para os de fábrica se o banco falhar. */
async function carregarTermos(forcar = false) {
    if (!forcar && cacheTermos && Date.now() - cacheTermos.em < CACHE_TERMOS_MS) return cacheTermos.lista;
    try {
        const linhas = await prisma.licitacaoTermo.findMany({ where: { ativo: true } });
        // Tabela vazia (migration aplicada e semente ainda não rodou) não pode
        // virar "nenhum edital interessa" — isso pareceria silêncio do PNCP.
        const lista = compilar(linhas.length ? linhas : termosDeFabrica());
        cacheTermos = { em: Date.now(), lista };
        return lista;
    } catch (err) {
        console.error('[pncp] carregarTermos falhou, usando termos de fábrica:', err.message);
        return compilar(termosDeFabrica());
    }
}

function invalidarCacheTermos() { cacheTermos = null; }

/**
 * Devolve { forca: 'forte'|'fraco', termos: [...] } ou null se não interessa.
 * `termos` é a lista já compilada; sem ela, usa a de fábrica (caminho de teste).
 */
function classificar(item, termos = null) {
    const lista = termos || compilar(termosDeFabrica());
    const texto = semAcento(`${item.objetoCompra || ''} ${item.informacaoComplementar || ''}`);
    const casaram = lista.filter(t => t.re.test(texto));
    if (!casaram.length) return null;
    const fortes = casaram.filter(t => t.forca === 'forte');
    return fortes.length
        ? { forca: 'forte', termos: fortes.map(t => t.nome) }
        : { forca: 'fraco', termos: casaram.map(t => t.nome) };
}

// ---------------------------------------------------------------------------
// Cliente HTTP tolerante ao PNCP
// ---------------------------------------------------------------------------

function dataFinalConsulta() {
    const d = new Date(Date.now() + JANELA_DIAS * 86400000);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Uma página de um município. Nunca lança: devolve
 * { ok: true, itens, totalPaginas } | { ok: false, motivo, ritmoExtraMs }.
 */
async function buscarPagina(cod, pagina, dataFinal, tentativasMax = TENTATIVAS) {
    const url = `${HOST}${CAMINHO}?dataFinal=${dataFinal}&codigoMunicipioIbge=${cod}`
        + `&pagina=${pagina}&tamanhoPagina=${TAMANHO_PAGINA}`;
    let ritmoExtraMs = 0;
    let ultimoMotivo = 'sem resposta';

    for (let tentativa = 1; tentativa <= tentativasMax; tentativa++) {
        try {
            const res = await fetch(url, {
                headers: { Accept: 'application/json', 'User-Agent': 'AeroFestas-Prospeccao/1.0' },
                signal: AbortSignal.timeout(TIMEOUT_MS)
            });

            // 204 = sem contratação aberta nesse município. É sucesso, não falha.
            if (res.status === 204) return { ok: true, itens: [], totalPaginas: 0, ritmoExtraMs };

            if (res.status === 200) {
                const json = await res.json();
                return {
                    ok: true,
                    itens: Array.isArray(json.data) ? json.data : [],
                    totalPaginas: Number(json.totalPaginas) || 1,
                    ritmoExtraMs
                };
            }

            if (res.status === 429) {
                // O PNCP estrangula sem dó. Respeita o Retry-After quando vem e
                // aumenta o ritmo do resto da varredura — autoajuste barato.
                const retryAfter = Number(res.headers.get('retry-after'));
                const espera = Number.isFinite(retryAfter) && retryAfter > 0
                    ? Math.min(retryAfter * 1000, 60000)
                    : [8000, 20000, 45000][tentativa - 1];
                ritmoExtraMs = 500;
                ultimoMotivo = 'HTTP 429 (limite de requisições)';
                if (tentativa < tentativasMax) { await dormir(espera); continue; }
                return { ok: false, motivo: ultimoMotivo, ritmoExtraMs };
            }

            // 400 é erro nosso de parâmetro — repetir não adianta.
            if (res.status === 400) {
                const corpo = await res.text().catch(() => '');
                return { ok: false, motivo: `HTTP 400 ${corpo.slice(0, 160)}`, ritmoExtraMs };
            }

            ultimoMotivo = `HTTP ${res.status}`; // 502/503/504: o PNCP caindo de novo
        } catch (err) {
            ultimoMotivo = err.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS / 1000}s` : (err.message || 'erro de rede');
        }
        if (tentativa < tentativasMax) await dormir(2000 * tentativa);
    }
    return { ok: false, motivo: ultimoMotivo, ritmoExtraMs };
}

/**
 * Todas as contratações abertas de um município (paginando).
 * { ok: true, itens } | { ok: false, motivo } — ok:false só quando NENHUMA
 * página veio; página parcial ainda é ok, mas marcamos completo:false para não
 * concluir que um edital "sumiu" com base numa leitura incompleta.
 */
async function buscarMunicipio(cod, dataFinal, tentativasMax = TENTATIVAS) {
    const itens = [];
    let pagina = 1, totalPaginas = 1, consultas = 0, ritmoExtraMs = 0, completo = true, motivo = null;

    do {
        const r = await buscarPagina(cod, pagina, dataFinal, tentativasMax);
        consultas++;
        ritmoExtraMs = Math.max(ritmoExtraMs, r.ritmoExtraMs || 0);
        if (!r.ok) {
            motivo = r.motivo;
            completo = false;
            if (pagina === 1) return { ok: false, motivo, consultas, ritmoExtraMs };
            break; // já temos algo: devolve parcial
        }
        itens.push(...r.itens);
        totalPaginas = r.totalPaginas;
        pagina++;
        if (pagina <= totalPaginas && pagina <= MAX_PAGINAS) await dormir(300);
    } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);

    if (totalPaginas > MAX_PAGINAS) completo = false; // truncamos de propósito
    return { ok: true, itens, completo, motivo, consultas, ritmoExtraMs };
}

// ---------------------------------------------------------------------------
// Normalização de um item do PNCP para a nossa tabela
// ---------------------------------------------------------------------------

const data = v => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
};

function paraRegistro(item, alvo, classe) {
    const cnpj = item.orgaoEntidade && item.orgaoEntidade.cnpj;
    // linkSistemaOrigem vem vazio na maioria dos registros; a página pública do
    // PNCP é montável a partir de cnpj/ano/sequencial e sempre funciona.
    const linkPncp = (cnpj && item.anoCompra && item.sequencialCompra)
        ? `${HOST}/app/editais/${cnpj}/${item.anoCompra}/${item.sequencialCompra}`
        : null;

    return {
        numeroControlePNCP: String(item.numeroControlePNCP),
        codMunicipio: alvo.cod,
        municipioNome: (item.unidadeOrgao && item.unidadeOrgao.municipioNome) || alvo.nome,
        uf: (item.unidadeOrgao && item.unidadeOrgao.ufSigla) || alvo.uf,
        orgaoCnpj: cnpj || null,
        orgaoNome: (item.orgaoEntidade && item.orgaoEntidade.razaoSocial) || null,
        unidadeNome: (item.unidadeOrgao && item.unidadeOrgao.nomeUnidade) || null,
        esfera: (item.orgaoEntidade && item.orgaoEntidade.esferaId) || null,
        modalidadeId: Number.isFinite(item.modalidadeId) ? item.modalidadeId : null,
        modalidadeNome: item.modalidadeNome || null,
        objeto: String(item.objetoCompra || '').slice(0, 8000),
        informacao: item.informacaoComplementar ? String(item.informacaoComplementar).slice(0, 4000) : null,
        valorEstimado: Number.isFinite(item.valorTotalEstimado) ? item.valorTotalEstimado : null,
        situacaoNome: item.situacaoCompraNome || null,
        srp: item.srp === true,
        dataPublicacao: data(item.dataPublicacaoPncp),
        dataAberturaProposta: data(item.dataAberturaProposta),
        dataEncerramentoProposta: data(item.dataEncerramentoProposta),
        anoCompra: Number.isFinite(item.anoCompra) ? item.anoCompra : null,
        sequencialCompra: Number.isFinite(item.sequencialCompra) ? item.sequencialCompra : null,
        numeroCompra: item.numeroCompra ? String(item.numeroCompra).slice(0, 120) : null,
        processo: item.processo ? String(item.processo).slice(0, 120) : null,
        linkSistemaOrigem: item.linkSistemaOrigem || null,
        linkPncp,
        termos: JSON.stringify(classe.termos),
        forca: classe.forca
    };
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/** Best-effort: nunca lança, nunca deixa a varredura falhar por causa de push. */
async function notificar(novosFortes) {
    if (!novosFortes.length) return 0;
    try {
        const inscricoes = await prisma.pushSubscription.findMany();
        if (!inscricoes.length) return 0;

        const n = novosFortes.length;
        const linhas = novosFortes.slice(0, 3).map(e => {
            const prazo = e.dataEncerramentoProposta
                ? ` (até ${new Date(e.dataEncerramentoProposta).toLocaleDateString('pt-BR')})`
                : '';
            return `${e.municipioNome}/${e.uf}${prazo}`;
        });
        if (n > 3) linhas.push(`e mais ${n - 3}`);

        const payload = JSON.stringify({
            title: n === 1 ? '⚡ Licitação aberta encontrada' : `⚡ ${n} licitações abertas encontradas`,
            body: linhas.join(' · '),
            url: '/Prospeccao-Prefeituras.html'
        });

        for (const sub of inscricoes) {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload
                );
            } catch (err) {
                // 410/404 inscrição morta; 403 chave VAPID antiga (rotação)
                if ([410, 404, 403].includes(err.statusCode)) {
                    try { await prisma.pushSubscription.delete({ where: { id: sub.id } }); } catch (e) { /* já foi */ }
                } else {
                    console.warn('[pncp] push falhou:', err.message);
                }
            }
        }

        await prisma.licitacaoPncp.updateMany({
            where: { id: { in: novosFortes.map(e => e.id) } },
            data: { notificadoEm: new Date() }
        });
        return n;
    } catch (err) {
        console.error('[pncp] notificar falhou:', err.message);
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

let emAndamento = null; // id da varredura rodando neste processo (trava simples)

/**
 * Cria o registro da varredura e dispara a execução EM SEGUNDO PLANO.
 * Devolve { run, promessa, jaRodando } assim que a linha existe — é isso que
 * permite a tela receber o id na hora e acompanhar a barra de progresso, em vez
 * de segurar a requisição HTTP pelos minutos que a varredura leva.
 */
async function iniciarVarredura({ origem = 'cron', iniciadoPor = null, alvos: alvosArg = null } = {}) {
    // Trava simples de processo único: duas varreduras concorrentes só serviriam
    // para dobrar as chances de tomar 429 do PNCP.
    if (emAndamento) {
        console.warn('[pncp] varredura já em andamento — ignorando pedido de', origem);
        return { run: null, promessa: Promise.resolve(null), jaRodando: true };
    }

    // alvosArg permite varrer um recorte ([{cod, nome, uf, tier}]) em vez do Tier
    // A/B inteiro — usado nos testes e disponível para uma varredura pontual.
    const alvos = alvosArg && alvosArg.length ? alvosArg : carregarAlvos();
    const teto = origem === 'manual' ? TETO_MANUAL_MS : TETO_CRON_MS;
    const t0 = Date.now();

    const run = await prisma.licitacaoVarredura.create({
        data: { origem, status: 'executando', municipiosAlvo: alvos.length, iniciadoPor }
    });
    emAndamento = run.id;

    return { run, promessa: executar(run, alvos, teto, t0), jaRodando: false };
}

/**
 * Roda a varredura completa e ESPERA terminar (uso do cron).
 * NUNCA lança — o cron não pode derrubar o processo por instabilidade do PNCP.
 */
async function varrer(opts = {}) {
    try {
        const { promessa } = await iniciarVarredura(opts);
        return await promessa;
    } catch (err) {
        console.error('[pncp] não consegui iniciar a varredura:', err.message);
        return null;
    }
}

/** Corpo da varredura. Nunca lança: sempre fecha o registro com um status. */
async function executar(run, alvos, teto, t0) {
    const acc = {
        municipiosOk: 0, municipiosFalha: 0, consultas: 0, itensLidos: 0,
        novos: 0, atualizados: 0, sumidos: 0
    };
    const novosFortes = [];
    let falhasSeguidas = 0, abortou = null, pausaMs = PAUSA_BASE_MS;
    const dataFinal = dataFinalConsulta();

    try {
        if (!alvos.length) throw new Error('nenhum município Tier A/B encontrado no snapshot da prospecção');

        // Uma leitura por varredura: os termos podem ter sido editados na tela
        // desde a varredura de ontem, mas não mudam no meio de uma.
        const termos = await carregarTermos(true);
        console.log(`[pncp] varrendo ${alvos.length} municípios com ${termos.length} termo(s) ativo(s)`);

        for (let i = 0; i < alvos.length; i++) {
            const alvo = alvos[i];

            if (Date.now() - t0 > teto) {
                abortou = `teto de tempo de ${Math.round(teto / 60000)} min atingido em ${i}/${alvos.length} municípios`;
                break;
            }
            if (falhasSeguidas >= FALHAS_SEGUIDAS_ABORTA) {
                abortou = `${falhasSeguidas} municípios seguidos falharam — PNCP provavelmente fora do ar`;
                break;
            }

            // Progresso para a barra da tela (gravado antes de consultar: se o
            // PNCP travar 30 s, a tela mostra em quem estamos travados)
            await prisma.licitacaoVarredura.update({
                where: { id: run.id },
                data: { municipioAtual: `${alvo.nome}/${alvo.uf}`, ...acc }
            }).catch(() => { });

            // Modo rápido: PNCP já se mostrou fora do ar, não insiste 3x por município
            const r = await buscarMunicipio(alvo.cod, dataFinal,
                falhasSeguidas >= FALHAS_ATE_MODO_RAPIDO ? 1 : TENTATIVAS);
            acc.consultas += r.consultas || 0;
            pausaMs = Math.min(PAUSA_TETO_MS, pausaMs + (r.ritmoExtraMs || 0));

            if (!r.ok) {
                acc.municipiosFalha++;
                falhasSeguidas++;
                console.warn(`[pncp] ${alvo.nome}/${alvo.uf}: ${r.motivo}`);
                await dormir(pausaMs);
                continue;
            }
            falhasSeguidas = 0;
            acc.municipiosOk++;
            acc.itensLidos += r.itens.length;

            const vistos = [];
            for (const item of r.itens) {
                // Só compra da PREFEITURA: o filtro por município traz também
                // órgão estadual e federal sediado ali.
                const esfera = item.orgaoEntidade && item.orgaoEntidade.esferaId;
                if (esfera !== 'M') continue;
                if (!item.numeroControlePNCP) continue;

                // `vistos` acumula TODO edital municipal ainda publicado, não só os
                // que casaram com as palavras-chave: a reconciliação abaixo pergunta
                // "ainda está no PNCP?", e não "ainda casa com o filtro?". Sem isso,
                // apertar a lista de termos marcaria editais vivos como sumidos.
                vistos.push(String(item.numeroControlePNCP));

                const classe = classificar(item, termos);
                if (!classe) continue;

                const registro = paraRegistro(item, alvo, classe);

                const antes = await prisma.licitacaoPncp.findUnique({
                    where: { numeroControlePNCP: registro.numeroControlePNCP },
                    select: { id: true, notificadoEm: true }
                });

                const salvo = await prisma.licitacaoPncp.upsert({
                    where: { numeroControlePNCP: registro.numeroControlePNCP },
                    create: { ...registro, vistoEm: new Date() },
                    // descartado/descartadoPor NÃO entram no update: a marcação de
                    // falso positivo feita pelo gestor sobrevive à varredura seguinte.
                    update: { ...registro, vistoEm: new Date(), sumiuEm: null }
                });

                if (!antes) {
                    acc.novos++;
                    if (salvo.forca === 'forte') novosFortes.push(salvo);
                } else {
                    acc.atualizados++;
                    // Reapareceu depois de já ter sido notificado? Não notifica de novo.
                }
            }

            // Reconciliação: só é seguro concluir que um edital SUMIU do PNCP
            // quando lemos o município inteiro (todas as páginas, sem falha).
            if (r.completo) {
                const sumidos = await prisma.licitacaoPncp.updateMany({
                    where: {
                        codMunicipio: alvo.cod,
                        sumiuEm: null,
                        numeroControlePNCP: { notIn: vistos.length ? vistos : ['__nenhum__'] },
                        OR: [
                            { dataEncerramentoProposta: { gt: new Date() } },
                            { dataEncerramentoProposta: null }
                        ]
                    },
                    data: { sumiuEm: new Date() }
                });
                acc.sumidos += sumidos.count;
            }

            await dormir(pausaMs);
        }

        acc.notificados = await notificar(novosFortes);

        // "sucesso" exige a varredura INTEIRA: qualquer município perdido vira
        // "parcial", para a tela nunca exibir uma data de sucesso que mentiu.
        const status = acc.municipiosOk === 0 ? 'falha'
            : (acc.municipiosFalha > 0 || abortou) ? 'parcial'
                : 'sucesso';

        return await prisma.licitacaoVarredura.update({
            where: { id: run.id },
            data: {
                ...acc, status, municipioAtual: null,
                erro: abortou || (acc.municipiosFalha ? `${acc.municipiosFalha} município(s) sem resposta do PNCP` : null),
                concluidoEm: new Date(), duracaoMs: Date.now() - t0
            }
        });
    } catch (err) {
        console.error('[pncp] varredura falhou:', err);
        return await prisma.licitacaoVarredura.update({
            where: { id: run.id },
            data: {
                ...acc, status: 'falha', municipioAtual: null,
                erro: String(err.message || err).slice(0, 500),
                concluidoEm: new Date(), duracaoMs: Date.now() - t0
            }
        }).catch(() => null);
    } finally {
        emAndamento = null;
    }
}

/** Marca como falha varreduras que ficaram penduradas (restart do Railway no meio). */
async function limparPenduradas() {
    try {
        const limite = new Date(Date.now() - 60 * 60 * 1000);
        const r = await prisma.licitacaoVarredura.updateMany({
            where: { status: 'executando', iniciadoEm: { lt: limite } },
            data: { status: 'falha', erro: 'varredura interrompida (reinício do servidor)', concluidoEm: new Date() }
        });
        if (r.count) console.log(`[pncp] ${r.count} varredura(s) pendurada(s) marcada(s) como falha`);
    } catch (err) {
        console.error('[pncp] limparPenduradas falhou:', err.message);
    }
}

function estaRodando() { return emAndamento; }

module.exports = {
    varrer,             // cron: espera terminar
    semearTermos,
    carregarTermos,
    invalidarCacheTermos,
    regexDoTexto,
    iniciarVarredura,   // rota manual: devolve o id na hora e roda em segundo plano
    limparPenduradas,
    estaRodando,
    carregarAlvos,
    classificar,        // exportado para teste
    TETO_MANUAL_MS
};
