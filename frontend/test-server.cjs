const { spawn } = require('child_process');
const http = require('http');

const child = spawn('npx', ['vite'], { cwd: '.', stdio: 'inherit' });

setTimeout(() => {
  http.get('http://localhost:5173', (res) => {
    console.log('STATUS:', res.statusCode);
    child.kill();
    process.exit(0);
  }).on('error', (e) => {
    console.error(`Got error: ${e.message}`);
    child.kill();
    process.exit(1);
  });
}, 5000);
