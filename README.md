# BO — MVP V2

BO es un prototipo funcional de un espacio de trabajo empresarial generado a partir de una conversación:

1. Una frase inicial explica qué hace la empresa.
2. El modelo de IA decide los módulos, la vista inicial y la siguiente pregunta.
3. BO selecciona una base operativa estable según el tipo de empresa y la IA la adapta con cada respuesta.
4. Las respuestas se pueden volver a editar desde la conversación.
5. Una transición convierte la vista previa en el dashboard final.
6. La entrevista la lleva un modelo frontera en el servidor cuando hay API key; si no la hay, un modelo local en el navegador toma el relevo.

## Ejecutar

```bash
npm install
npm run dev
```

Abrir `http://localhost:4173`.

No requiere cuenta.

Con `ANTHROPIC_API_KEY` configurada, la entrevista se ejecuta en el servidor: arranca al instante, funciona en cualquier navegador y las preguntas son específicas de la empresa. Sin key, BO recurre a Qwen 2.5 0.5B en el navegador; la primera vez se descarga y se guarda en caché, y hace falta WebGPU (Chrome o Edge actuales). El producto funciona en ambos casos.

| Variable | Para qué |
| --- | --- |
| `ANTHROPIC_API_KEY` | Entrevista e investigación en el servidor |
| `BO_CONNECTION_SECRET` | Cifra las credenciales de las apps conectadas. Sin ella, BO se niega a guardarlas |
| `BO_REASONING_MODEL` | Modelo a usar (por defecto `claude-opus-5`) |
| `DATABASE_URL` | Cadena de conexión de Supabase. Con ella BO tiene cuentas; sin ella, funciona como antes y sin cuentas |
| `BO_MODEL_RATE_LIMIT` | Peticiones al modelo por IP y minuto (por defecto 20) |
| `BO_DAILY_MODEL_CALLS` | Techo de llamadas al modelo por día en todo el despliegue (por defecto 500) |
| `BO_HOST` | Interfaz donde escucha el servidor (por defecto `127.0.0.1`; el contenedor usa `0.0.0.0`) |
| `PORT` / `BO_API_PORT` | Puerto (por defecto 8787). `PORT` es el que inyectan las plataformas de despliegue |
| `BO_GENERATED_ROOT` | Dónde guarda BO lo que sigue en disco (por defecto `generated-projects/`; el contenedor usa `/data`) |
| `BO_BROWSER` | Ejecutable del navegador para las pruebas end-to-end. Sin ella se busca Chrome o Edge en las rutas habituales |
| `RESEND_API_KEY` + `BO_MAIL_FROM` | Envío de correo. Sin ambas, los enlaces de recuperación se escriben en el log del servidor en vez de enviarse |
| `BO_PUBLIC_URL` | La dirección pública de BO, para construir los enlaces del correo. Detrás de un proxy hace falta: la cabecera `Host` es la del proxy, no la que ve el cliente |
| `BO_RESET_RATE_LIMIT` | Intentos de recuperación por IP y minuto (por defecto 5) |
| `SENTRY_DSN` | Monitorización de errores. Sin ella, los fallos solo quedan en el log |
| `BO_ENVIRONMENT` / `BO_RELEASE` | Etiquetas del despliegue en los informes de error |
| `STRIPE_SECRET_KEY` | Cobros. Sin ella, todas las cuentas se quedan en el plan gratuito |
| `STRIPE_WEBHOOK_SECRET` | Firma de los webhooks de Stripe. Sin ella BO los rechaza todos |
| `BO_STRIPE_PRICE_PRO` / `BO_STRIPE_PRICE_BUSINESS` | Los price IDs creados en Stripe para cada plan |

Los dos límites existen porque `/api/discovery/turn` no puede pedir token: es la llamada que crea el workspace. Hasta que haya cuentas, son la única defensa contra que la dirección de un despliegue baste para gastar el presupuesto de su dueño.

## Base de datos (Supabase)

Para activar las cuentas hacen falta dos cosas:

1. Pegar [`supabase/schema.sql`](supabase/schema.sql) entero en el editor SQL de Supabase y ejecutarlo una vez. Crea las tablas, los índices y —lo más importante— cierra el acceso desde la API pública: Supabase expone el esquema `public` por PostgREST y concede permiso a `anon` por defecto, así que sin ese paso cualquiera con la clave publicable podría leer los hashes de contraseña y de sesión. Es idempotente: volver a ejecutarlo no rompe nada.
2. Poner la cadena de conexión (**Connect → Session pooler**, puerto `5432`) en `.env.local` como `DATABASE_URL`.

Al arrancar, el servidor debe decir `listening on 127.0.0.1:8787 with accounts`. El fichero deja registradas las migraciones `001_accounts.sql` y `002_records.sql`, así que el servidor no repite el trabajo ya hecho a mano; las migraciones siguientes (`server/migrations/003_*.sql`) se aplican solas al arrancar.

Con `DATABASE_URL` configurada, los registros del workspace —clientes, facturas, órdenes de trabajo— viven en Postgres, en la tabla `records`. Sin ella siguen en ficheros JSON bajo `generated-projects/`, para que el prototipo funcione sin infraestructura. Esto importa al desplegar: Render, Railway, Fly y similares borran el disco local en cada redespliegue, así que sin base de datos los registros desaparecen sin aviso.

Lo que sí sigue en disco es el Command Center generado —el manifiesto versionado y los ficheros `runtime.mjs`, servicios y páginas que BO escribe en cada build—, porque es salida regenerable y no datos que alguien haya tecleado.

## Planes y cobro

Construir el Command Center es gratis, para todo el mundo y siempre. Es también el único argumento de venta que BO tiene: nadie compra un espacio de trabajo que no ha visto construido a partir de su propia descripción. Lo que cuesta dinero es lo que viene después.

| | Free | Pro — $10/mes | Business — $50/mes |
| --- | --- | --- | --- |
| Workspaces | 1 | 1 | 5 |
| Registros | 200 | sin límite | sin límite |
| Rebuilds al mes | 0 | 5 | 20 |
| Apps conectadas | — | ✓ | ✓ |
| Equipo | — | — | ✓ |

Esto sale de lo que BO cuesta de verdad: construir es caro —un turno de entrevista por intercambio, más una pasada de investigación en un modelo frontera con búsqueda web— y usar lo construido es casi gratis, filas en Postgres. Por eso lo que se mide son los rebuilds, no el uso diario.

**Nada se borra nunca por impago.** Si un plan caduca, la cuenta vuelve a los límites del gratuito con todo lo que tenía intacto y legible; simplemente deja de poder añadir hasta volver a un plan que lo cubra. Un pago fallido tampoco es una cancelación: Stripe reintenta durante días, y quitar el producto al primer fallo castiga una tarjeta caducada como si fuera una decisión.

El pago ocurre en la página de Stripe, no en BO. Un número de tarjeta que nunca llega al servidor es un número que no se puede filtrar desde él. Los webhooks se verifican con firma HMAC y ventana temporal, y se aplican una sola vez aunque Stripe los reenvíe.

Para activarlo: crear los dos productos en Stripe, poner sus price IDs en `BO_STRIPE_PRICE_PRO` y `BO_STRIPE_PRICE_BUSINESS`, la clave secreta en `STRIPE_SECRET_KEY`, y apuntar el webhook de Stripe a `POST /api/billing/webhook` con su secreto en `STRIPE_WEBHOOK_SECRET`. Sin esas variables BO arranca igual, avisa por el log, y todas las cuentas se quedan en el plan gratuito.

## Saber cuándo se rompe

Cada respuesta lleva una cabecera `x-bo-request-id`, y cada petición deja una línea JSON en stdout con su ruta, su estado y cuánto tardó. Cuando algo falla con un 500, la respuesta incluye ese mismo id como `reference`: es lo que el cliente puede citar y lo que encuentra la petición exacta en el log.

Con `SENTRY_DSN` configurada, los 500 se envían además a Sentry con su traza y su contexto. Los 4xx no se envían: son BO diciéndole a quien llama que se equivocó, y enviarlos entierra los fallos que sí son de BO.

Lo que nunca sale de aquí: cuerpos de petición, cabeceras y query strings. Un cuerpo lleva contraseñas y claves de API, una cabecera `Authorization` lleva una sesión viva, y un enlace de recuperación vive en un query string. El informe se envía después de responder y con timeout, así que un monitor caído ni retrasa ni tumba a BO.

## Contraseñas olvidadas

Desde la pantalla de acceso, **I forgot my password** pide la dirección y BO envía un enlace. El enlace vale una hora, funciona una sola vez, y al usarlo cierra todas las sesiones abiertas de esa cuenta —porque el motivo para recuperarla puede ser precisamente que otra persona la tenga abierta.

BO responde lo mismo exista o no la cuenta: un endpoint que distinga las dos cosas es la forma de averiguar quién es cliente. El enlace nunca vuelve en la respuesta HTTP, solo por correo.

Sin `RESEND_API_KEY` y `BO_MAIL_FROM`, el enlace se escribe en el log del servidor en vez de enviarse, y el servidor lo avisa al arrancar. Sirve para desarrollo; en producción es que nadie recibe nada.

## Desplegar

BO se empaqueta como una sola imagen. El [`Dockerfile`](Dockerfile) tiene dos etapas: la primera compila el frontend con todo el toolchain, la segunda arranca el servidor sin nada de él.

```bash
docker build -t bo .
docker run -p 8787:8787 \
  -e DATABASE_URL='postgresql://...' \
  -e ANTHROPIC_API_KEY='sk-ant-...' \
  -e BO_CONNECTION_SECRET='...' \
  -v bo-data:/data \
  bo
```

Detalles que importan:

- **El volumen no es opcional.** Con `DATABASE_URL` los registros están a salvo en Postgres, pero el Command Center generado, las credenciales de las apps conectadas y el conocimiento de sector siguen bajo `/data`. Sin volumen, un redespliegue los borra.
- **Los secretos van en el entorno, nunca en la imagen.** `.dockerignore` excluye `.env.local` justamente por eso: una imagen se sube a un registro y sus capas son legibles por cualquiera que la tenga.
- **La imagen corre como usuario `node`, no como root**, y expone `/api/health`, que es lo que usan tanto el `HEALTHCHECK` como cualquier plataforma para saber si el contenedor sirve.
- El servidor cierra ordenadamente con `SIGTERM`, así que las peticiones en vuelo terminan antes de que muera el proceso.

Cada push ejecuta [`.github/workflows/verify.yml`](.github/workflows/verify.yml): el `npm run verify` completo por un lado y, por otro, la construcción de la imagen más un arranque real esperando a que se declare sana. Ninguno de los dos necesita secretos.

## Índice de páginas

| Ruta | Vista |
| --- | --- |
| `/` | Landing pública: cómo funciona BO y qué construye. No pide cuenta |
| `/start` | El prompt inicial. Con cuentas activadas, exige haber entrado |
| `/build/:id` | Conversación y construcción en vivo |
| `/home`, `/today`, `/clients`, `/invoices`, `/links`, … | Secciones del Command Center, cada una con su URL indexada |

Las secciones disponibles las decide el Command Center generado. `/workspace/:id/...` y `/dashboard/...` siguen funcionando y redirigen a la URL indexada.

## Verificar

```bash
npm run verify
```

Ejecuta, en orden: pruebas unitarias, tipos y build, servicio de proyectos, investigación frontera
(contra una API simulada, sin necesidad de key), integración de investigación en la interfaz, y el
smoke end-to-end en navegador. Cada bloque se puede lanzar por separado:

| Comando | Qué cubre |
| --- | --- |
| `npm test` | Motores de investigación, taxonomía de industrias, catálogo de capacidades, esquema de workspace |
| `npm run build` | Tipos y build de producción |
| `npm run test:project-service` | Acceso, CRUD, automatizaciones, versiones y auditoría |
| `npm run test:reasoning` | Investigación frontera: dos pasadas, reanudación, rechazos, validación HTTP |
| `npm run test:industry` | Conocimiento compartido por industria: umbrales, empates sin decidir, anonimato |
| `npm run test:interview` | La entrevista en el servidor, la respuesta que vuelve, y que no se descargue el modelo del navegador |
| `npm run test:stripe` | Conector Stripe: claves rechazadas, credencial cifrada, sincronización que no destruye datos |
| `npm run test:limits` | Límite por IP, techo diario de llamadas al modelo, y que los endpoints gratuitos no se vean afectados |
| `npm run test:auth` | Contraseñas con scrypt, sesiones sólo como hash, caducidad, y borrar una cuenta se lleva sus workspaces |
| `npm run test:accounts` | Las rutas reales: un workspace pertenece a una cuenta y un extraño no llega a él |
| `npm run test:research-ui` | Diario de razonamiento, fuentes citadas y capacidades investigadas en el workspace |
| `npm run test:launch` | Abrir un Command Center terminado: sin overlay de construcción |
| `npm run test:smoke` | Recorrido completo en navegador, rutas indexadas y Links |

## Arquitectura

```text
Descripción + respuestas confirmadas
                 │
                 ▼
   Consultor en el servidor (claude-opus-5)
   · o Qwen 2.5 + WebLLM en el navegador si no hay key
                 │
                 ▼
 Blueprint estructurado + siguiente pregunta
                 │
                 ▼
       Dashboard operativo en vivo
```

Las respuestas están restringidas por un esquema JSON en ambos caminos. Con el modelo del navegador, la información de la empresa no sale del equipo; con el del servidor, la key nunca llega al navegador. El blueprint, las respuestas y el historial se conservan en `localStorage`.

## Apps conectadas

BO no sustituye al sistema que la empresa ya usa: lo muestra. Stripe es el primer conector y es **solo de lectura** — trae clientes, suscripciones y pagos, y nunca cambia nada en Stripe. Las credenciales se guardan cifradas fuera del directorio del workspace y ningún endpoint las devuelve.

El contrato de escritura existe y está probado, pero deliberadamente no está conectado. Ver [docs/CONNECTED_APPS.md](docs/CONNECTED_APPS.md).

## Alcance consciente

Esta V2 valida la experiencia y el modelo de interacción. Con `DATABASE_URL` configurada, las cuentas, las sesiones, la propiedad de los workspaces y los registros que contienen viven en Postgres, y la interfaz ya tiene pantalla de acceso que arrastra la sesión. Se empaqueta como imagen, cada push pasa por CI, los fallos en producción se reportan con contexto suficiente para diagnosticarlos, y hay planes de pago con Stripe. Lo que falta ya no es infraestructura sino producto: más conectores —hoy solo Stripe, en modo lectura— y clientes de verdad usándolo.

Consulta [docs/MVP_V1.md](docs/MVP_V1.md) para las decisiones y el alcance de las siguientes versiones.

La auditoría de producto y el siguiente sprint recomendado están en [docs/PRODUCT_AUDIT.md](docs/PRODUCT_AUDIT.md).

La investigación y especificación de las bases por tipo de empresa está en [docs/COMPANY_BASE_MODELS.md](docs/COMPANY_BASE_MODELS.md).

El motor que decide qué necesita cada empresa, con evidencia y ganancia de información, está en [docs/BUSINESS_RESEARCH.md](docs/BUSINESS_RESEARCH.md).

Cómo BO muestra apps que la empresa ya usa (Xero, Stripe, Shopify…) en vez de duplicarlas, y las
reglas de escritura segura, está en [docs/CONNECTED_APPS.md](docs/CONNECTED_APPS.md).

La base de conocimiento de negocio —taxonomía de industrias (NAICS, dominio público), arquetipos
operativos y catálogo de capacidades— está en [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md).

## Investigación externa (opcional)

Con una API key, BO añade un segundo nivel: un modelo frontera que investiga en la web cómo opera
realmente este tipo de empresa antes de decidir qué construir. Se ejecuta en el servicio Node; la
key nunca llega al navegador. Sin key, BO funciona igual con su investigador local.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # setx ANTHROPIC_API_KEY "..." en Windows
npm run dev
```

Detalles, coste y límites en [docs/FRONTIER_RESEARCH.md](docs/FRONTIER_RESEARCH.md).
