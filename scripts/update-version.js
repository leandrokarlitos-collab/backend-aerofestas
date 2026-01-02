const fs = require('fs');
const path = require('path');
const pkg = require('./package.json');

const versionFilePath = path.join(__dirname, 'version.json');
const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));

versionData.version = pkg.version;
versionData.releaseDate = new Date().toISOString().split('T')[0];

// Adiciona nova entrada no changelog se não existir
const existingEntry = versionData.changelog.find(e => e.version === pkg.version);
if (!existingEntry) {
    versionData.changelog.unshift({
        version: pkg.version,
        date: versionData.releaseDate,
        description: `Release v${pkg.version}`,
        changes: ["Atualização automática de versão"]
    });
}

fs.writeFileSync(versionFilePath, JSON.stringify(versionData, null, 4));
console.log(`✅ version.json atualizado para v${pkg.version}`);

