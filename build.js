const fs = require('fs');
const core = fs.readFileSync('src/core.js', 'utf8');
const tpl = fs.readFileSync('src/game.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
const html = tpl.replace('/*__CORE__*/', () => core);
fs.writeFileSync('dist/flappy-math.html', html);
// versión documento completo para empaquetar como app nativa (Capacitor) o servir en cualquier hosting
const full = `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">\n<meta name="theme-color" content="#142a25">\n<style>html{padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}body{margin:0}[hidden]{display:none!important}</style>\n</head>\n<body>\n${html}\n</body>\n</html>\n`;
fs.mkdirSync('www', { recursive: true });
fs.writeFileSync('www/index.html', full);
// verificación de sintaxis de los scripts inline
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => { new Function(s); });
console.log('ok', (html.length/1024).toFixed(1)+'KB', scripts.length, 'scripts');
