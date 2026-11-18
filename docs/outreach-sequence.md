# Séquence démo Instagram → WhatsApp

Relance automatique des conversations Instagram jusqu’à la réservation d’une démo
(lien personnel du commercial, voir « Liens de démo »). Code : `src/lib/outreach/`, worker lancé avec
`prospection-worker` (`scripts/process-prospect-jobs.ts --loop`).

| Étape | Quand | Canal |
|-|-|-|
| 0 | Au lancement | Instagram : lien de démo |
| 1 | Dernier message reçu + 20 h (dans la fenêtre 24 h, 9 h–20 h Paris)* | Instagram : rappel + demande du numéro WhatsApp |
| 2 | Lancement + 2 j | WhatsApp, modèle `template1` (si numéro) |
| 3 | Lancement + 5 j | WhatsApp, modèle `template2` (sinon tâche commerciale) |

S’arrête dès que le contact répond (sauf s’il envoie juste son numéro → passage
WhatsApp), est qualifié FROID, réserve (« Démo réservée »), se désinscrit de
WhatsApp (`whatsappOptOuts`), ou si le salon est signé / pas intéressé. Une
séquence arrêtée n’est jamais relancée.

Seul un numéro donné par le contact dans le DM est utilisé pour WhatsApp (jamais
le téléphone de la fiche salon).

*Valeurs par défaut : délais, heures d’envoi, textes (`{lien_demo}`, `{nom}`), noms et langue des modèles WhatsApp, lien du calendrier et interrupteurs (général, lancement auto) se règlent sur `/automatisations` (stockés en base, désactivé par défaut).

## Liens de démo par commercial

Les messages ne contiennent jamais le lien du calendrier mais un lien suivi
`https://crm.glaura.ai/demo/<linkToken>` (un `linkToken` uuid par séquence). `GET /demo/<token>`
(public) compte le clic (`linkClicks`, `linkClickedAt`) et redirige (302) vers le calendrier, choisi dans l’ordre :
1. `bookingUrl` du commercial assigné au salon lié ;
2. `bookingUrl` de l’utilisateur qui a lancé la séquence (`startedById`) ;
3. lien par défaut : réglage « calendrier » de `/automatisations`, sinon `GLAURA_PRO_SALES_CALENDAR_URL`.

Seuls les utilisateurs actifs comptent. Token inconnu ou invalide → lien par défaut (jamais de 404).
`bookingUrl` (https) se règle par membre sur `/administration`. Base du lien : `CRM_PUBLIC_URL`
(défaut `https://crm.glaura.ai`).

## Configuration

Réglages : page `/automatisations` (table `OutreachSettings`). Le `.env` du VPS ne garde que les secrets et l’arrêt d’urgence :

```
META_SYSTEM_USER_TOKEN=          # system user avec whatsapp_business_messaging
META_APP_SECRET=                 # déjà présent (appsecret_proof)
WHATSAPP_OUTREACH_PHONE_NUMBER_ID=
CRM_PUBLIC_URL=                  # optionnel, défaut https://crm.glaura.ai (base des liens /demo/<token>)
OUTREACH_ENABLED=false           # arrêt d’urgence : coupe la séquence même si activée dans l’UI
```

## Modèles WhatsApp à soumettre (catégorie Marketing, langue fr)

`{{1}}` = nom du salon lié, sinon pseudo Instagram du contact. Bouton URL **dynamique** : `https://crm.glaura.ai/demo/{{1}}` (le CRM passe le `linkToken` de la séquence). Modèles `_v2` à soumettre ; les `v1` (bouton statique) sont remplacés.

**glaura_demo_invite_v2**
> Hello {{1}} 👋 C’est l’équipe Glaura, suite à ton message sur Instagram.
> Une démo de 20 min suffit pour voir comment Glaura remplit ton agenda et répond
> à tes clientes à ta place. Choisis le créneau qui t’arrange 👇
>
> Bouton : « Réserver ma démo » → `https://crm.glaura.ai/demo/{{1}}`
> Pied : « Réponds STOP pour ne plus recevoir de messages »

**glaura_demo_last_call_v2**
> {{1}}, dernier petit message de notre part 🙂 Si tu veux voir Glaura en action,
> les créneaux de démo sont ici. Sinon pas de souci, on ne te relancera plus.
>
> Bouton : « Réserver ma démo » → `https://crm.glaura.ai/demo/{{1}}`
> Pied : « Réponds STOP pour ne plus recevoir de messages »

## Limites connues

- Les réponses WhatsApp texte arrivent sur le webhook Firebase du numéro et ne sont
  pas encore visibles dans le CRM (seul STOP est pris en compte). À brancher.
- Pas de détection automatique de réservation (Google Agenda, prise de rendez-vous) :
  bouton « Démo réservée » dans la messagerie. Possible ensuite via l’API Google Calendar.
