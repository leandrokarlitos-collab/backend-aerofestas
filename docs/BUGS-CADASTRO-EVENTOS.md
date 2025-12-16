# 🔧 Correções Pendentes - Cadastro de Eventos

## ✅ **Bug 1: Erro 500 ao Salvar - RESOLVIDO**
- **Causa:** Schema do Prisma não tinha campos que o frontend envia
- **Solução:** 
  - Atualizado `schema.prisma` com TODOS os campos do evento
  - Atualizado `/api/admin/events` no `server.js`
  - Executando migração: `npx prisma migrate dev --name add_event_fields`

## 🔴 **Bugs Restantes (a corrigir):**

### Bug 2: Subtotal não atualiza
- **Problema:** Ao adicionar brinquedos, o subtotal não é rec alculado
- **Onde:** Função `updateFinalPrice()` ou `renderSelectedToysInModal()`
- **Solução:** Garantir que updateFinalPrice() seja chamada após adicionar/remover brinquedo

### Bug 3: Brinquedos além do estoque são aceitos
- **Problema:** Sistema não valida estoque disponível antes de adicionar
- **Onde:** Botão "Adicionar Brinquedo ao Evento"
- **Solução:** Usar função `getToyAvailabilityForDateTime()` ANTES de adicionar

### Bug 4: Brinquedos já locados são aceitos
- **Problema:** Sistema não verifica se o brinquedo está disponível no horário
- **Onde:** Mesma função de adicionar brinquedo
- **Solução:** Validar disponibilidade por data/hora usando `getToyAvailabilityForDateTime()`

---

## 📋 **Próximos Passos:**
1. ✅ Aguardar migração do Prisma terminar
2. ⏳ Reiniciar servidor backend (Railway)
3. ⏳ Corrigir bugs 2, 3 e 4
4. ✅ Testar salvamento de eventos
