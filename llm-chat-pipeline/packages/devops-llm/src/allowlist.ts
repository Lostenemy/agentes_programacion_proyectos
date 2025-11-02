export const ALLOWED_COMMANDS = [
  "git pull --rebase",
  "git status",
  "docker compose -f docker-compose.prod.yml up -d",
  "docker compose -f docker-compose.prod.yml ps",
  "rsync -avz --delete ./site/ REMOTE_SITE_DIR/",
  "nginx -t",
  "ls -lah /srv/site",
  "rm -rf /srv/site/.cache"
];

export function isAllowed(command: string) {
  return ALLOWED_COMMANDS.includes(command.trim());
}
