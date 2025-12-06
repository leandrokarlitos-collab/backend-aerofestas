const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * Gera hash da senha usando bcrypt
 */
async function hashPassword(password) {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
}

/**
 * Compara senha com hash
 */
async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

/**
 * Gera token aleatório para confirmação de email
 */
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    hashPassword,
    comparePassword,
    generateToken
};

