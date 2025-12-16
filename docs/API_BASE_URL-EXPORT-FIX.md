# ✅ EXPORT API_BASE_URL CORRIGIDO

## 🐛 **Erro:**
```
profile.js:2 Uncaught SyntaxError: 
The requested module './auth.js' does not provide an export named 'API_BASE_URL'
```

## 🔧 **Causa:**
O arquivo `js/auth.js` definia `API_BASE_URL` como constante local, mas não a exportava:
```javascript
// ❌ ANTES (errado):
const API_BASE_URL = "https://...";
```

## ✅ **Solução:**
Adicionado `export` à constante:
```javascript
// ✅ AGORA (correto):
export const API_BASE_URL = "https://...";
```

## 📋 **Arquivo Modificado:**
- `js/auth.js` - linha 2

## 🎯 **Importações que funcionam agora:**
```javascript
// profile.js
import { getToken, removeToken, getUserData, saveUserData, API_BASE_URL } from './auth.js';

// Ou qualquer outro módulo que precise da URL base
import { API_BASE_URL } from './js/auth.js';
```

## ✅ **Status:**
**CORRIGIDO!** Agora todos os módulos ES6 podem importar a constante `API_BASE_URL` do `auth.js`.

---

**Recarregue a página de perfil!** 🚀
