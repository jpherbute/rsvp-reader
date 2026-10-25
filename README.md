# Éclair — lecteur RSVP (PWA)

Lisez vos ebooks **mot par mot**, au même endroit de l'écran, avec la lettre de reconnaissance en rouge
alignée sur un axe fixe (technique RSVP).

## Utilisation

- **Maintenez l'écran** (ou la **barre d'espace**) : le texte défile. **Relâchez** : pause.
  Dans les réglages, le mode **Toucher** permet de lancer d'un toucher et d'arrêter d'un autre.
- Après une pause de plus d'une seconde et demie, la lecture reprend jusqu'à 4 mots plus tôt, sans remonter
  avant le début de la phrase (désactivable dans les réglages).
- Pendant la lecture, rien d'autre que le mot n'est affiché. En pause : progression globale (en haut,
  déplaçable), titre/chapitre, contexte, vitesse, navigation.
- Pas à pas : boutons ‹ › (appui long = répétition), `«` `»` = phrase précédente/suivante ; toucher un mot du
  contexte s'y place. Clavier : `←` `→` (±1 mot, `Maj` = ±10), `↑` `↓` (vitesse), `Page↑` `Page↓` (chapitre),
  `Échap` (pause, puis bibliothèque).
- Chapitres : bouton liste en haut du lecteur (en pause) pour sauter à un chapitre, boutons ⏮ ⏭ sous la barre du
  haut avec le temps restant dans le chapitre. Ils viennent de la table des matières de l'EPUB (EPUB 3 ou 2) ; pour un TXT,
  les lignes du type « CHAPITRE IV. », « Livre premier »…
- Vitesse : 100 à 1000 mots/min. Le rythme s'adapte : mots longs, virgules, fins de phrase et de paragraphe,
  et une courte accélération progressive à chaque reprise.
- Thème clair (par défaut) / sombre ; mode de lecture, reprise et taille du texte dans les réglages.
- Import **EPUB** (sans DRM) et **TXT**, par bouton ou glisser-déposer. Bibliothèque et position de lecture
  conservées localement (IndexedDB) ; fonctionne hors ligne une fois installée.
- Bibliothèque avec la couverture de chaque EPUB (vignette) ; à défaut, l'initiale du titre. À partir de 4 livres :
  recherche dans les titres et les auteurs (sans tenir compte des accents) et tri (récents, titre, auteur,
  progression).
- **Sauvegarde** (en bas de la bibliothèque) : *Sauvegarder* télécharge un `.zip` avec les livres, leurs
  couvertures et les positions de lecture ; *Restaurer* (ou *Importer* ce fichier) ajoute les livres absents et,
  pour un livre déjà présent, garde la lecture la plus récente. Utile avant une réinstallation ou pour passer
  sur un autre appareil.
- **Statistiques** (bouton graphique de la bibliothèque) : mots lus et temps de lecture du jour, série de jours
  consécutifs, vitesse réelle moyenne, graphique des 7 derniers jours. Elles font partie de la sauvegarde.
- **Mises à jour** : quand une nouvelle version est publiée, l'app la télécharge en entier en arrière-plan puis
  affiche « Nouvelle version disponible — Recharger ».
- **Partage vers l'app** (Android, application installée) : « Partager → Éclair » depuis un gestionnaire de
  fichiers ou un téléchargement importe le livre. Non disponible sur iPhone/iPad, où Safari ne permet pas aux
  applications web de recevoir un partage.

## Lancer en local

Aucune étape de build :

```sh
python3 -m http.server 8000   # puis http://localhost:8000
```

Un service worker et l'installation PWA exigent HTTPS ou `localhost`.

## Tests

Tests de bout en bout avec Playwright (Chromium), lancés automatiquement sur GitHub à chaque PR et à chaque mise
à jour de `main` (`.github/workflows/tests.yml`). En local :

```sh
npm ci
npx playwright install chromium   # la première fois
npm test
```

Les livres d'essai sont générés au lancement des tests (`tests/fixtures.js`) : aucun accès réseau nécessaire.

## Déployer (GitHub Pages)

Réglages du dépôt → Pages → *Deploy from a branch* → `main` / racine. Tous les chemins sont relatifs,
l'application fonctionne donc sous `https://<utilisateur>.github.io/rsvp-reader/`.

## Structure

```
index.html            bibliothèque + lecteur
css/app.css           thèmes clair/sombre, mise en page
js/app.js             import EPUB/TXT, moteur RSVP, bibliothèque
sw.js                 hors ligne, mises à jour d'un bloc, réception des partages
manifest.webmanifest  installation PWA
vendor/jszip.min.js   lecture des EPUB (JSZip, MIT)
tests/                tests Playwright (package.json ne sert qu'à eux)
```

## Idées suivantes

Import PDF, synchronisation automatique entre appareils.
