# TEC — bus, trams et métro de Wallonie

Cette intégration affiche dans Gladys les **prochains départs** des bus, du
tram de Liège et du métro de Charleroi du réseau TEC, avec les **retards**, les
**suppressions** et les **perturbations** (travaux, déviations, grèves) en temps
réel.

## Ce que vous obtenez

Un appareil par arrêt surveillé, avec :

| Fonctionnalité            | Exemple                                             |
| ------------------------- | --------------------------------------------------- |
| Prochain départ           | `8` minutes                                         |
| Prochain passage          | `M2 → ANDERLUES Monument · 08:03 (+3 min)`          |
| Retard du prochain départ | `3` minutes                                         |
| Départ suivant            | `22` minutes                                        |
| Prochains départs         | `M2 8 min (+3 min) · 52 08:05 supprimé · M4 25 min` |
| Perturbations             | `1` (nombre d'alertes en cours sur les lignes)      |

La nuit, « Prochain départ » donne le temps jusqu'au premier départ du
matin.

## Configuration

1. **Clé d'API (facultative mais conseillée).** Les retards viennent du portail
   open data [Belgian Mobility](https://data.belgianmobility.io). Sans clé, il
   n'accepte que 100 requêtes par jour : le temps réel est alors rafraîchi
   toutes les 20 minutes. Avec une clé gratuite, il l'est chaque minute :
   - créez un compte sur le
     [portail développeur](https://api-management-opendata-production.developer.azure-api.net/signup) ;
   - abonnez-vous au produit gratuit (Standard) ;
   - copiez la **clé primaire** de votre abonnement dans le champ « Clé d'API ».
2. **Trouvez vos arrêts.** Chaque arrêt a **un code par sens de
   circulation** (ex. `CMpa1` et `CMpa2` pour les deux quais de la station
   Palais du métro). Deux boutons vous aident :
   - **Rechercher un arrêt** : tapez une partie du nom (« charleroi gare »),
     la liste des codes s'affiche avec les lignes qui y passent ;
   - **Arrêts près de chez moi** : les arrêts les plus proches de vos maisons
     Gladys (la position de la maison doit être renseignée).
     Le premier chargement des horaires prend une à deux minutes.
3. **Arrêts** : listez les codes séparés par des virgules. Pour ne garder que
   certaines lignes d'un arrêt, ajoutez-les après deux-points, séparées par
   `+` : `CMpa1:M2+M4, Ctrrpla2:82`. Vingt arrêts au maximum.
4. Enregistrez, puis ajoutez les appareils depuis l'onglet **Découverte**.

Autres réglages :

- **Langue des textes** : langue des noms d'appareils et des textes écrits
  dans les états (prochain passage, liste des départs).
- **Rafraîchissement temps réel** : avec une clé, la fréquence de lecture du
  flux temps réel (60 s par défaut).
- **Départs affichés** : jusqu'où regardent les listes (90 minutes par défaut).
- **Alerte de retard à partir de** : le retard qui déclenche « Départ TEC en
  retard » (5 minutes par défaut).

## Actions

- **Rechercher un arrêt** et **Arrêts près de chez moi** — voir ci-dessus.
- **Tester la connexion** — lit le flux temps réel en direct et affiche la
  version des horaires, le nombre de courses suivies et de requêtes utilisées.
- **Mettre à jour les horaires** — le TEC publie de nouveaux horaires chaque
  nuit ; l'intégration vérifie elle-même toutes les 6 heures.

## Scènes

Déclencheurs (catégorie **Intégrations** de l'éditeur de scènes) :

- **Départ TEC imminent** — un départ a lieu dans N minutes. Choisissez
  l'arrêt, la ligne et une ou plusieurs valeurs de N (1 à 30 minutes). Idéal
  pour « Le bus part dans 5 minutes, il est temps d'y aller ! ».
- **Départ TEC en retard** — un départ dans l'heure a au moins le retard
  configuré.
- **Départ TEC supprimé** — un départ dans l'heure est supprimé ou ne
  dessert plus l'arrêt.
- **Nouvelle perturbation TEC** — une nouvelle alerte concerne une ligne
  d'un arrêt surveillé.

Les actions suivantes lisent les détails, par exemple
`{{triggerEvent.data.line}}`, `{{triggerEvent.data.destination}}`,
`{{triggerEvent.data.expected_time}}`, `{{triggerEvent.data.delay_minutes}}`
ou `{{triggerEvent.data.title}}`.

Actions :

- **Obtenir le prochain départ TEC** — ligne, destination, minutes, heure
  estimée, retard et un résumé des prochains départs, à utiliser dans un
  message (« Le prochain métro part dans … minutes »).
- **Vérifier une ligne TEC** — indique si une ligne est perturbée, avec le
  nombre d'alertes et leur résumé : utilisez-le dans une condition avant de
  prévenir.

## Widgets

- **Départs TEC** — le tableau des départs d'un arrêt : prochain départ,
  retard et perturbations en direct, liste des prochains passages colorée
  selon le retard, source des données et bouton « Actualiser ».
- **Perturbations TEC** — les alertes en cours sur les lignes de vos arrêts
  (ou d'un arrêt, ou d'une ligne), avec le lien vers le détail sur letec.be.

## Données et vie privée

- Horaires : open data du TEC (CC0), téléchargés depuis
  `opendata.tec-wl.be` (environ 80 Mo) et indexés localement dans `/data`.
- Temps réel : portail open data Belgian Mobility (CC BY 4.0) —
  « Source : LETEC – Open Data ».
- La position de vos maisons n'est lue que par le bouton « Arrêts près de
  chez moi », et ne quitte pas votre Gladys.

## Dépannage

- **« Ignorés (arrêt inconnu…) »** : le code n'existe pas dans les horaires ;
  utilisez la recherche d'arrêt (attention aux majuscules : `CMpa1`).
- **Badge cloud orange** : pas de clé d'API (temps réel toutes les 20 min) ou
  temps réel momentanément indisponible ; les horaires théoriques restent
  affichés.
- **Le portail a refusé la clé** : vérifiez que l'abonnement est actif et que
  vous avez copié la clé primaire.
