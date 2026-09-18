# Mettre Study Planner en ligne

## 1) Supabase

Oui : exécuter `supabase.sql` dans Supabase est nécessaire pour créer/mettre à jour la base.

Dans Supabase :
SQL Editor -> New query -> copier TOUT le contenu de `supabase.sql` -> Run.

Si Supabase affiche un avertissement RLS, choisir `Run and enable RLS`.

Ne pas exécuter les anciens SQL/patchs des versions précédentes.

## 2) Tester localement

Ouvrir `index.html` dans le dossier. Si le login puis le calendrier fonctionnent, le projet est prêt à être publié.

## 3) Mise en ligne avec GitHub Pages

- Créer/connecter un compte GitHub.
- Créer un dépôt public, par exemple `study-planner`.
- Envoyer les fichiers du dossier dans le dépôt :
  `index.html`, `app.js`, `style.css`, `supabase.sql` et README.
- Dans GitHub : Settings -> Pages.
- Source : Deploy from a branch.
- Branch : `main`, dossier : `/ (root)`.
- Save.
- Après le déploiement, GitHub fournit une adresse du type :
  `https://VOTRE-NOM.github.io/study-planner/`

Important : GitHub Pages héberge les fichiers HTML/CSS/JS. Supabase continue de stocker les données, le login admin, les séances, le chrono et la progression.

## 4) Utilisation depuis téléphone

Ouvrir le lien GitHub Pages sur téléphone/ordinateur. Tous les utilisateurs voient la même base Supabase.

Admin :
- login avec les identifiants administrateur enregistrés dans Supabase.

Lecture seule :
- utiliser le bouton de lecture seule.

## 5) À ne pas faire

- Ne pas mettre la clé `service_role` dans le site.
- Ne pas exécuter les anciens fichiers SQL.
- Ne pas supprimer les tables Supabase après déploiement.

## 6) Mise à jour du site

Pour une future mise à jour :
- remplacer les fichiers HTML/CSS/JS dans GitHub ;
- recharger le site.

Ne relancer le SQL que si la nouvelle version contient réellement une modification de la base.


## v51
- Chronomètre visible et contrôlable directement depuis l'interface.
- Un même cours peut être planifié plusieurs fois (doublon, triple, etc.), y compris le même jour.
- La base Supabase est conservée; ne réexécutez pas le SQL sauf pour une installation complète.

## v54 timer recovery
If an old browser timer is visible while the shared timer state is idle, the app can recover it from the browser backup and finish it through `admin_timer_end_safe`. The UI no longer displays stale accumulated seconds while the timer is idle.
If a stale timer state remains in Supabase from an earlier failed attempt, it is safe to reset only the singleton timer row with:
```sql
update public.study_timer_state
set status='idle', session_id=null, course_id=null, started_at=null, accumulated_seconds=0, updated_at=now()
where id=1;
```
This does not delete `study_time_logs`.
