# Despliegue del bot WhatsApp de FinFlow en Railway

Este ZIP contiene **solo el bot Node.js**. La app PHP puede seguir en InfinityFree.

## 1. Qué hace este paquete

- Levanta el endpoint HTTP del bot.
- Genera PNG para pagos aprobados y rechazados.
- Envía mensajes/imágenes a grupos de WhatsApp usando `whatsapp-web.js`.
- Guarda la sesión de WhatsApp en un volumen persistente para no escanear QR en cada reinicio.

## 2. Archivos principales

- `server.js`: bot y render de imágenes PNG.
- `package.json`: dependencias Node.
- `Dockerfile`: imagen preparada con Chromium para Railway.
- `railway.json`: healthcheck `/health` y política de reinicio.
- `.env.example`: variables de referencia.

## 3. Variables de entorno en Railway

Configura estas variables en Railway:

```env
BOT_API_TOKEN=pon_aqui_un_token_largo_y_seguro
WWEBJS_CLIENT_ID=finflow-main
WWEBJS_DATA_PATH=/data/.wwebjs_auth
HEADLESS=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

No crees `PORT` en Railway salvo que sepas exactamente por qué lo haces. Railway lo inyecta automáticamente.

## 4. Volumen persistente

Crea un volumen persistente en Railway y móntalo en:

```txt
/data
```

La sesión real quedará en:

```txt
/data/.wwebjs_auth
```

Eso evita escanear QR en cada redeploy/reinicio normal.

## 5. Primer QR

La primera vez:

1. Despliega el servicio.
2. Abre los logs del servicio en Railway.
3. Escanea el QR desde WhatsApp > Dispositivos vinculados.
4. Espera el mensaje `WhatsApp bot listo.`

Después de eso, mientras no borres el volumen ni cierres la sesión desde WhatsApp, no deberías tener que escanear QR en cada reinicio.

## 6. Crear dominio público

En Railway ve a:

```txt
Service > Settings > Networking > Public Networking > Generate Domain
```

Railway te dará una URL parecida a:

```txt
https://finflow-wa-production.up.railway.app
```

## 7. Configurar InfinityFree

En la app PHP, cambia el endpoint del bot a:

```txt
https://TU-DOMINIO.up.railway.app/api/whatsapp/send-group
```

Y usa el mismo `BOT_API_TOKEN` configurado en Railway.

## 8. Pruebas rápidas

Healthcheck público:

```bash
curl https://TU-DOMINIO.up.railway.app/health
```

Status protegido:

```bash
curl -H "Authorization: Bearer TU_TOKEN" https://TU-DOMINIO.up.railway.app/status
```

Prueba manual de envío:

```bash
curl -X POST "https://TU-DOMINIO.up.railway.app/api/whatsapp/send-group" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_TOKEN" \
  -d '{
    "eventType":"manual_test",
    "groupName":"Pagos",
    "message":"Prueba manual desde bot en Railway",
    "meta":{"source":"railway"}
  }'
```

## 9. Seguridad

- No subas `.env`.
- No subas `.wwebjs_auth`.
- Usa un token largo.
- El endpoint `/status` está protegido con Bearer Token para no exponer el QR públicamente.


## QR legible en navegador

Si el QR de los logs de Railway se ve borroso o cortado, usa el endpoint protegido:

```txt
https://TU-DOMINIO.up.railway.app/qr?token=TU_BOT_API_TOKEN
```

Ese enlace muestra el QR grande en una página web. No compartas ese enlace porque contiene el token del bot.


## CORRECCIÓN BUILD

Esta versión evita `npm ci` porque el `package-lock.json` anterior podía quedar desactualizado frente a `package.json`.
El Dockerfile usa:

```bash
npm install --omit=dev
```

Además, la ruta `/` ahora muestra una pantalla simple. Las rutas útiles son:

```txt
/health
/qr?token=TU_BOT_API_TOKEN
/api/whatsapp/send-group
```
