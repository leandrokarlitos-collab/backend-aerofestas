// Gera um novo par de chaves VAPID e IMPRIME no console — nunca grava em arquivo.
// Uso: node gen-keys.js
//   1) Cole VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY nas variáveis de ambiente do Railway.
//   2) Atualize a constante VAPID_PUBLIC_KEY em js/pwa-init.js (a pública pode ser exposta).
// A chave PRIVADA não pode entrar no repositório em hipótese alguma.
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
