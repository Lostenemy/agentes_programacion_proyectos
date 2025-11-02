# Guía de despliegue en servidor

Esta guía describe cómo poner en marcha el monorepo **LLM Chat Pipeline** en un servidor Linux (Ubuntu/Debian) utilizando Docker y Docker Compose. Se asume acceso SSH al servidor, permisos de superusuario y que el repositorio ya se encuentra clonado en `/srv/llm-chat-pipeline` (ajusta las rutas según tu entorno).

## 1. Preparativos iniciales

1. **Instalar dependencias básicas:**
   ```bash
   sudo apt update && sudo apt install -y curl git ca-certificates
   ```
2. **Instalar Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   ```
   > Tras añadir tu usuario al grupo `docker`, cierra sesión y vuelve a entrar.
3. **Instalar Docker Compose Plugin (v2):**
   ```bash
   sudo apt install -y docker-compose-plugin
   docker compose version
   ```
4. **Instalar pnpm y Node.js (solo si se compila en el servidor):**
   ```bash
   curl -fsSL https://get.pnpm.io/install.sh | sh -
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

## 2. Configurar variables de entorno

1. Copia el archivo de ejemplo y edítalo:
   ```bash
   cd /srv/llm-chat-pipeline/llm-chat-pipeline
   cp .env.example .env
   ```
2. Ajusta los valores obligatorios:
   - `API_TOKEN`: token que usarán clientes y orquestador para autenticarse.
   - `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`: credenciales y configuración del proveedor LLM.
   - Variables Git (`GIT_REMOTE_URL`, `GIT_BRANCH`, `GIT_USER_NAME`, `GIT_USER_EMAIL`).
   - Variables de despliegue remoto (`SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_KEY_PATH`, `REMOTE_SITE_DIR`, `PUBLIC_BASE_URL`).
   - Cualquier otro secreto requerido por tus integraciones.
3. **Claves SSH:** asegúrate de que la clave privada referenciada en `SSH_KEY_PATH` exista y tenga permisos `600`. Puedes administrarla con `docker secret` si usas Swarm, o montarla como volumen en Compose.

## 3. Construir imágenes y dependencias

1. Instala las dependencias de los paquetes si vas a ejecutar scripts locales:
   ```bash
   pnpm install
   ```
2. Construye los artefactos TypeScript en caso de desplegar desde el repositorio compilado:
   ```bash
   pnpm build
   ```
   > También puedes delegar la compilación a los contenedores (`docker compose build` compila automáticamente).

## 4. Despliegue con Docker Compose

1. Desde la raíz del monorepo (donde está `docker-compose.yml`), levanta los servicios:
   ```bash
   docker compose up -d --build
   ```
2. Verifica que todos los contenedores estén en ejecución:
   ```bash
   docker compose ps
   ```
3. Revisa los logs de un servicio específico si es necesario:
   ```bash
   docker compose logs -f esbirro-html-llm
   ```

### Servicios expuestos

| Servicio              | Puerto interno | Puerto host (por defecto) | Descripción |
|----------------------|----------------|----------------------------|-------------|
| `api-input`          | 3000           | 3000                       | Ingreso de trabajos vía API. |
| `esbirro-html-llm`   | 3100           | 3100                       | Chat del agente Esbirro. |
| `devops-llm`         | 4000           | 4000                       | Chat del agente DevOps y aprobaciones. |
| `apps/web-chat`      | 5173           | 5173                       | UI React para conversación y aprobaciones. |
| `nginx`              | 8080           | 8080                       | Sitio estático generado en `/srv/site`. |

## 5. Flujo de publicación

1. **Renderizado**: Usa el endpoint `/esbirro/chat` (o la UI) para pedir a Esbirro que transforme Markdown en HTML. Los artefactos se escriben en `dist/site/` dentro del contenedor.
2. **Commit y push**: El `git-worker` se encarga de versionar los cambios y enviarlos al remoto configurado mediante `GIT_REMOTE_URL`.
3. **Plan de despliegue**: El agente DevOps genera planes JSON. Tras revisarlos, apruébalos enviando `POST /ops/execute` con `approve: true` o usando el botón “Aprobar & Ejecutar” en la UI.
4. **Entrega**: Nginx sirve el contenido generado desde el volumen `site-data:/srv/site`. Confirma que `http://<tu-servidor>:8080` responde correctamente o publica detrás de un reverse proxy público.

## 6. Actualizaciones y mantenimiento

- Para actualizar el código:
  ```bash
  git pull --rebase
  docker compose build
  docker compose up -d
  ```
- Para revisar el estado de los planes y auditorías, consulta los archivos generados en `/data` (montados como volúmenes según tu configuración).
- Para detener los servicios:
  ```bash
  docker compose down
  ```

## 7. Seguridad y buenas prácticas

- Usa certificados TLS en el proxy o en Nginx para exponer la web de forma segura.
- Protege los endpoints con `API_TOKEN` y aplica listas de IP o firewalls si es posible.
- Mantén Docker y el sistema operativo actualizados con parches de seguridad.
- Supervisa los logs (`docker compose logs -f`) y configura alertas según tus necesidades.

Con estos pasos tendrás el pipeline desplegado y listo para orquestar la creación, versionado y despliegue de contenidos generados por los agentes LLM.
