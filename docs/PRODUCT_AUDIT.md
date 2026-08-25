# Auditoría de producto después de V2

## Veredicto

La V2 demuestra la experiencia central: descubrir, representar, revisar, construir y modificar una empresa conversando. Todavía no demuestra que el sistema pueda comprender una empresa real con precisión ni ejecutar trabajo de forma segura.

Construir más pantallas ahora produciría amplitud ficticia. El siguiente incremento debe convertir el Company Model en una fuente de verdad persistente, conectada y evaluable.

## Lo que ya está probado

- Una entrada conversacional puede sustituir visualmente a la configuración tradicional.
- El playback separa hechos, inferencias y gaps.
- El conocimiento puede compilarse en proceso, métricas, roles y recomendaciones.
- Los cambios conversacionales pueden pasar por diff, impacto y aprobación.
- El mismo modelo alimenta varias superficies operativas.

## Lo que todavía es una simulación

| Área | Estado actual | Falta para producción |
|---|---|---|
| Entrevista | Árbol local determinista | LLM, extracción estructurada, memoria, evaluación y preguntas por ganancia de información |
| Company Model | Objeto TypeScript | Esquema persistente, temporal, versionado y multi-tenant |
| Evidencias | Etiquetas generadas | Lineage hasta documento, dato, persona o evento original |
| Cambios | Objetivo editable | Compilador genérico de procesos, roles, KPIs, vistas, permisos y agentes |
| Integraciones | Declaradas en entrevista | OAuth, sincronización incremental, reconciliación e idempotencia |
| Workflows | Representación visual | Runtime determinista, retries, SLAs, compensaciones y auditoría |
| Agentes | Política visible | Herramientas reales, sandbox, presupuestos, evaluaciones y human-in-the-loop |
| Seguridad | Mensajes de intención | Autenticación, RBAC/ABAC, aislamiento, cifrado y registros inmutables |
| Analytics | Datos demostrativos | Event model, semantic layer, baselines y métricas calculadas |
| SaaS | Aplicación local | Organizaciones, usuarios, billing, límites, soporte y observabilidad |

## Prioridad P0 — demostrar comprensión real

### 1. Design partners antes de más amplitud

Reclutar cinco empresas B2B de servicios del mismo perfil. Ejecutar entrevistas reales y comparar el modelo generado con la evaluación de un consultor humano.

Gate:

- Más del 80% del proceso central reconocido como correcto.
- Menos del 15% de afirmaciones importantes corregidas.
- Playback útil en menos de 20 minutos.
- Al menos una decisión operativa nueva por empresa.

### 2. Company Graph persistente

Implementar un núcleo en PostgreSQL con:

- organizations;
- people y roles;
- entities y relationships;
- claims;
- evidence;
- processes, stages y decisions;
- objectives y metrics;
- policies;
- model_versions;
- change_proposals;
- audit_events.

Cada claim necesita estado, confianza, fuente, validador y vigencia temporal.

### 3. Interview Engine asistido por modelos

Construir un gateway de modelos con salidas estructuradas y cuatro operaciones separadas:

1. Extraer afirmaciones.
2. Detectar contradicciones.
3. Actualizar gaps de información.
4. Seleccionar la siguiente pregunta.

No utilizar un único prompt que converse, interprete y modifique el sistema simultáneamente.

### 4. Un solo conector profundo

Empezar con HubSpot o un importador CSV controlado, no con diez integraciones superficiales. Debe demostrar:

- mapping al modelo canónico;
- sincronización incremental;
- deduplicación;
- trazabilidad de la fuente;
- resolución de conflictos;
- revocación del acceso.

### 5. Compilador de cambios genérico

Extender el protocolo actual para que una conversación pueda proponer cambios sobre:

- objetivos;
- owners;
- etapas de proceso;
- reglas de aprobación;
- KPIs;
- permisos;
- automatizaciones.

Todo cambio debe producir diff semántico, dependencias afectadas, riesgo, aprobación y rollback.

## Prioridad P1 — demostrar ejecución segura

- Runtime de workflows determinista.
- Bandeja de aprobaciones.
- Primer agente con una única tarea: detectar handoffs incompletos.
- Replay sobre casos históricos.
- Suite de evaluaciones y trazas.
- Métricas reales de precisión, coste y escalado humano.

## Prioridad P2 — convertirlo en SaaS

- Autenticación y organizaciones.
- Aislamiento multi-tenant.
- Roles y permisos efectivos.
- Onboarding de empleados.
- Billing y límites de uso.
- Exportación y eliminación de datos.
- Observabilidad, alertas y soporte.
- Internacionalización y residencia de datos.

## Qué no construir todavía

- Contabilidad completa.
- Nóminas.
- Marketplace abierto.
- Constructor no-code visual.
- Decenas de agentes especializados.
- Aplicación móvil nativa.
- Verticales reguladas.
- Sustitución total del stack del cliente.

## Próximo sprint recomendado

Nombre: **Truth Layer**.

Resultado esperado: una entrevista real crea claims y evidencias persistentes; el usuario corrige una inferencia; el sistema genera una nueva versión auditable del Company Model.

Entregables:

1. PostgreSQL y autenticación.
2. Esquema de claims, evidence y versions.
3. Endpoint de entrevista con salida estructurada.
4. Playback conectado a datos persistentes.
5. Diff y rollback de una corrección.
6. Dataset inicial de evaluación con 50 casos.

Este sprint es el punto en que Wesify deja de ser una demostración convincente y comienza a convertirse en infraestructura empresarial.
