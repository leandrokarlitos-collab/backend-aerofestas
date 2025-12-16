// Script para adicionar funcionalidade de preço aos brinquedos
// Adicione este script DENTRO do DOMContentLoaded na Agenda de eventos.html

// Elementos
const toySelectModal = document.getElementById('toy-select-modal');
const toyQuantityModal = document.getElementById('toy-quantity-modal');
const toyPriceModal = document.getElementById('toy-price-modal');
const addToyToEventBtn = document.getElementById('add-toy-to-event-btn');

// Listener para adicionar brinquedo
addToyToEventBtn?.addEventListener('click', () => {
    const selectedToyId = parseInt(toySelectModal.value);
    const quantity = parseInt(toyQuantityModal.value) || 1;
    const price = parseFloat(toyPriceModal.value) || 0;

    if (!selectedToyId) {
        showToast('Selecione um brinquedo', true);
        return;
    }

    if (price <= 0) {
        showToast('Digite o valor do brinquedo', true);
        return;
    }

    const toy = toys.find(t => t.id === selectedToyId);
    if (!toy) {
        showToast('Brinquedo não encontrado', true);
        return;
    }

    // Verifica se já existe na lista
    const existingIndex = toysForCurrentEvent.findIndex(t => t.id === selectedToyId);
    if (existingIndex > -1) {
        // Atualiza quantidade e preço
        toysForCurrentEvent[existingIndex].quantity += quantity;
        toysForCurrentEvent[existingIndex].price = price;
    } else {
        // Adiciona novo
        toysForCurrentEvent.push({
            id: selectedToyId,
            name: toy.name,
            quantity: quantity,
            price: price
        });
    }

    // Limpa campos
    toyQuantityModal.value = 1;
    toyPriceModal.value = '';

    // Atualiza visualização
    renderSelectedToysInModal();
    updateFinalPrice();

    showToast(`${toy.name} adicionado!`, false);
});

console.log('✅ Fix de preço de brinquedos carregado!');
