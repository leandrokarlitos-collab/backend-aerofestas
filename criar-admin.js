// criar-admin.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs'); // Certifique-se de ter instalado (npm install bcryptjs)

const prisma = new PrismaClient();

async function main() {
    console.log("🛠️ Criando usuário Admin...");

    const email = 'admin@aerofestas.com';
    const password = 'admin123';
    
    // Criptografa a senha (igual o sistema faz)
    const hashedPassword = await bcrypt.hash(password, 10);

    try {
        const user = await prisma.user.upsert({
            where: { email: email },
            update: { 
                password: hashedPassword,
                isAdmin: true,
                emailConfirmed: true 
            },
            create: {
                name: 'Administrador',
                email: email,
                password: hashedPassword,
                isAdmin: true,   // <--- O Pulo do Gato: Permissão de Admin
                emailConfirmed: true
            }
        });

        console.log(`✅ Sucesso! Usuário [${user.email}] agora é Admin.`);
        console.log(`🔑 Senha: ${password}`);
    } catch (e) {
        console.error("❌ Erro:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();