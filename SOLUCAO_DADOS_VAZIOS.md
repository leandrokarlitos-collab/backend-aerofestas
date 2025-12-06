# Solução: Dados Vazios no Sistema

## Problema Identificado

Os dados estão no arquivo `example/Agenda de eventos.html`, mas você está acessando através de `http://localhost:3000/Agenda de eventos.html`.

**Causa**: Cada origem tem seu próprio localStorage:
- `file:///...example/Agenda de eventos.html` → localStorage A (com dados)
- `http://localhost:3000/Agenda de eventos.html` → localStorage B (vazio)

## Solução: Migrar os Dados

### Método 1: Usar a Ferramenta de Migração (Recomendado)

1. Acesse: `http://localhost:3000/migrar-dados.html`
2. Abra `example/Agenda de eventos.html` diretamente no navegador (não pelo servidor)
3. Abra o Console (F12) no arquivo example
4. Execute o comando que está na página de migração para copiar os dados
5. Cole os dados na ferramenta de migração
6. Clique em "Importar Dados"

### Método 2: Copiar Manualmente via Console

**Passo 1 - No arquivo example (file://)**

Abra `example/Agenda de eventos.html` e no console:

```javascript
// Copiar dados para clipboard
const dados = {
    toys: JSON.parse(localStorage.getItem('toys') || '[]'),
    companies: JSON.parse(localStorage.getItem('companies') || '[]'),
    events: JSON.parse(localStorage.getItem('events') || '[]'),
    clients: JSON.parse(localStorage.getItem('clients') || '[]'),
    crmToyClients_v8: JSON.parse(localStorage.getItem('crmToyClients_v8') || '[]')
};
copy(JSON.stringify(dados));
```

**Passo 2 - No servidor (http://localhost:3000)**

Abra `http://localhost:3000/Agenda de eventos.html` e no console:

```javascript
// Colar e importar os dados
const dados = /* COLE AQUI O JSON COPIADO */;

localStorage.setItem('toys', JSON.stringify(dados.toys));
localStorage.setItem('companies', JSON.stringify(dados.companies));
localStorage.setItem('events', JSON.stringify(dados.events));
localStorage.setItem('clients', JSON.stringify(dados.clients));
localStorage.setItem('crmToyClients_v8', JSON.stringify(dados.crmToyClients_v8));

// Recarregar a página
location.reload();
```

### Método 3: Exportar/Importar Arquivo

Se os métodos acima não funcionarem, você pode:

1. No arquivo example, criar um botão de "Exportar Dados"
2. Baixar um arquivo JSON com todos os dados
3. No sistema atual, criar um botão de "Importar Dados"
4. Carregar o arquivo JSON

## Verificar se Funcionou

1. Acesse: `http://localhost:3000/diagnostico-localstorage.html`
2. Verifique se as chaves agora mostram dados
3. Acesse: `http://localhost:3000/Agenda de eventos.html`
4. Os dados devem aparecer

## Prevenção Futura

Para evitar esse problema:
- Sempre use o servidor (`http://localhost:3000`) para acessar o sistema
- Não abra os arquivos HTML diretamente (file://)
- Use o sistema de autenticação para garantir que está no servidor

## Comandos Úteis

**Ver todos os dados no console:**
```javascript
Object.keys(localStorage).forEach(key => {
    console.log(key, localStorage.getItem(key).substring(0, 100));
});
```

**Limpar localStorage (CUIDADO!):**
```javascript
localStorage.clear();
```

**Backup antes de limpar:**
```javascript
const backup = {};
Object.keys(localStorage).forEach(key => {
    backup[key] = localStorage.getItem(key);
});
console.log(JSON.stringify(backup));
```

