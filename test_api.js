const http = require('http');

const data = JSON.stringify({
  nome: 'Teste Local',
  nascimento: '2000-01-01',
  cpf: '12345678901'
});

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/finance/monitores',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, res => {
  console.log(`statusCode: ${res.statusCode}`);
  let out = '';
  res.on('data', d => {
    out += d;
  });
  res.on('end', () => {
    console.log(out);
  });
});

req.on('error', error => {
  console.error(error);
});

req.write(data);
req.end();
