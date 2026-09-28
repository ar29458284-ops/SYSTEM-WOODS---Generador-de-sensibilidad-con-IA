# SYSTEM WOODS — IA REAL v2

Este proyecto usa la **Responses API de OpenAI** desde el servidor. La clave nunca se coloca en `index.html`.

## Configuración rápida

1. Usa Node.js 18 o superior.
2. Define la variable `OPENAI_API_KEY` en el servidor.
3. Opcionalmente define `OPENAI_MODEL=gpt-5.6-luna`.
4. Ejecuta:

```bash
node server.mjs
```

5. Abre `http://localhost:3000`.

## Prueba de conexión

Visita `/api/health`. Debe aparecer `aiConfigured: true`.

## Publicarlo

El proyecto incluye `render.yaml` para servicios compatibles con Render. En el panel del servicio configura el secreto `OPENAI_API_KEY`; **no lo pegues en el HTML ni lo publiques en GitHub**.

## Qué hace la IA

SYSTEM WOODS envía a OpenAI la marca, modelo, Hz, perfil y, cuando corresponde, la configuración anterior. La IA devuelve una nueva recomendación estructurada con sensibilidad, rango, tamaño de botón y DPI.

La recomendación es orientativa: la IA no tiene acceso directo al teléfono ni puede garantizar rendimiento dentro del juego.
