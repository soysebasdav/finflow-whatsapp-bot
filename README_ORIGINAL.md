# Bot de WhatsApp para FinFlow

Este servicio Node recibe eventos HTTP desde la app PHP y publica mensajes en grupos de WhatsApp usando un número-bot vinculado por QR.

## Requisitos

- Node.js 18 o superior
- Google Chrome / Chromium disponible para Puppeteer
- Un número dedicado para el bot

## Instalación

```bash
cd whatsapp-bot
copy .env.example .env
npm install
npm start
```

## Vincular el número

1. Arranca el servicio con `npm start`.
2. En la consola aparecerá un QR.
3. En el teléfono del número-bot abre WhatsApp > Dispositivos vinculados > Vincular dispositivo.
4. Escanea el QR.
5. El bot conservará la sesión en `.wwebjs_auth`.

## Verificar estado

- `GET http://127.0.0.1:3100/health`
- `GET http://127.0.0.1:3100/status`

## Endpoint que usa la app PHP

`POST http://127.0.0.1:3100/api/whatsapp/send-group`

Body JSON:

```json
{
  "eventType": "payment_registered",
  "groupTarget": "https://chat.whatsapp.com/XXXXXXXX",
  "groupName": "Pagos por validar",
  "message": "Hola. Se registró un pago...",
  "meta": {
    "counterpartyId": 10,
    "paymentId": 55
  }
}
```

## Cómo identificar el grupo

- Si guardas un link de invitación, el bot intentará unirse usando ese link.
- Si guardas un `@g.us`, enviará directo a ese grupo.
- Si dejas vacío el target pero sí el nombre, buscará por nombre exacto del grupo.

## Recomendaciones

- Usa un número aparte, no tu número personal principal.
- Mete manualmente ese número-bot a los grupos que quieras usar.
- Mantén el token del bot solo en la configuración de administradores.


## Novedad: tarjetas PNG para pagos aprobados

Ahora el endpoint también puede recibir `renderType` y `renderData` para generar una imagen PNG elegante y enviarla al grupo con un caption corto. La app PHP ya viene ajustada para que los pagos aprobados salgan como tarjeta visual con resumen y tabla de historial de movimientos.

> Importante: después de actualizar el ZIP debes ejecutar nuevamente `npm install` dentro de `whatsapp-bot` para instalar `sharp`, y luego reiniciar el bot con `npm start`.
