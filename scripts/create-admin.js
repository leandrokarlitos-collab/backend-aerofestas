/**
 * Script para criar o primeiro usuário administrador
 * Uso: node scripts/create-admin.js <nome> <email> <senha>
 */

require('dotenv').config();
const { hashPassword } = require('../utils/crypto');
const fs = require('fs').promises;
const path = require('path');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

async function createAdmin() {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log('Uso: node scripts/create-admin.js <nome> <email> <senha>');
        console.log('Exemplo: node scripts/create-admin.js "Admin" "admin@aerofestas.com" "senha123"');
        process.exit(1);
    }

    const [name, email, password] = args;

    try {
        // Garante que a pasta data existe
        const dataDir = path.join(__dirname, '..', 'data');
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            // Pasta já existe
        }

        // Carrega usuários existentes
        let users = [];
        try {
            const data = await fs.readFile(USERS_FILE, 'utf8');
            users = JSON.parse(data);
        } catch (error) {
            // Arquivo não existe, cria novo
        }

        // Verifica se email já existe
        if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            console.error('❌ Erro: Email já cadastrado!');
            process.exit(1);
        }

        // Cria hash da senha
        const hashedPassword = await hashPassword(password);

        // Cria usuário admin
        const adminUser = {
            id: Date.now().toString(),
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: hashedPassword,
            isAdmin: true,
            emailConfirmed: true,
            createdAt: new Date().toISOString()
        };

        users.push(adminUser);
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

        console.log('✅ Usuário administrador criado com sucesso!');
        console.log(`   Nome: ${adminUser.name}`);
        console.log(`   Email: ${adminUser.email}`);
        console.log(`   ID: ${adminUser.id}`);
        console.log('\n📝 Você já pode fazer login com este usuário!');
    } catch (error) {
        console.error('❌ Erro ao criar usuário admin:', error.message);
        process.exit(1);
    }
}

createAdmin();

