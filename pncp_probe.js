const https = require('https');

function get(url, tries = 6) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        let s = '';
        res.setEncoding('utf8');
        res.on('data', (d) => s += d);
        res.on('end', () => {
          try { resolve(JSON.parse(s)); }
          catch (e) { n > 1 ? setTimeout(() => attempt(n - 1), 1500) : resolve(null); }
        });
      });
      req.on('error', () => { n > 1 ? setTimeout(() => attempt(n - 1), 1500) : resolve(null); });
      req.setTimeout(45000, () => { req.destroy(); });
    };
    attempt(tries);
  });
}

const RE = /brinqued|inflav|inflá|recrea|lazer|divers|anima[çc]|crian[çc]|festa|evento|pula.?pula|tobog|cama el|piscina de bol|touro/i;

(async () => {
  const args = process.argv.slice(2);
  const mode = args[0]; // 'q' or 'muni'
  if (mode === 'q') {
    const [, q, tipo, status, pages] = args;
    for (let p = 1; p <= Number(pages || 1); p++) {
      const url = `https://pncp.gov.br/api/search/?q=${encodeURIComponent(q)}&tipos_documento=${tipo}&ordenacao=-data&pagina=${p}&tam_pagina=100&ufs=GO&status=${status}`;
      const d = await get(url);
      if (!d) { console.log(`page ${p}: FAILED`); continue; }
      const items = d.items || [];
      console.log(`--- page ${p} total=${d.total} items=${items.length}`);
      items.forEach((i) => {
        if (RE.test(i.description || '')) {
          console.log(`  HIT | ${i.municipio_nome} | ${i.orgao_nome} | ${i.unidade_nome} | ${i.modalidade_licitacao_nome} | ${(i.data_publicacao_pncp || '').slice(0, 10)} | assin:${i.data_assinatura || ''} | fim:${i.data_fim_vigencia || ''} | R$${i.valor_global != null ? i.valor_global : (i.valor_total_estimado != null ? i.valor_total_estimado : '?')} | ${i.item_url} | ${(i.description || '').slice(0, 180).replace(/\s+/g, ' ')}`);
        }
      });
      if (items.length < 100) break;
    }
  } else if (mode === 'muni') {
    const [, muniId, tipo, status, pages] = args;
    for (let p = 1; p <= Number(pages || 1); p++) {
      const url = `https://pncp.gov.br/api/search/?q=&tipos_documento=${tipo}&ordenacao=-data&pagina=${p}&tam_pagina=100&municipios=${muniId}&status=${status}`;
      const d = await get(url);
      if (!d) { console.log(`page ${p}: FAILED`); continue; }
      const items = d.items || [];
      console.log(`--- page ${p} total=${d.total} items=${items.length}`);
      items.forEach((i) => {
        if (RE.test(i.description || '')) {
          console.log(`  HIT | ${i.municipio_nome} | ${i.orgao_nome} | ${i.unidade_nome} | ${i.modalidade_licitacao_nome} | ${(i.data_publicacao_pncp || '').slice(0, 10)} | ${i.item_url} | ${(i.description || '').slice(0, 180).replace(/\s+/g, ' ')}`);
        }
      });
      if (items.length < 100) break;
    }
  } else if (mode === 'open') {
    const muniId = args[1];
    for (let p = 1; p <= 3; p++) {
      const d = await get(`https://pncp.gov.br/api/search/?q=&tipos_documento=edital&ordenacao=-data&pagina=${p}&tam_pagina=100&municipios=${muniId}&status=recebendo_proposta`);
      if (!d) { console.log(`page ${p}: FAILED`); continue; }
      const items = d.items || [];
      console.log(`--- p${p} total=${d.total} n=${items.length}`);
      items.forEach((i) => console.log(`  ${(i.data_publicacao_pncp || '').slice(0, 10)} | fim:${(i.data_fim_vigencia || '').slice(0, 16)} | ${i.modalidade_licitacao_nome} | ${i.unidade_nome} | ${i.item_url} | ${(i.description || '').slice(0, 150).replace(/\s+/g, ' ')}`));
      if (items.length < 100) break;
    }
  } else if (mode === 'muniid') {
    const d = await get(`https://pncp.gov.br/api/search/?q=${encodeURIComponent(args[1])}&tipos_documento=edital&ordenacao=-data&pagina=1&tam_pagina=5&ufs=GO&status=todos`);
    (d && d.items || []).forEach((i) => console.log(i.municipio_nome, '=>', i.municipio_id, '|', i.orgao_nome, i.orgao_cnpj));
  } else if (mode === 'scan') {
    // scan a municipality's full doc list for keyword hits
    const [, muniId, tipo, status, pages] = args;
    for (let p = 1; p <= Number(pages || 1); p++) {
      const d = await get(`https://pncp.gov.br/api/search/?q=&tipos_documento=${tipo}&ordenacao=-data&pagina=${p}&tam_pagina=100&municipios=${muniId}&status=${status}`);
      if (!d) { console.log(`page ${p}: FAILED`); continue; }
      const items = d.items || [];
      const dates = items.map((i) => (i.data_publicacao_pncp || '').slice(0, 10)).filter(Boolean);
      console.log(`--- p${p} total=${d.total} n=${items.length} range=${dates[dates.length - 1]}..${dates[0]}`);
      items.forEach((i) => {
        if (RE.test(i.description || '')) {
          console.log(`  HIT | ${i.orgao_nome} | ${i.unidade_nome} | ${i.modalidade_licitacao_nome} | ${(i.data_publicacao_pncp || '').slice(0, 10)} | fim:${(i.data_fim_vigencia || '').slice(0, 16)} | R$${i.valor_global != null ? i.valor_global : '?'} | ${i.item_url} | ${(i.description || '').slice(0, 200).replace(/\s+/g, ' ')}`);
        }
      });
      if (items.length < 100) break;
    }
  } else if (mode === 'raw') {
    const d = await get(args[1]);
    console.log(JSON.stringify(d, null, 1).slice(0, Number(args[2] || 4000)));
  }
})();
