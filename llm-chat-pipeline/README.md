# LLM Chat Pipeline Monorepo

Este monorepo contiene la infraestructura mínima para ejecutar el flujo descrito en la especificación:

```
Input → Esbirro HTML (LLM Chat) → Git → Servidor (Nginx) → Web
Input (Ops) → DevOps (LLM Chat) → Servidor
```

## Requisitos

- Node.js LTS
- pnpm
- Docker y Docker Compose

## Estructura

- `packages/llm-client`: Cliente agnóstico para interactuar con distintos proveedores LLM (OpenAI, Ollama, OpenRouter).
- `packages/chat-core`: Tipos Zod y utilidades de persistencia (filesystem) para sesiones de chat, planes y auditoría.
- `packages/esbirro-html-llm`: Agente "Esbirro HTML" con herramientas de maquetación.
- `packages/devops-llm`: Agente "DevOps" con generación de planes y ejecución bajo aprobación.
- `packages/api-input`: API que crea trabajos y habla con los agentes de forma programática.
- `packages/git-worker`: Worker que persiste cambios en Git.
- `packages/orchestrator`: Orquestador que conecta el flujo entre agentes y despliegues.
- `apps/web-chat`: Interfaz mínima en React para conversar con los agentes y aprobar despliegues.
- `server/`: Dockerfile de Nginx para servir el sitio estático generado.

## Desarrollo local

```bash
pnpm install
pnpm dev
```

Para ejecutar los servicios en contenedores:

```bash
docker compose up --build
```

## Variables de entorno

Consulta el archivo `.env.example` para conocer todas las variables soportadas. Copia el archivo y ajusta los valores antes de ejecutar los servicios.

## Flujos principales

1. **Esbirro HTML** recibe entradas del usuario, las transforma en HTML accesible y escribe los artefactos en `dist/site`.
2. **DevOps** genera planes de despliegue en JSON validados contra una allowlist de comandos. La ejecución requiere aprobación explícita.
3. El **orchestrator** automatiza el ciclo render → commit → deploy cuando se crean trabajos desde `api-input`.

## Licencia

MIT
