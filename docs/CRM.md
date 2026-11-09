# CRM Glaura — fonctionnement et mise en service

## Espaces et confidentialité

- **Aujourd’hui** présente les prochaines tâches, les retards et les salons. Les administrateurs voient aussi le stock non attribué. Le compteur Instagram n’apparaît que pour le propriétaire de la messagerie.
- **Prospection** conserve la base existante, paginée par 50 lignes. Recherche, zone, responsable, statut et comptes Instagram à confirmer sont filtrables. L’administrateur attribue une sélection avec une action et une échéance. Les commerciaux voient seulement leurs prospects, y compris les anciennes attributions par tournée.
- **Mes tâches** conserve les actions jusqu’à leur clôture, avec un résultat obligatoire. Les rappels existants restent visibles. Les tournées anciennes inachevées restent accessibles.
- **Salons et suivi** conserve les fiches et l’historique existants. Le tableau est la vue par défaut ; les fiches restent disponibles. Les listes sont paginées.
- **Équipe et accès** permet d’autoriser des comptes Google, de désactiver un membre et de transférer son travail ouvert. Les activités historiques conservent leur auteur. Le contrôle de membre actif et du rôle est refait pour chaque session.
- **Messagerie Instagram** est réservée à un seul compte administrateur, défini ci-dessous. Les autres administrateurs et commerciaux ne peuvent pas accéder à ses pages ou actions. Les tâches ne donnent accès qu’au contexte explicitement saisi par l’administrateur ; elles n’exposent ni messages ni référence privée de conversation.

Les utilisateurs historiques ne sont pas automatiquement approuvés du seul fait de leur présence dans la base : Google nécessite l’adresse dans `ALLOWED_GOOGLE_EMAILS` ou une autorisation explicite dans l’administration. Un compte désactivé est refusé dans tous les cas. La liste réelle des anciens collaborateurs doit être vérifiée par l’administrateur : cette modification ne désactive nominativement personne.

## Déploiement

1. Sauvegarder la base selon la procédure habituelle du serveur.
2. Utiliser la nouvelle image pour exécuter `npx prisma migrate deploy` **avant** de démarrer la nouvelle application et ses services. La migration ajoute des tables et colonnes ; elle ne supprime aucun prospect ou salon. Elle reprend les propriétaires et crée une tâche pour chaque prospect encore en tournée attribuée.
3. Démarrer l’application et le nouveau service `prospection-worker` défini dans `docker-compose.yml`, en plus des services existants. `npm run prospect:jobs` traite la file une fois ; `npm run prospect:worker` la surveille en continu.
4. Vérifier les connexions administrateur/commercial et désactiver les anciens membres dans **Équipe et accès**. Retirer aussi leurs adresses de la configuration initiale `ALLOWED_GOOGLE_EMAILS`, puis réattribuer leur travail.
5. Configurer Meta et vérifier un vrai message entrant et une réponse avant d’utiliser la messagerie au quotidien.

Les tests et la compilation locale ne valident pas les permissions Meta du compte de production. Aucune migration, collecte payante, réponse Instagram ou modification de membre n’est exécutée sur la production par les tests.

## Collectes et enrichissements

Les traitements sont mis en file depuis **Prospection → Collecte et enrichissement** et exécutés hors des requêtes web. Une interruption du service rend le traitement en échec après expiration de son signal de vie ; les résultats déjà enregistrés sont conservés.

- **Collecte Google** : `GOOGLE_PLACES_KEY`, avec Places API (New) Text Search activée. Saisir un métier ou une recherche et choisir la zone. Seuls les résultats dont le code postal correspond à la zone sont importés. Limite de 200 résultats par lancement, sans demande de notes ou de nombre d’avis. Les appels peuvent être facturés par Google selon la configuration du projet.
- **Annuaires** : réutilise les collecteurs Planity, Treatwell, Booksy et Fresha et leurs seuils existants. La limite de résultats Google/Instagram du formulaire ne limite pas un parcours d’annuaire. Les pages sont bornées par `PROSPECT_MAX_PAGES`.
- **Enrichissement Google** : retrouve le profil Google d’un prospect déjà présent.
- **Enrichissement Instagram** : `IG_GRAPH_TOKEN` et `IG_GRAPH_USER_ID`. Retrouve et vérifie le compte professionnel d’un prospect existant. Les résultats ambigus sont à confirmer depuis la base.
- **Import Instagram** : importer des comptes professionnels connus (`@salon1, @salon2` ou URLs de profils). Maximum 50 comptes par lancement. La connexion officielle Meta ne fournit pas une recherche libre de tous les comptes. La zone choisie est une attribution manuelle, pas une localisation vérifiée par Meta.

La déduplication compare les URLs, les identifiants Google, les comptes Instagram et les noms normalisés avec code postal lorsqu’ils sont disponibles. Elle évite les doublons détectables lors des nouvelles collectes ; elle ne fusionne pas automatiquement les anciennes fiches ambiguës.

## Connexion Firebase existante de Glaura

La connexion recommandée réutilise le compte prestataire Glaura de Firebase :

```dotenv
CRM_INSTAGRAM_PROVIDER_ID=<UID du prestataire Glaura connecté à glaura.app>
```

Le CRM vérifie que ce profil est connecté à `glaura.app`, lit son jeton dans le coffre privé `prod-eu/instagramCredentials/{providerId}` et utilise `graph.instagram.com`, comme le backend Firebase. Le renouvellement du jeton et le webhook existant restent gérés par Firebase. Aucun jeton n’est copié dans la configuration du CRM, aucun nouveau webhook Meta n’est nécessaire. L’accès au coffre utilise le compte de service Firebase déjà monté sur le serveur ; aucune règle cliente Firestore n’est modifiée.

`npm run instagram:sync` importe l’historique disponible via Meta puis les messages déjà enregistrés dans Firebase. Le service de prospection récupère ensuite les nouvelles réceptions toutes les 30 secondes, uniquement pour ce prestataire. Les fils WhatsApp et Glaura présents dans la même collection sont exclus. L’écran privé se rafraîchit toutes les 30 secondes. L’accès reste réservé au compte défini par `CRM_INSTAGRAM_ADMIN_EMAIL`.

## Autre connexion : Facebook Login


Cette intégration utilise **Instagram API avec Facebook Login**, compatible avec le compte professionnel déjà utilisé pour l’enrichissement. La connexion de découverte de profils seule n’accorde pas les permissions de messages.

Configurer dans l’environnement serveur :

```dotenv
# Un seul compte CRM, qui doit aussi avoir le rôle ADMIN.
CRM_INSTAGRAM_ADMIN_EMAIL=admin@glaura.fr
# À défaut, utilise CRM_ADMIN_EMAIL, puis admin@glaura.fr.

IG_GRAPH_USER_ID=<identifiant du compte Instagram professionnel Glaura>
IG_GRAPH_VERSION=v25.0
IG_MESSAGING_TOKEN=<jeton de Page autorisé pour la messagerie Instagram>
META_APP_SECRET=<secret de l’application Meta>
IG_WEBHOOK_VERIFY_TOKEN=<secret aléatoire pour vérifier l’abonnement>
```

Dans Meta, vérifier le lien Page/compte Instagram, les permissions `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, le niveau d’accès requis pour les conversations réelles et les abonnements de messagerie du compte. La configuration des jetons reste côté serveur, jamais dans les formulaires du CRM.

URL du webhook : `https://crm.glaura.ai/api/instagram/webhook`. La vérification GET utilise le secret d’abonnement ; les notifications POST exigent une signature HMAC SHA-256 valide sur le corps exact et l’identifiant du compte Glaura. Les notifications sont enregistrées par identifiant de message, donc les répétitions ne créent pas de doublons. Une erreur de stockage renvoie un statut permettant à Meta de réessayer.

Les nouveaux messages arrivent dans Firebase par le webhook existant. Le CRM récupère automatiquement les mises à jour toutes les 30 secondes et la page s’actualise automatiquement ; aucune action manuelle n’est nécessaire. L’action facultative « Importer l’historique » parcourt jusqu’à 100 conversations Meta et leurs 100 derniers messages, puis les archives Firebase disponibles. Ce premier import est borné ; ce n’est pas une garantie d’archive historique exhaustive. Les demandes inactives depuis plus de 30 jours, les groupes et certains contenus ne sont pas accessibles. Les pièces jointes sont signalées avec un renvoi vers Instagram. Les réponses depuis le CRM sont limitées à 24 heures après le dernier message entrant ; aucun envoi automatique n’est effectué.

Pour transmettre une action aux commerciaux : lier ou créer un salon, choisir son responsable, saisir une action et le contexte à partager. Le CRM conserve le fil complet dans l’espace privé de l’administrateur.

Références : [Meta, Conversations API](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a), [Meta, Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api), [Google, Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search).

## Ciblage Treatwell + Planity

Le bloc **Cibler les salons Treatwell + Planity** lance une collecte des deux annuaires sur une zone. Seuls les établissements dont le nom est compatible et dont l’adresse complète (numéro, rue et code postal) concorde sont retenus. Les deux liens sont conservés sur le prospect et restent accessibles après sa conversion en salon. Aucun seuil minimal d’avis n’est appliqué à ce ciblage.

Le filtre **Treatwell + Planity confirmés** affiche les correspondances vérifiées et leur date de vérification. Les rapprochements ambigus ou deux prospects déjà distincts ne sont pas fusionnés automatiquement : le bilan les signale. Une limite de résultats borne les fiches importées ; elle ne réduit pas le nombre de pages nécessaire pour comparer les annuaires. Les limites de pagination ou les erreurs de lecture peuvent laisser des établissements non détectés ; une absence de correspondance n’est pas une preuve d’absence de Planity.

La migration `20261108140000_prospect_dual_platform` conserve les liens des anciennes fiches et ajoute les champs nécessaires à la double présence. Elle ne marque pas les anciens prospects comme confirmés sur les deux plateformes sans rapprochement.

### Suivi commercial depuis la messagerie

Chaque conversation peut être liée à une fiche salon existante ou à un nouveau salon. La liste et le panneau « Salon lié » affichent le statut commercial de cette fiche, son responsable et sa prochaine tâche non terminée. Si aucune tâche n’existe, la date de prochaine action de la fiche est utilisée. Les échéances dépassées apparaissent en rouge. Le lien « Voir les tâches du salon » ouvre le suivi commercial ; le statut se modifie depuis la fiche salon.

Les vues « À traiter », « En attente », « Traitées » et « Toutes » concernent uniquement le traitement de la conversation. Le menu « Traitement » permet de changer de vue, sans modifier le statut commercial. Un nouveau message entrant rouvre la conversation ; rejouer un ancien message ne la rouvre pas.

Les filtres « Sans lead », « Sans responsable » et « Relance en retard » se combinent avec le statut commercial, le commercial et la vue de traitement. Les filtres sont conservés pendant la pagination et après les actions. Les informations affichées concernent le salon lié, y compris les tâches créées depuis un autre canal. L’accès à la messagerie reste limité au compte administrateur configuré.

Vérification locale des requêtes et transitions avec des données temporaires : `npx tsx scripts/verify-instagram-tracking.ts`. Ce script refuse toute base distante et nettoie ses propres données.

### Import facultatif de l’historique Instagram

L’import manuel est mis en file dans `InstagramSync` puis exécuté par le service de prospection en arrière-plan. Le navigateur est libéré dès la mise en file. Une seule demande peut être en file ou en cours ; les doubles clics ne lancent pas plusieurs imports. La page affiche les compteurs de conversations et messages vérifiés pour Meta et Firebase, l’étape et la dernière progression. Les compteurs comprennent les messages déjà présents et ne désignent pas uniquement de nouveaux messages.

Le traitement émet un signal de vie toutes les 15 secondes. Un traitement abandonné est marqué interrompu après cinq minutes sans signal de vie ; la durée maximale d’un import est de 20 minutes. Les messages déjà enregistrés restent disponibles en cas d’échec. Les erreurs affichées ne contiennent aucun jeton, contenu de message ou réponse brute de fournisseur. Ce mécanisme est distinct de la réception automatique, qui continue par le webhook Firebase existant.

### Qualification des leads Instagram

La messagerie privée affiche quatre qualifications : **Chaud** (accord explicite sur un rendez-vous, une démo ou une prochaine étape), **Tiède** (intérêt exploratoire), **À recontacter plus tard** (report demandé ou informations à vérifier), **Froid** (refus explicite). La qualification est distincte du statut commercial et du traitement de la conversation.

Les nouveaux messages entrants récents sont automatiquement mis en file pour qualification. Les conversations existantes se qualifient avec « Qualifier le dernier message » ; aucun lot de conversations historiques n’est envoyé automatiquement à l’IA. Le service réutilise la clé Anthropic du CRM et `claude-haiku-4-5`. Il transmet le texte du dernier message entrant et jusqu’à six messages de contexte bornés, sans ajouter d’identifiants de compte. Les messages sortants ne sont pas une preuve d’intérêt. Les messages supprimés ou sans texte exploitable sont orientés vers une vérification humaine sans appel à l’IA. Un intérêt exprimé il y a plus de 30 jours est à revalider ; un refus explicite reste froid même ancien. Une décision IA de faible confiance est également orientée vers une vérification.

L’analyse conserve son message source et l’empreinte de son contenu. Un nouveau message ou une modification du message invalide l’analyse précédente. Les traitements concurrents sont contrôlés par une prise en charge conditionnelle ; une réponse IA arrivée après une correction manuelle ou un message plus récent est ignorée. Les erreurs de fournisseur ne sont pas affichées brutes.

Le panneau présente la raison et l’action proposée et permet une correction manuelle. Seule la température est reportée sur le salon lié ; les messages et la justification restent réservés au compte administrateur de la messagerie. Les tâches préremplissent l’action proposée et enregistrent le message entrant source. La création refuse un formulaire dont le message ou le salon lié a changé. Le contexte partagé reste celui explicitement saisi par l’administrateur. Aucun message Instagram ni tâche n’est envoyé ou créé automatiquement par le qualificateur.
