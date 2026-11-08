# Glaura CRM

CRM interne en français : prospection, base de salons, tâches commerciales et messagerie Instagram privée.

```bash
npm ci
npx prisma generate
# Docker Desktop doit être démarré. La DATABASE_URL doit pointer vers localhost.
npm run dev:setup
npm run dev
```

Configurer l’environnement de développement et sa base PostgreSQL avant la connexion. Utiliser une base locale dédiée pour les migrations de développement.

```bash
npm test
npm run lint
npm run build
```

Le service de prospection se lance avec `npm run prospect:worker`. Les services de production sont définis dans `docker-compose.yml`.

Voir [le fonctionnement, les accès, les migrations et la configuration Meta](docs/CRM.md) avant la mise en service.
