# Guia de Verificação do Sistema

## Problema Identificado

O sistema não estava carregando dados do localStorage porque o script `protect.js` redirecionava para login antes de permitir o carregamento dos dados.

## Solução Implementada

O `protect.js` foi modificado para:
- **Permitir modo offline**: Se o servidor não estiver acessível, o sistema continua funcionando e carrega dados do localStorage
- **Timeout de 3 segundos**: Não bloqueia indefinidamente se o servidor não responder
- **Não redireciona em erros de rede**: Permite uso mesmo quando o servidor está offline

## Como Verificar se o Sistema Está Funcionando

### 1. Verificar se o Servidor Está Rodando

```bash
# Verificar processos Node.js
Get-Process -Name node -ErrorAction SilentlyContinue

# Testar conexão na porta 3000
Test-NetConnection -ComputerName localhost -Port 3000
```

**Se o servidor não estiver rodando:**
```bash
npm start
# ou para desenvolvimento com auto-reload
npm run dev
```

### 2. Verificar se Há Usuário Cadastrado

```bash
# Criar usuário administrador
npm run create-admin "Seu Nome" "seu@email.com" "senha123"
```

### 3. Fazer Login no Sistema

1. Abra o navegador em `http://localhost:3000`
2. Você será redirecionado para `/login.html`
3. Faça login com suas credenciais
4. O token será salvo no localStorage como `authToken`

### 4. Verificar Dados no LocalStorage

Abra o Console do Navegador (F12) e execute:

```javascript
// Verificar token de autenticação
console.log('Token:', localStorage.getItem('authToken'));

// Verificar dados da aplicação
console.log('Toys:', JSON.parse(localStorage.getItem('toys') || '[]').length);
console.log('Companies:', JSON.parse(localStorage.getItem('companies') || '[]').length);
console.log('Events:', JSON.parse(localStorage.getItem('events') || '[]').length);
console.log('Clients:', JSON.parse(localStorage.getItem('clients') || '[]').length);
```

### 5. Acessar Páginas do Sistema

Após login, você pode acessar:
- `/Agenda de eventos.html` - Agenda de eventos
- `/Sistema de CRM.html` - Sistema de CRM
- `/Sistema Gestão Financeira.html` - Gestão financeira
- `/Dashboard.html` - Dashboard principal

## Modo Offline (Servidor Não Acessível)

Com as modificações implementadas, o sistema agora funciona mesmo quando o servidor não está acessível:

- ✅ Carrega dados do localStorage
- ✅ Permite visualizar e editar dados locais
- ✅ Não redireciona para login em erros de rede
- ⚠️ Funcionalidades que dependem do servidor (API) não funcionarão

## Logs de Debug

O sistema agora mostra logs no console quando carrega dados:

```
📦 Dados carregados do localStorage (inicial): {toys: X, companies: Y, events: Z, clients: W}
📦 Dados recarregados do localStorage: {toys: X, companies: Y, events: Z, clients: W}
```

Se você ver o aviso:
```
⚠️ Servidor não acessível. Continuando em modo offline.
```

Isso significa que o servidor não está rodando, mas o sistema continua funcionando com dados locais.

## Solução de Problemas

### Problema: Página redireciona para login mesmo com token

**Solução**: Verifique se o servidor está rodando e acessível em `http://localhost:3000`

### Problema: Dados não aparecem na página

**Solução**: 
1. Abra o Console do Navegador (F12)
2. Verifique se há erros no console
3. Verifique se os dados existem no localStorage
4. Verifique os logs de carregamento de dados

### Problema: Erro "Failed to fetch" ou "NetworkError"

**Solução**: 
- O sistema agora permite continuar em modo offline
- Para funcionalidades completas, inicie o servidor com `npm start`

