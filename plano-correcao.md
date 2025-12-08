# 🛠️ Plano de Correção e Melhorias - Aero Festas

## 🚨 Bugs Críticos e UI

- [ ] **1. Saudação Fixa "Leandro" no Dashboard**
    - **Status:** 🔴 Pendente
    - **Arquivo:** `dashboard.html` (Preciso que você envie este arquivo).
    - **Solução:** Alterar o script para ler o nome do usuário do `localStorage`.

- [ ] **2. Menu de Logout "Desconexo"**
    - **Status:** 🟢 Corrigido (Veja abaixo).
    - **Arquivo:** `js/protect.js`.
    - **Solução:** Redesenhar o botão para ser mais discreto e elegante.

- [ ] **3. Modal "Adicionar Agendamento" sobrepondo**
    - **Status:** 🔴 Pendente
    - **Arquivo:** `Agenda de eventos.html` (Preciso que você envie este arquivo).
    - **Solução:** Adicionar comando para fechar o modal "Eventos do Dia" ao abrir o "Novo Evento".

- [ ] **4. Abas do Catálogo (UI)**
    - **Status:** 🔴 Pendente
    - **Arquivo:** `Agenda de eventos.html`.
    - **Solução:** Transformar os collapsibles em um sistema de Tabs (Abas) estilo navegador.

- [ ] **5. Evento Excluído Retorna**
    - **Status:** 🔴 Pendente
    - **Arquivo:** `Agenda de eventos.html` e `server.js`.
    - **Solução:** Verificar se a rota de `DELETE` está implementada e conectada.

## 💰 Sistema Financeiro

- [ ] **6. Financeiro Vazio (Sem Entradas/Saídas)**
    - **Status:** 🟠 Em Análise.
    - **Problema:** O banco de dados atual só tem tabela para `Monitores`, mas não tem tabela para `Transações` (Entradas/Saídas).
    - **Ação Necessária:** Precisamos criar o `model Transaction` no `schema.prisma` e atualizar a migração.

---
**Próximos Passos:** Enviar os arquivos `dashboard.html` e `Agenda de eventos.html` para resolver os itens 1, 3, 4 e 5.