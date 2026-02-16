const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    const hashedPassword = await bcrypt.hash('admin123', 10);

    const user = await prisma.user.upsert({
        where: { email: 'admin@aerofestas.com' },
        update: {
            password: hashedPassword,
            isAdmin: true,
            emailConfirmed: true
        },
        create: {
            name: 'Administrador',
            email: 'admin@aerofestas.com',
            password: hashedPassword,
            isAdmin: true,
            emailConfirmed: true
        }
    });

    console.log('✅ Usuário admin criado/atualizado:', user.email);
}

main()
    .catch(e => { console.error('❌ Erro:', e); process.exit(1); })
    .finally(() => prisma.$disconnect());
