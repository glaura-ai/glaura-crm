# Séquence démo Instagram → WhatsApp

Relance automatique des conversations Instagram jusqu’à la réservation d’une démo
(`GLAURA_PRO_SALES_CALENDAR_URL`). Code : `src/lib/outreach/`, worker lancé avec
`prospection-worker` (`scripts/process-prospect-jobs.ts --loop`).

| Étape | Quand | Canal |
|-|-|-|
| 0 | Au lancement | Instagram : lien de démo |
| 1 | Dernier message reçu + 20 h (dans la fenêtre 24 h, 9 h–20 h Paris) | Instagram : rappel + demande du numéro WhatsApp |
| 2 | Lancement + 2 j | WhatsApp, modèle `OUTREACH_WA_TEMPLATE_1` (si numéro) |
| 3 | Lancement + 5 j | WhatsApp, modèle `OUTREACH_WA_TEMPLATE_2` (sinon tâche commerciale) |

S’arrête dès que le contact répond (sauf s’il envoie juste son numéro → passage
WhatsApp), est qualifié FROID, réserve (« Démo réservée »), se désinscrit de
WhatsApp (`whatsappOptOuts`), ou si le salon est signé / pas intéressé. Une
séquence arrêtée n’est jamais relancée.

Seul un numéro donné par le contact dans le DM est utilisé pour WhatsApp (jamais
le téléphone de la fiche salon).

## Configuration (`.env` du VPS)

```
OUTREACH_ENABLED=true            # interrupteur général
OUTREACH_AUTO_START=false        # true : lancement auto pour CHAUD/TIÈDE
META_SYSTEM_USER_TOKEN=          # system user avec whatsapp_business_messaging
META_APP_SECRET=                 # déjà présent (appsecret_proof)
WHATSAPP_OUTREACH_PHONE_NUMBER_ID=
OUTREACH_WA_TEMPLATE_1=glaura_demo_invite
OUTREACH_WA_TEMPLATE_2=glaura_demo_last_call
OUTREACH_WA_TEMPLATE_LANG=fr
```

## Modèles WhatsApp à soumettre (catégorie Marketing, langue fr)

`{{1}}` = nom du salon lié, sinon pseudo Instagram du contact. Bouton URL statique vers le lien du calendrier.

**glaura_demo_invite**
> Hello {{1}} 👋 C’est l’équipe Glaura, suite à ton message sur Instagram.
> Une démo de 20 min suffit pour voir comment Glaura remplit ton agenda et répond
> à tes clientes à ta place. Choisis le créneau qui t’arrange 👇
>
> Bouton : « Réserver ma démo » → lien calendrier
> Pied : « Réponds STOP pour ne plus recevoir de messages »

**glaura_demo_last_call**
> {{1}}, dernier petit message de notre part 🙂 Si tu veux voir Glaura en action,
> les créneaux de démo sont ici. Sinon pas de souci, on ne te relancera plus.
>
> Bouton : « Réserver ma démo » → lien calendrier
> Pied : « Réponds STOP pour ne plus recevoir de messages »

## Limites connues

- Les réponses WhatsApp texte arrivent sur le webhook Firebase du numéro et ne sont
  pas encore visibles dans le CRM (seul STOP est pris en compte). À brancher.
- Pas de détection automatique de réservation (Google Agenda, prise de rendez-vous) :
  bouton « Démo réservée » dans la messagerie. Possible ensuite via l’API Google Calendar.
