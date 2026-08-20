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
| `BO_MODEL_RATE_LIMIT` | Peticiones al modelo por IP y minuto (por defecto 20) |
| `BO_DAILY_MODEL_CALLS` | Techo de llamadas al modelo por día en todo el despliegue (por defecto 500) |

Los dos límites existen porque `/api/discovery/turn` no puede pedir token: es la llamada que crea el workspace. Hasta que haya cuentas, son la única defensa contra que la dirección de un despliegue baste para gastar el presupuesto de su dueño.

## Índice de páginas

| Ruta | Vista |
| --- | --- |
| `/` | Inicio |
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

Esta V2 valida la experiencia y el modelo de interacción. **No incluye todavía autenticación ni cuentas de usuario**, base de datos, facturación ni despliegue. Los datos viven en `localStorage` y en ficheros JSON del servidor, lo que sirve para un prototipo y no para varios usuarios a la vez.

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
