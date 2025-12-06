const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Envia email de confirmação de cadastro usando Firebase Cloud Functions
 */
async function sendConfirmationEmail(email, token, name) {
    const firebaseFunctionUrl = process.env.FIREBASE_EMAIL_FUNCTION_URL;
    
    if (!firebaseFunctionUrl) {
        console.warn('⚠️  Firebase Email Function URL não configurada. Email não será enviado.');
        const confirmationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/confirm-email.html?token=${token}`;
        console.log(`📧 [SIMULAÇÃO] Link de confirmação para ${email}: ${confirmationUrl}`);
        return { success: true, simulated: true };
    }

    const confirmationUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/confirm-email.html?token=${token}`;

    const emailData = {
        email,
        token,
        name,
        confirmationUrl,
        subject: 'Confirme seu cadastro - Aero Festas',
        html: `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background: linear-gradient(135deg, #4f46e5 0%, #a855f7 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
                    .button { display: inline-block; background: #4f46e5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                    .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>Bem-vindo ao Sistema Operante!</h1>
                    </div>
                    <div class="content">
                        <p>Olá, <strong>${name}</strong>!</p>
                        <p>Obrigado por se cadastrar no sistema. Para completar seu cadastro e ativar sua conta, clique no botão abaixo:</p>
                        <div style="text-align: center;">
                            <a href="${confirmationUrl}" class="button">Confirmar Email</a>
                        </div>
                        <p>Ou copie e cole este link no seu navegador:</p>
                        <p style="word-break: break-all; color: #4f46e5;">${confirmationUrl}</p>
                        <p><strong>Este link expira em 24 horas.</strong></p>
                        <p>Se você não se cadastrou, ignore este email.</p>
                    </div>
                    <div class="footer">
                        <p>Aero Festas - Sistema Operante</p>
                    </div>
                </div>
            </body>
            </html>
        `,
        text: `
            Olá, ${name}!
            
            Obrigado por se cadastrar no sistema. Para completar seu cadastro, acesse:
            ${confirmationUrl}
            
            Este link expira em 24 horas.
            
            Se você não se cadastrou, ignore este email.
        `
    };

    try {
        const url = new URL(firebaseFunctionUrl);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const postData = JSON.stringify(emailData);

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        return new Promise((resolve, reject) => {
            const req = client.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const result = JSON.parse(data);
                            resolve({ success: true, simulated: false, result });
                        } catch (e) {
                            resolve({ success: true, simulated: false, result: data });
                        }
                    } else {
                        reject(new Error(`Firebase Function retornou erro ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    } catch (error) {
        console.error('Erro ao enviar email via Firebase:', error);
        throw error;
    }
}

module.exports = {
    sendConfirmationEmail
};
