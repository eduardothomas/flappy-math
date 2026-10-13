# Flappy Math

Arcade 2D de cálculo mental. Un solo código HTML5/JS para web, y Capacitor para empaquetarlo como app Android e iOS.

## Estructura
- `src/core.js` — núcleo sin DOM: generador matemático con semilla, geometría con validador de alcanzabilidad, simulación a 60 Hz fijos.
- `src/game.html` — render (canvas), HUD, menús, audio, entrada y guardado local.
- `build.js` — une todo en `www/index.html` (app) y `dist/flappy-math.html` (página web).
- `test/run-tests.js` — 100.000 desafíos por dificultad + bot que recorre 150 obstáculos por partida.

## Requisitos
- Node.js 20 o superior.
- Android: Android Studio (con SDK) y un teléfono con depuración USB, o un emulador.
- iOS: una Mac con Xcode y un iPhone. Para instalar en tu propio iPhone basta un Apple ID gratuito (la app caduca a los 7 días); para TestFlight o App Store, Apple Developer Program.

## Comandos
```bash
npm install
npm test              # pruebas del núcleo
npm run build         # genera www/index.html
npm run serve         # prueba web en http://localhost:8080 (y desde el teléfono con la IP de tu PC en la misma Wi-Fi)

npx cap add android   # solo la primera vez
npm run android       # sincroniza y abre Android Studio → botón Run ▶

npx cap add ios       # solo la primera vez (en la Mac)
npm run ios           # abre Xcode → elige tu iPhone → Signing: tu equipo → Run ▶
```

## Después de cada cambio
Edita `src/`, luego `npm run cap:sync` y vuelve a ejecutar desde Android Studio o Xcode.

## Orientación vertical
- Android: en `android/app/src/main/AndroidManifest.xml`, dentro de `<activity>`, agrega `android:screenOrientation="portrait"`.
- iOS: en Xcode, target App → General → Deployment Info → marca solo Portrait.

## Publicación web
Cada push a `main` corre las pruebas, genera `www/` y lo publica en GitHub Pages (`.github/workflows/pages.yml`).
URL: https://eduardothomas.github.io/flappy-math/
