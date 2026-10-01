# Kalion Studio — site

Site de **Kalion Studio**, studio de webdesign indépendant basé en France (refonte de k3ntax-webdesign.com). Direction artistique éditoriale : brun très sombre éclairé d'orange et ivoire, une seule couleur d'accent (orange braise). Typographies : Clash Display (logo et lockup « Kalion / Studio » en verre liquide, fichier dans `public/fonts`), Instrument Serif (titres), Hanken Grotesk (texte). Le contenu reprend celui du site actuel.

## Lancer le site

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # version de production dans /dist
npm run preview    # voir la version de production
```

En local, `?fast` à la fin de l'URL (par exemple `http://localhost:5173/?fast`) saute l'animation d'intro. Ça ne fonctionne qu'en développement.

## Mettre en ligne (Netlify)

1. Sur Netlify : *Add new site → Import an existing project → GitHub*, choisir ce dépôt.
2. Rien à régler : `netlify.toml` donne la commande (`npm run build`), le dossier publié (`dist`), la version de Node, les en-têtes de sécurité et le cache.
3. Domaine : **www.kalionstudio.com** (acheté chez IONOS, DNS restés chez IONOS : enregistrement A `@` → `75.2.60.5`, CNAME `www` → `kalionstudio.netlify.app`, pas d'AAAA). Le HTTPS (Let's Encrypt) est fourni et renouvelé par Netlify. L'adresse du site écrite dans les pages (balise canonical, image de partage, `sitemap.xml`, `robots.txt`) est fixée dans `vite.config.js` ; une variable d'environnement `SITE_URL` la remplace si besoin.

Les pages : `/` (le site), `/mentions-legales/`, `/politique-de-confidentialite/`, `/cgv/`, et `404.html` (page introuvable).

## Le parcours au scroll

| Section | Effet |
|---|---|
| Préchargeur | Stylé directement dans `index.html` : dès la première image, le logo Kalion Studio en encre (noir, point braise) sur fond ivoire, avec un petit compteur en gras qui monte de 0 à 100 %. Ses chiffres défilent sur le compositeur du navigateur (animation CSS) : le chargement ne peut pas le bloquer. Quand le site est prêt, il accélère jusqu'à 100 % et l'ouverture part aussitôt : prise d'élan façon dessin animé (le logo recule, le point braise du « i » s'écrase puis rebondit), puis on plonge dans le point : le logo défile en grossissant, le point remplit l'écran de braise, son centre s'ouvre et son anneau file vers les bords ; de là, de petites gouttes jaillissent, une par lettre, et « Kalion Studio » en verre liquide s'écrit lettre après lettre sous elles (liquide d'abord, puis net), traversé d'une onde. Puis le menu entre (le K tourne en place, les liens montent dans leur pilule, « Demander un devis » se dessine) et le bouton « Voir nos projets » trace son contour |
| Hero | Centré, presque seul à l'écran (juste le bouton « Voir nos projets » en bas à droite) : le lockup « Kalion / Studio » (Clash Display, le point du « i » redessiné en rond comme sur le logo) en verre liquide, shader WebGL sur mesure (réfraction, dispersion, reflets), éclairé par plusieurs sources chaudes. Une goutte suit la souris et fusionne avec les lettres. Maintenir le clic la fait gonfler, relâcher l'éclate en gouttelettes avec une onde |
| Hero → À propos | Au premier scroll, le menu et les textes s'effacent ensemble. Une grosse goutte tombe du haut de l'écran sur le mot : impact, onde de choc, éclaboussures, puis elle avale tout le texte, se stabilise et s'ouvre comme une lentille (portail) sur la section suivante. Pas de fondu au noir |
| Lumière | Un éclairage chaud fixe (5 sources orangées et ambrées qui dérivent lentement et suivent le scroll) passe derrière tout le site : les sections sombres ne sont plus noires |
| À propos | Manifeste épinglé révélé à travers la goutte : les mots s'allument un par un, « Kalion Studio » dans la police du logo avec l'orbe. Aucun accent orange tant que le texte est gris : quand la lecture atteint le mot, un coup de pinceau braise se dessine sous « webdesign », « démarquent. » se remplit d'orange de gauche à droite, et « template recyclé » est barré puis s'efface. Ces animations se rembobinent quand on remonte |
| Engagements | Voyage 3D au scroll (src/gl/JourneyScene.js) : on traverse le titre « Ce que vous obtenez. », puis quatre gouttes de verre liquide qui s'ouvrent en anneaux à notre arrivée (100 % sur-mesure, 5–7 jours, 0 € de frais caché, 3 écrans pour « 100 % responsive »). On lit l'engagement, puis la caméra passe à travers l'anneau vers le suivant. L'ambiance change à chaque étape (braise, ambre, rouge profond, or), avec des braises en suspension et un effet de parallaxe à la souris. À la fin, on file dans la lumière et le bandeau suivant monte par-dessus. Navigation cliquable à droite : elle prend la place de l'indicateur « Engagements » pendant le voyage |
| Projets | La section remonte par-dessus la fin du voyage : un bandeau sur deux lignes en sens inverse (types de sites / Projets, Créations, Design…) sort de la lumière. Une encre sombre liquide monte avec un liseré braise et recouvre le bandeau (il passe dessous), puis « Projets réalisés » sort de l'encre en vraies lettres 3D extrudées (src/gl/ProjectsTitle.js : « Projets » ivoire plein, « réalisés » en contour lumineux, décalé en escalier comme le logo). En avançant, la caméra entre au milieu du mot et les lettres s'envolent en désordre dans tous les sens. Ensuite, galerie 3D de 4 sites (K3nTax.com, The 328 Project, By Esperelles, Distrib-Sud) et une carte « Découvrir plus ». Son bouton « Ouvrir » ouvre la page en cercle depuis lui-même et file en haut à droite devenir « Fermer ». À la fermeture, la page est aspirée dans « Fermer », qui redescend redevenir « Ouvrir ». Le panneau contient les 6 autres sites |
| Avis | Scène ray-tracée (src/gl/ReviewsScene.js). Un liquide sombre monte et avale la fin de la galerie ; de petites bulles pétillent, sept bulles (une par avis) remontent et fusionnent en une sphère qui devient du verre et allume un halo braise (arc-en-ciel dans le verre). Les avis sortent ensuite de la sphère sur deux rangées en quinconce : ils glissent vers la gauche, flous tant qu'ils vont vite, nets en se posant (texte calé sur les pixels, sans grain animé : il ne grésille pas). Une fois sortis, ils tournent seuls en sens opposé, à vitesse constante (ni la souris ni le scroll ne les changent) : plusieurs avis lisibles en même temps, rien à faire défiler. La sphère montre les rangées à l'envers, comme une boule de cristal. En partant, tout se rejoue à l'envers : les rangées rentrent dans la sphère, l'anneau s'y replie en s'illuminant, la lumière sous-marine s'éteint, puis les tarifs prennent la sphère : ils la dessinent eux-mêmes avec le même lancer de rayons, la même caméra et les mêmes valeurs, donc le relais ne change aucun pixel (il n'y a jamais deux sphères) |
| Tarifs | Les tarifs prennent le relais de la sphère des avis (src/gl/DropsScene.js, le verre liquide du hero) : la sphère fait un petit bond et, en montant, son verre s'adoucit (il cesse de déformer la lumière) puis la goutte des tarifs, déjà dessous sur son contour exact, transparaît : c'est le même objet qui se transforme ; elle tombe au centre ; en tombant elle se divise, quatre gouttelettes de liquide coloré s'en détachent vers leurs libellés (les quatre choses incluses dans tous les sites) pendant que le fond des tarifs apparaît en fondu. Au scroll, les gouttelettes reviennent une à une remplir la goutte, une couche chacune (vagues à chaque impact, le numéro devient une coche). Pleine, elle s'illumine : « Tout ceci est inclus. » Elle se divise ensuite à chaque question (« Site vitrine / Projet sur-mesure », puis « Achat unique / Abonnement » avec le comparatif ; 28 €/mois affiché directement, boutons alignés), chaque formule gardant les quatre couches au fond. Le sur-mesure reste en petite bulle cliquable. La souris devient une petite goutte qui fusionne avec les grosses. Pour finir, les gouttes se réunissent en une goutte braise qui tombe, en larme, sur la coulure de la FAQ |
| FAQ | Elle monte par-dessus la fin des tarifs ; leur dernière goutte tombe sur le haut de la liste et devient la goutte qui coule le long des questions (elle s'étire avec la vitesse du scroll). Le titre émerge mot à mot. Chaque question s'imbibe d'encre, de gauche à droite, quand la goutte l'atteint. La réponse s'ouvre en cercle depuis le bouton |
| Contact | Scène épinglée : « Parlons » arrive de la gauche, « ensemble. » de la droite, les deux mots se rejoignent en grand au centre ; la goutte de la FAQ se détache du bas de sa coulure et tombe pour devenir le point final. Le titre se range en haut à gauche pendant que la lettre (le formulaire) monte, pliée en trois, le logo Kalion Studio au dos, cachetée d'une goutte braise ; le scroll la déplie volet par volet, puis les moyens de contact arrivent à gauche. Les choix (type, budget) sont marqués par une goutte braise qui glisse d'une option à l'autre ; le bouton « Envoyer » se remplit de liquide à mesure que le formulaire est complété ; les canaux se remplissent de liquide au survol |
| Footer | Le verre liquide se recondense en « Kalion Studio » ; le mot monte avec le footer (il ne passe jamais sur ses textes) et le liquide apparaît en fondu, sans couture avec le contact |

Le fond passe en douceur du sombre à l'ivoire selon la section.

## Deux versions : ordinateur et téléphone

- **Ordinateur** (écrans plus larges que hauts) : la version décrite ci-dessus. Tout est calculé en proportion de l'écran ; elle a été contrôlée de 1024×650 à 3440×1300 (portables 16:9 et 16:10, écrans 4:3 et 5:4, ultra-larges).
- **Téléphone** (écrans en hauteur, fenêtres étroites, tablettes à la verticale ; `src/mobile.css`) : le même parcours recomposé pour un écran vertical. Menu plein écran qui s'ouvre en cercle depuis le bouton, mot liquide plus large (toucher l'écran fait éclater une goutte), anneaux des engagements en haut et texte dessous, galerie en grandes cartes, sphère des avis en haut et avis qui se déroulent dessous, formules des tarifs côte à côte avec leurs détails en colonnes, contact non épinglé (la lettre se déplie au fil du défilement). Un téléphone tenu à l'horizontale affiche « Tournez votre téléphone ».
- **Fluidité sur téléphone** : la hauteur d'écran reste fixe quand la barre du navigateur apparaît ou disparaît (pas de saut), la résolution des scènes 3D s'adapte toute seule à la vitesse de l'appareil, les lumières sont dessinées en petit puis étirées, le grain est fixe, le changement clair/sombre est instantané et seules les valeurs qui changent sont réécrites à chaque image. Safari : flou du mot liquide calculé en JavaScript quand le navigateur ne sait pas flouter un canvas, champs du formulaire en 16 px (pas de zoom automatique).

## Identité visuelle

Les fichiers de la marque (logos, symbole K, planche d'identité) sont rangés hors de ce dépôt, dans le dossier Kalion : `marque/` (à côté de `site-internet/`, `reseaux/` et `marketing/`).

- Logo « Kalion / Studio » en escalier, orbe braise sur le « i » ; symbole K avec son point de lumière ; encre #100C0A, ivoire #ECE6DC, braise #FF5B24 ; Clash Display, Instrument Serif, Hanken Grotesk, DM Mono
- Dans le menu du site : le symbole K seul tant que le grand « Kalion Studio » liquide est à l'écran (hero, footer), puis le logo « Kalion » ailleurs

## Fichiers

- `index.html` : tout le contenu (textes, projets, avis, tarifs, FAQ) et les informations pour Google et les aperçus de liens
- `mentions-legales/`, `politique-de-confidentialite/`, `cgv/`, `404.html` : les pages légales et la page introuvable (`src/legal.js`, `src/legal.css`)
- `src/styles.css` : design system et styles (ordinateur)
- `src/mobile.css` : la version téléphone
- `src/main.js` : scroll fluide (Lenis), animations (GSAP ScrollTrigger), curseur, interactions
- `src/gl/LiquidScene.js` : shader « verre liquide » (champ de metaballs, texte, réfraction, portail)
- `src/gl/JourneyScene.js` : le voyage « Pourquoi nous ? »
- `src/gl/ProjectsTitle.js` + `src/gl/projectsTitleGlyphs.js` : le titre 3D « Projets réalisés » (contours d'Instrument Serif, licence OFL, extraits avec opentype.js)
- `src/gl/ReviewsScene.js` : les avis (bulles, sphère de verre ray-tracée, rangées d'avis)
- `src/gl/DropsScene.js` : les gouttes des tarifs
- `public/img/projects/` : captures des sites clients (1600×1000, webp)
- `public/` : icônes (favicon, iPhone, Android), `site.webmanifest`, `og-image.jpg` (aperçu des liens partagés)
- `vite.config.js` : les pages à construire, l'adresse du site, `robots.txt` et `sitemap.xml`
- `netlify.toml` : build, en-têtes de sécurité (CSP…), cache

## À savoir

- **Formulaire** : il n'y a pas de backend. L'envoi ouvre la messagerie du visiteur avec un mail pré-rempli adressé à contact@kalionstudio.com. Pour recevoir les demandes directement, il faut brancher un service (Formspree, Resend, Supabase…) dans `initContact()` de `src/main.js`.
- **Discord** : le bouton copie le pseudo « k3ntax », comme sur le site actuel.
- **Formulaire branché plus tard** : ajouter l'adresse du service à `connect-src` (et `form-action` s'il envoie un formulaire) dans `netlify.toml`, sinon la politique de sécurité le bloquera.
- **Pages légales** : reprises de l'ancien site et mises à jour (marque Kalion Studio, offre actuelle : 750 € ou 450 € puis 28 €/mois avec 6 mois d'engagement, solde de 300 € pour passer à l'achat unique). À relire avant la mise en ligne : nom commercial, adresse de l'hébergeur, médiateur de la consommation (à nommer).
- **Aucun cookie, aucun traceur** : polices et images servies par le site, pas de mesure d'audience.
