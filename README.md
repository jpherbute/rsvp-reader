# Éclair — lecteur RSVP (PWA)

Lisez vos ebooks **mot par mot**, au même endroit de l'écran, avec la lettre de reconnaissance en rouge
alignée sur un axe fixe (technique RSVP).

## Utilisation

- **Maintenez l'écran** (ou la **barre d'espace**) : le texte défile. **Relâchez** : pause.
- Pendant la lecture, rien d'autre que le mot n'est affiché. En pause : progression globale (en haut,
  déplaçable), titre/chapitre, contexte, vitesse, navigation.
- Pas à pas : boutons ‹ › (appui long = répétition), `«` `»` = phrase précédente/suivante.
  Clavier : `←` `→` (±1 mot, `Maj` = ±10), `↑` `↓` (vitesse), `Échap` (bibliothèque).
- Vitesse : 100 à 1000 mots/min. Le rythme s'adapte : mots longs, virgules, fins de phrase et de paragraphe,
  et une courte accélération progressive à chaque reprise.
- Thème clair (par défaut) / sombre, taille du texte (`Aa`).
- Import **EPUB** (sans DRM) et **TXT**, par bouton ou glisser-déposer. Bibliothèque et position de lecture
  conservées localement (IndexedDB) ; fonctionne hors ligne une fois installée.

## Lancer en local

Aucune étape de build :

```sh
python3 -m http.server 8000   # puis http://localhost:8000
```

Un service worker et l'installation PWA exigent HTTPS ou `localhost`.

## Déployer (GitHub Pages)

Réglages du dépôt → Pages → *Deploy from a branch* → `main` / racine. Tous les chemins sont relatifs,
l'application fonctionne donc sous `https://<utilisateur>.github.io/rsvp-reader/`.

## Structure

```
index.html            bibliothèque + lecteur
css/app.css           thèmes clair/sombre, mise en page
js/app.js             import EPUB/TXT, moteur RSVP, bibliothèque
sw.js                 cache hors ligne
manifest.webmanifest  installation PWA
vendor/jszip.min.js   lecture des EPUB (JSZip, MIT)
```

## Idées suivantes

Liste de chapitres, import PDF, statistiques de lecture, synchronisation entre appareils.
