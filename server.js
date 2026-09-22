// Compatibilité : le point d'entrée réel est `server/index.js`, lancé par
// `npm start`. Ce fichier existe parce que « node server.js » est la commande
// de démarrage par défaut de beaucoup d'hébergeurs (et celle configurée sur
// l'ancien service Render). Il ne contient aucune logique.
import './server/index.js';
