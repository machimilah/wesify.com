# Wesify — adaptive business operating suite

Wesify construye una suite operativa conectada a partir de cómo funciona una empresa. El producto
abarca CRM, ventas, proyectos, inventario, facturación, contabilidad, personas, automatización,
permisos e informes sin obligar a cada empresa a instalar el mismo ERP.

La dirección de producto y sus límites están definidos en
[`docs/PRODUCT_REPOSITIONING.md`](docs/PRODUCT_REPOSITIONING.md).

El flujo actual funciona así:

1. Una frase inicial explica qué hace la empresa.
2. El modelo de IA decide los módulos, la vista inicial y la siguiente pregunta.
3. Wesify selecciona una base operativa estable según el tipo de empresa y la IA la adapta con cada respuesta.
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

Con `GEMINI_API_KEY` o `ANTHROPIC_API_KEY` configurada, la entrevista se ejecuta en el servidor: arranca al instante, funciona en cualquier navegador y las preguntas son específicas de la empresa en lugar de una lista fija igual para todos. Sin key, Wesify recurre a Qwen 2.5 0.5B en el navegador; la primera vez se descarga y se guarda en caché, y hace falta WebGPU (Chrome o Edge actuales). El producto funciona en ambos casos.

La key de Gemini es gratuita y sin tarjeta: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → *Create API key*. Es la forma recomendada de tener la entrevista inteligente sin coste. La de Anthropic añade además la investigación web, que Gemini no ejecuta; con las dos configuradas manda Anthropic, salvo que `BO_INTERVIEW_PROVIDER=gemini` diga lo contrario.

| Variable | Para qué |
| --- | --- |
| `GEMINI_API_KEY` | Entrevista en el servidor con el nivel gratuito de Google |
| `ANTHROPIC_API_KEY` | Entrevista e investigación web en el servidor |
| `BO_INTERVIEW_PROVIDER` | Fuerza `gemini` o `anthropic` cuando hay dos keys |
| `BO_GEMINI_MODEL` | Modelo de Gemini (por defecto `gemini-3.7-flash`) |
| `BO_GEMINI_FALLBACK_MODELS` | Modelos a los que Wesify baja cuando el primero se queda sin cuota gratuita |
| `VITE_API_URL` | Solo para despliegue partido: dónde vive la API. Se compila en el bundle, así que es una dirección, nunca un secreto |
| `BO_ALLOWED_ORIGINS` | Qué orígenes de navegador pueden llamar a la API. Sin ella, ninguno |
| `BO_CONNECTION_SECRET` | Cifra las credenciales de las apps conectadas. Sin ella, Wesify se niega a guardarlas |
| `BO_AUTOMATION_SCHEDULER` | El planificador horario/diario/semanal está activo por defecto en procesos persistentes; `off` solo lo desactiva para pruebas o cuando un scheduler externo ejecuta los trabajos |
| `BO_AUTOMATION_SCHEDULER_SECRET` / `CRON_SECRET` | Protege `POST /api/system/automations/run-due`, la entrada para cron en despliegues serverless |
| `BO_REASONING_MODEL` | Modelo a usar (por defecto `claude-haiku-4-5-20251001`, el más barato). Subirlo mejora la calidad y multiplica el coste por build |
| `DATABASE_URL` | Cadena de conexión de Supabase. Es la mitad de las cuentas: dónde vive lo que una cuenta posee |
| `CLERK_SECRET_KEY` | La otra mitad: con qué verifica el servidor la sesión de Clerk. Sin ella nadie puede iniciar sesión, aunque haya base de datos |
| `VITE_CLERK_PUBLISHABLE_KEY` | La clave pública de Clerk, compilada en el bundle. Es una dirección, nunca un secreto |
| `BO_MODEL_RATE_LIMIT` | Peticiones al modelo por IP y minuto (por defecto 20) |
| `BO_DAILY_MODEL_CALLS` | Techo de llamadas al modelo por día en todo el despliegue (por defecto 500) |
| `BO_HOST` | Interfaz donde escucha el servidor (por defecto `127.0.0.1`; el contenedor usa `0.0.0.0`) |
| `PORT` / `BO_API_PORT` | Puerto (por defecto 8787). `PORT` es el que inyectan las plataformas de despliegue |
| `BO_GENERATED_ROOT` | Dónde guarda Wesify lo que sigue en disco (por defecto `generated-projects/`; el contenedor usa `/data`) |
| `BO_BROWSER` | Ejecutable del navegador para las pruebas end-to-end. Sin ella se busca Chrome o Edge en las rutas habituales |
| `BO_PUBLIC_URL` | La dirección pública de Wesify, para construir los enlaces que salen del servidor (por ejemplo el retorno de Stripe). Detrás de un proxy hace falta: la cabecera `Host` es la del proxy, no la que ve el cliente |
| `SENTRY_DSN` | Monitorización de errores. Sin ella, los fallos solo quedan en el log |
| `BO_ENVIRONMENT` / `BO_RELEASE` | Etiquetas del despliegue en los informes de error |
| `STRIPE_SECRET_KEY` | Cobros. Sin ella, todas las cuentas se quedan en el plan gratuito |
| `STRIPE_WEBHOOK_SECRET` | Firma de los webhooks de Stripe. Sin ella Wesify los rechaza todos |
| `BO_STRIPE_PRICE_PRO` / `BO_STRIPE_PRICE_BUSINESS` | Los price IDs creados en Stripe para cada plan |

Los dos límites existen porque `/api/discovery/turn` no puede pedir token: es la llamada que crea el workspace. Hasta que haya cuentas, son la única defensa contra que la dirección de un despliegue baste para gastar el presupuesto de su dueño.

## Desplegar en Vercel

`api/[...path].mjs` ejecuta el router de Wesify como una función de Vercel, así que las keys del cuadro de arriba funcionan ahí: se ponen en el proyecto de Vercel y ya. No hacen falta `VITE_API_URL` ni `BO_ALLOWED_ORIGINS` — la interfaz y la API comparten origen, igual que en local.

Lo que sí hace falta es `DATABASE_URL`. El disco de Vercel es de solo lectura salvo `/tmp`, y `/tmp` no sobrevive entre invocaciones: sin Postgres, cada workspace desaparece en cuanto la función se enfría.

Sin `vercel.json` y sin `api/`, Vercel detecta Vite, compila y sirve `dist` como estático: el servidor nunca arranca, ninguna key se lee, y cada llamada a `/api` cae en el CDN y devuelve la página. Desde fuera eso parece un despliegue que ignora sus variables de entorno, que es exactamente lo que no es.

`VITE_API_URL` y `BO_ALLOWED_ORIGINS` siguen existiendo para el otro reparto: la interfaz en un CDN y la API en un host que sí puede sostener un proceso —el `Dockerfile` de este repo—, cuando el disco efímero o el límite de duración de una función se quedan cortos.

## Base de datos (Supabase)

Para activar las cuentas hacen falta dos cosas (además de Clerk, más abajo):

1. Pegar [`supabase/schema.sql`](supabase/schema.sql) entero en el editor SQL de Supabase y ejecutarlo una vez. Crea las tablas, los índices y —lo más importante— cierra el acceso desde la API pública: Supabase expone el esquema `public` por PostgREST y concede permiso a `anon` por defecto, así que sin ese paso cualquiera con la clave publicable podría leer quién tiene cuenta y todos los registros de todos los workspaces. Es idempotente: volver a ejecutarlo no rompe nada.
2. Poner la cadena de conexión (**Connect → Session pooler**, puerto `5432`) en `.env.local` como `DATABASE_URL`.

Al arrancar, el servidor debe decir `listening on 127.0.0.1:8787 with accounts`. El fichero deja registradas todas las migraciones de `server/migrations/`, así que el servidor no repite el trabajo ya hecho a mano; las que se añadan después se aplican solas al arrancar.

Con `DATABASE_URL` configurada, los registros del workspace —clientes, facturas, órdenes de trabajo— viven en Postgres, en la tabla `records`. Sin ella siguen en ficheros JSON bajo `generated-projects/`, para que el prototipo funcione sin infraestructura. Esto importa al desplegar: Render, Railway, Fly y similares borran el disco local en cada redespliegue, así que sin base de datos los registros desaparecen sin aviso.

Con `DATABASE_URL` también viven en Postgres la entrevista de cada workspace (`discovery_sessions`) y la descripción de lo que ese Command Center es —sus entidades, sus campos, sus páginas— (`workspace_builds`). Sin ella estaban solo en disco: los registros sobrevivían a un redespliegue y la definición de lo que significaban, no.

Con `DATABASE_URL` también vive en Postgres lo que Wesify ha aprendido de cada industria: qué sistemas conservaron, quitaron o añadieron las empresas reales de ese sector. Es lo único que Wesify tiene que no se puede copiar leyendo el producto, y estaba en el mismo disco que un redespliegue borra. Solo agregados: nunca el nombre de una empresa, nunca un registro.

Lo que sí sigue en disco es el Command Center generado —el manifiesto versionado y los ficheros `runtime.mjs`, servicios y páginas que Wesify escribe en cada build—, porque es salida regenerable y no datos que alguien haya tecleado.

## Planes y cobro

Construir el Command Center es gratis, para todo el mundo y siempre. Es también el único argumento de venta que Wesify tiene: nadie compra un espacio de trabajo que no ha visto construido a partir de su propia descripción. Lo que cuesta dinero es lo que viene después.

| | Free | Pro — $10/mes | Business — $50/mes |
| --- | --- | --- | --- |
| Workspaces | 1 | 1 | 5 |
| Registros | 200 | sin límite | sin límite |
| Rebuilds al mes | 0 | 5 | 20 |
| Apps conectadas | — | ✓ | ✓ |
| Equipo | — | — | ✓ |

Esto sale de lo que Wesify cuesta de verdad: construir es caro —un turno de entrevista por intercambio, más una pasada de investigación en un modelo frontera con búsqueda web— y usar lo construido es casi gratis, filas en Postgres. Por eso lo que se mide son los rebuilds, no el uso diario.

**Nada se borra nunca por impago.** Si un plan caduca, la cuenta vuelve a los límites del gratuito con todo lo que tenía intacto y legible; simplemente deja de poder añadir hasta volver a un plan que lo cubra. Un pago fallido tampoco es una cancelación: Stripe reintenta durante días, y quitar el producto al primer fallo castiga una tarjeta caducada como si fuera una decisión.

El pago ocurre en la página de Stripe, no en Wesify. Un número de tarjeta que nunca llega al servidor es un número que no se puede filtrar desde él. Los webhooks se verifican con firma HMAC y ventana temporal, y se aplican una sola vez aunque Stripe los reenvíe.

Para activarlo: crear los dos productos en Stripe, poner sus price IDs en `BO_STRIPE_PRICE_PRO` y `BO_STRIPE_PRICE_BUSINESS`, la clave secreta en `STRIPE_SECRET_KEY`, y apuntar el webhook de Stripe a `POST /api/billing/webhook` con su secreto en `STRIPE_WEBHOOK_SECRET`. Sin esas variables Wesify arranca igual, avisa por el log, y todas las cuentas se quedan en el plan gratuito.

## Saber cuándo se rompe

Cada respuesta lleva una cabecera `x-bo-request-id`, y cada petición deja una línea JSON en stdout con su ruta, su estado y cuánto tardó. Cuando algo falla con un 500, la respuesta incluye ese mismo id como `reference`: es lo que el cliente puede citar y lo que encuentra la petición exacta en el log.

Con `SENTRY_DSN` configurada, los 500 se envían además a Sentry con su traza y su contexto. Los 4xx no se envían: son Wesify diciéndole a quien llama que se equivocó, y enviarlos entierra los fallos que sí son de Wesify.

Lo que nunca sale de aquí: cuerpos de petición, cabeceras y query strings. Un cuerpo lleva contraseñas y claves de API, una cabecera `Authorization` lleva una sesión viva, y un enlace de recuperación vive en un query string. El informe se envía después de responder y con timeout, así que un monitor caído ni retrasa ni tumba a Wesify.

## Identidad (Clerk)

Clerk es quien guarda la credencial. Wesify no almacena contraseñas, no emite tokens de sesión y no envía correos de recuperación: registrarse, iniciar sesión, verificar el correo, recuperar la contraseña y cerrar sesión en todos los dispositivos ocurren en Clerk, en su pantalla, contra su instancia.

Lo que Wesify sí guarda es una fila por persona en `users`, cuya clave primaria **es** el id de usuario de Clerk. Todo lo que Wesify posee —workspaces, membresías, suscripciones, rebuilds— cuelga de esa fila, así que cambiar de proveedor de identidad no obliga a mover ni una tabla más. La fila se crea sola la primera vez que esa persona llega al servidor con una sesión válida.

Cómo se conecta:

1. Crear una aplicación en [clerk.com](https://clerk.com).
2. Poner `CLERK_SECRET_KEY` (empieza por `sk_`) en `.env.local`: es con lo que el servidor verifica cada token.
3. Poner `VITE_CLERK_PUBLISHABLE_KEY` (empieza por `pk_`) en `.env.local`: Vite la compila en el bundle. Es pública por diseño.

Al arrancar, el servidor debe decir `listening on 127.0.0.1:8787 with accounts`. Con base de datos pero sin `CLERK_SECRET_KEY` avisa por el log y nadie puede entrar; sin ninguna de las dos, Wesify funciona como el prototipo de un solo navegador que siempre fue.

El navegador nunca guarda una credencial de Wesify: pide un token a Clerk en cada petición —duran alrededor de un minuto— y lo manda en la cabecera `Authorization`. Por eso `sessionHeaders()` es asíncrona.

## Desplegar

Wesify se empaqueta como una sola imagen. El [`Dockerfile`](Dockerfile) tiene dos etapas: la primera compila el frontend con todo el toolchain, la segunda arranca el servidor sin nada de él.

```bash
docker build -t bo .
docker run -p 8787:8787 \
  -e DATABASE_URL='postgresql://...' \
  -e GEMINI_API_KEY='AIza...' \
  -e ANTHROPIC_API_KEY='sk-ant-...' \
  -e BO_CONNECTION_SECRET='...' \
  -v bo-data:/data \
  bo
```

Detalles que importan:

- **El volumen no es opcional.** Con `DATABASE_URL` los registros y el conocimiento de sector están a salvo en Postgres, pero el Command Center generado y las credenciales de las apps conectadas siguen bajo `/data`. Sin volumen, un redespliegue las borra.
- **Los secretos van en el entorno, nunca en la imagen.** `.dockerignore` excluye `.env.local` justamente por eso: una imagen se sube a un registro y sus capas son legibles por cualquiera que la tenga.
- **La imagen corre como usuario `node`, no como root**, y expone `/api/health`, que es lo que usan tanto el `HEALTHCHECK` como cualquier plataforma para saber si el contenedor sirve.
- El servidor cierra ordenadamente con `SIGTERM`, así que las peticiones en vuelo terminan antes de que muera el proceso.

Cada push ejecuta [`.github/workflows/verify.yml`](.github/workflows/verify.yml): el `npm run verify` completo por un lado y, por otro, la construcción de la imagen más un arranque real esperando a que se declare sana. Ninguno de los dos necesita secretos.

## Índice de páginas

| Ruta | Vista |
| --- | --- |
| `/` | La única página de entrada: la caja para describir tu empresa. Pública — no pide cuenta hasta que hay algo que construir |
| `/build/:id` | Conversación y construcción en vivo |
| `/workspace/:workspaceId`, `/workspace/:workspaceId/home`, `/workspace/:workspaceId/clients`, … | El Command Center de un workspace concreto. Ruta canónica: sirve para compartir un enlace, abrir una segunda pestaña o entrar desde otro dispositivo, porque qué workspace se muestra lo decide la URL, no el navegador |

Las secciones disponibles las decide el Command Center generado. Un workspace ya construido se sirve desde caché local cuando existe y, si no —una pestaña nueva, otro dispositivo—, se pide al servidor, que guarda la especificación completa desde el momento en que se construyó.

Al iniciar sesión, una cuenta con un workspace ya construido entra directamente en él en vez de volver a la caja para describir la empresa; `/home`, `/dashboard/...` y demás enlaces antiguos siguen funcionando y redirigen al workspace activo en este navegador.

## Verificar

```bash
npm run verify
```

Ejecuta, en orden: pruebas unitarias, tipos y build, servicio de proyectos, investigación frontera
(contra una API simulada, sin necesidad de key), integración de investigación en la interfaz, y el
smoke end-to-end en navegador. Cada bloque se puede lanzar por separado:

| Comando | Qué cubre |
| --- | --- |
| `npm test` | Motores de investigación, taxonomía, catálogo, esquema, tema, y la traducción de lo que dice el modelo a lo que le pasa al workspace. Con cobertura medida y con umbral: si baja, falla |
| `npm run build` | Tipos y build de producción |
| `npm run test:project-service` | Acceso, CRUD, automatizaciones, versiones y auditoría |
| `npm run test:reasoning` | Investigación frontera: dos pasadas, reanudación, rechazos, validación HTTP |
| `npm run test:industry` | Conocimiento compartido por industria: umbrales, empates sin decidir, anonimato, investigación que caduca |
| `npm run test:industry-store` | Que lo aprendido viva en Postgres y no en el disco que borra cada redespliegue |
| `npm run test:security` | Cabeceras en toda respuesta, CSP sin script inline, SSRF, cuerpo máximo, errores que no filtran nada |
| `npm run test:structure` | Ningún fichero por encima de 800 líneas, ningún marcador TODO, ninguna credencial en el código |
| `npm run test:interview` | La entrevista en el servidor, la respuesta que vuelve, y que no se descargue el modelo del navegador |
| `npm run test:stripe` | Conector Stripe: claves rechazadas, credencial cifrada, sincronización que no destruye datos |
| `npm run test:limits` | Límite por IP, techo diario de llamadas al modelo, y que los endpoints gratuitos no se vean afectados |
| `npm run test:auth` | Un workspace pertenece a una cuenta, un extraño no es miembro, y borrar una cuenta se lleva sus workspaces |
| `npm run test:clerk` | El punto donde una identidad de Clerk se convierte en cuenta de Wesify: token falso no crea nada, el primero crea una fila, el segundo no vuelve a llamar a Clerk |
| `npm run test:accounts` | Las rutas reales: un workspace pertenece a una cuenta y un extraño no llega a él |
| `npm run test:research-ui` | Diario de razonamiento, fuentes citadas y capacidades investigadas en el workspace |
| `npm run test:launch` | Abrir un Command Center terminado: sin overlay de construcción |
| `npm run test:smoke` | Recorrido completo en navegador, rutas indexadas y Links |

## Arquitectura

```text
Descripción + respuestas confirmadas
                 │
                 ▼
   Consultor en el servidor (claude-haiku-4-5-20251001 por defecto)
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

Wesify posee los registros y flujos cuando puede imponer correctamente sus estados, validaciones, permisos y auditoría. Cuando un sistema externo todavía tiene mayor profundidad legal, fiscal o de ecosistema, Wesify lo conecta y conserva la trazabilidad entre ambos lados.

Stripe es el primer conector y hoy es **solo de lectura**: trae clientes, suscripciones y pagos, y nunca cambia nada en Stripe. Las credenciales se guardan cifradas fuera del directorio del workspace y ningún endpoint las devuelve.

El contrato de escritura existe y está probado, pero deliberadamente no está conectado. Ver [docs/CONNECTED_APPS.md](docs/CONNECTED_APPS.md).

## Alcance consciente

Esta V2 valida la experiencia y el modelo de interacción. Con `DATABASE_URL` y las claves de Clerk configuradas, la identidad la lleva Clerk y la propiedad de los workspaces y los registros que contienen viven en Postgres, con pantalla de acceso y sesión que sobrevive al recargar. Se empaqueta como imagen, cada push pasa por CI, los fallos en producción se reportan con contexto suficiente para diagnosticarlos, y hay planes de pago con Stripe. Lo que falta es profundidad de producto: motores transaccionales, inventario y contabilidad deterministas, localización, más conectores y validación con clientes reales.

Consulta [docs/PRODUCT_REPOSITIONING.md](docs/PRODUCT_REPOSITIONING.md) para la decisión vigente y la secuencia de entrega.

La auditoría de producto y el siguiente sprint recomendado están en [docs/PRODUCT_AUDIT.md](docs/PRODUCT_AUDIT.md).

La investigación y especificación de las bases por tipo de empresa está en [docs/COMPANY_BASE_MODELS.md](docs/COMPANY_BASE_MODELS.md).

El motor que decide qué necesita cada empresa, con evidencia y ganancia de información, está en [docs/BUSINESS_RESEARCH.md](docs/BUSINESS_RESEARCH.md).

Cómo Wesify muestra apps que la empresa ya usa (Xero, Stripe, Shopify…) en vez de duplicarlas, y las
reglas de escritura segura, está en [docs/CONNECTED_APPS.md](docs/CONNECTED_APPS.md).

La base de conocimiento de negocio —taxonomía de industrias (NAICS, dominio público), arquetipos
operativos y catálogo de capacidades— está en [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md).

El agente que vive dentro del workspace —qué puede construir y cambiar, cómo un plan se convierte en
una versión nueva probada antes de aplicarse, y qué modelo lo mueve— está en
[docs/WORKSPACE_AGENT.md](docs/WORKSPACE_AGENT.md).

Cómo Wesify comprueba que no falta ninguna operación antes de construir —APQC como lista maestra,
SCOR donde se mueven mercancías, ISA-95 donde se producen, COSO para controles, y los temas
regulatorios que hay que confirmar con la autoridad competente— está en
[docs/PROCESS_COMPLETENESS.md](docs/PROCESS_COMPLETENESS.md).

## Investigación externa (opcional)

Con una API key, Wesify añade un segundo nivel: un modelo frontera que investiga en la web cómo opera
realmente este tipo de empresa antes de decidir qué construir. Se ejecuta en el servicio Node; la
key nunca llega al navegador. Sin key, Wesify funciona igual con su investigador local.

```bash
export ANTHROPIC_API_KEY="sk-ant-..."   # setx ANTHROPIC_API_KEY "..." en Windows
npm run dev
```

Detalles, coste y límites en [docs/FRONTIER_RESEARCH.md](docs/FRONTIER_RESEARCH.md).
