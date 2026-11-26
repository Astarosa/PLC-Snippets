# Marche / arrêt avec auto-maintien

- `BP_Arret` est câblé **NF** : la variable vaut TRUE quand le bouton n'est pas appuyé,
  d'où un contact **NO** dans le programme (sécurité positive : un fil coupé arrête le moteur).
- `Defaut` regroupe les défauts (relais thermique, arrêt d'urgence via relais de sécurité…).