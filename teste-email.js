// teste-email.js
async function testarEmail() {
    const res = await fetch('https://backend-aerofestas-production.up.railway.app/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            to: 'lks.inari@gmail.com', // Coloque seu e-mail aqui para testar
            subject: 'Teste Aero Festas - SendGrid',
            text: 'Se você recebeu isso, o SendGrid está funcionando na nuvem! 🚀',
            html: '<h1>Sucesso!</h1><p>O backend está enviando e-mails.</p>'
        })
    });
    console.log(await res.json());
}
testarEmail();