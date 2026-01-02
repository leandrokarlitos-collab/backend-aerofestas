const webpush = require('web-push');
const fs = require('fs');
const vapidKeys = webpush.generateVAPIDKeys();
const content = `PUBLIC_KEY=${vapidKeys.publicKey}\nPRIVATE_KEY=${vapidKeys.privateKey}`;
fs.writeFileSync('vapid.env', content, 'utf8');
console.log('Keys generated in vapid.env');
