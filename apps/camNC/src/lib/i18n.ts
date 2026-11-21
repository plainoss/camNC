import { useSyncExternalStore } from 'react';

export type Locale = 'en' | 'fr';

const STORAGE_KEY = 'camnc.locale';

const dictionaries = {
  en: {
    'language.label': 'Language',
    'language.english': 'English',
    'language.french': 'Français',
    'nav.projects': 'Projects',
    'nav.getStarted': 'Get started',
    'nav.connection': 'Connection',
    'nav.workArea': 'Work area',
    'nav.cameras': 'Cameras',
    'nav.hideMachine': 'Hide machine',
    'nav.bits': 'Bits',
    'nav.cuttingData': 'Cutting data',
    'nav.about': 'About',
    'nav.backupRestore': 'Backup & restore',
    'nav.advancedSettings': 'Advanced settings',
    'nav.machineSetup': 'Machine setup',
    'nav.tools': 'Tools',
    'nav.app': 'App',
    'nav.collapseIcons': 'Collapse to icons',
    'nav.keepOpen': 'Keep open',
    'start.pickBed': 'Pick your bed',
    'start.getStarted': 'Get started',
    'start.pickBedFirst': 'Pick your bed first.',
    'start.pickBedDescription': 'Then camNC shows your CAM program on it: connect your FluidNC, or choose a bed size.',
    'start.showOnBed': 'Show on this bed',
    'start.rehearsePrompt': 'To rehearse your job,',
    'start.openCamPlan': 'open its CAM plan',
    'start.tryDemoMachine': 'and choose “Try on demo machine”.',
    'start.dropFile': 'Drop a file on your bed',
    'start.fileDescription': 'G-code shows on the bed. A STEP or STL model starts a cutting plan.',
    'start.chooseFile': 'Choose file',
    'start.openingSample': 'Opening sample…',
    'start.useSample': 'Use a sample',
    'start.openWorkspace': 'Open workspace',
    'start.tryDemo': 'Try the demo',
    'start.addCamera': 'Add a camera',
    'start.restoreBackup': 'Restore a backup',
    'start.openFileHint': 'Open a G-code file with O or drop one on the page. With a machine connected, double-click the bed to jog there.',
    'start.showingBed': 'Showing it on a {width} × {height} mm bed. Change the size under Work area in the menu.',
    'error.clerkKey': 'Add your Clerk Publishable Key to the .env file',
  },
  fr: {
    'language.label': 'Langue',
    'language.english': 'English',
    'language.french': 'Français',
    'nav.projects': 'Projets',
    'nav.getStarted': 'Démarrage',
    'nav.connection': 'Connexion',
    'nav.workArea': 'Zone de travail',
    'nav.cameras': 'Caméras',
    'nav.hideMachine': 'Masquer la machine',
    'nav.bits': 'Fraises',
    'nav.cuttingData': 'Données de coupe',
    'nav.about': 'À propos',
    'nav.backupRestore': 'Sauvegarde & restauration',
    'nav.advancedSettings': 'Paramètres avancés',
    'nav.machineSetup': 'Configuration de la machine',
    'nav.tools': 'Outils',
    'nav.app': 'Application',
    'nav.collapseIcons': 'Réduire aux icônes',
    'nav.keepOpen': 'Garder ouvert',
    'start.pickBed': 'Choisissez votre plateau',
    'start.getStarted': 'Démarrage',
    'start.pickBedFirst': 'Choisissez d’abord votre plateau.',
    'start.pickBedDescription': 'Puis camNC affiche votre programme CAM dessus : connectez votre FluidNC ou choisissez une dimension de plateau.',
    'start.showOnBed': 'Afficher sur ce plateau',
    'start.rehearsePrompt': 'Pour simuler votre programme,',
    'start.openCamPlan': 'ouvrez son plan CAM',
    'start.tryDemoMachine': 'puis choisissez « Essayer sur la machine de démonstration ».',
    'start.dropFile': 'Déposez un fichier sur votre plateau',
    'start.fileDescription': 'Le G-code s’affiche sur le plateau. Un modèle STEP ou STL lance la création d’un parcours.',
    'start.chooseFile': 'Choisir un fichier',
    'start.openingSample': 'Ouverture de l’exemple…',
    'start.useSample': 'Utiliser un exemple',
    'start.openWorkspace': 'Ouvrir l’espace de travail',
    'start.tryDemo': 'Essayer la démo',
    'start.addCamera': 'Ajouter une caméra',
    'start.restoreBackup': 'Restaurer une sauvegarde',
    'start.openFileHint': 'Ouvrez un fichier G-code avec O ou déposez-en un sur la page. Avec une machine connectée, double-cliquez sur le plateau pour vous y déplacer.',
    'start.showingBed': 'Affichage sur un plateau de {width} × {height} mm. Modifiez sa taille dans Zone de travail depuis le menu.',
    'error.clerkKey': 'Ajoutez votre clé publique Clerk dans le fichier .env',
  },
} as const;

export type MessageKey = keyof (typeof dictionaries)['en'];

let locale = getInitialLocale();
const listeners = new Set<() => void>();

function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'fr' || saved === 'en') return saved;
  return 'en';
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(nextLocale: Locale): void {
  if (locale === nextLocale) return;
  locale = nextLocale;
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, nextLocale);
    document.documentElement.lang = nextLocale;
  }
  listeners.forEach(listener => listener());
}

export function subscribeToLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: MessageKey, values?: Record<string, string | number>): string {
  const template = (dictionaries[locale][key] ?? dictionaries.en[key]) as string;
  if (!values) return template;
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeToLocale, getLocale, () => 'en');
}

export function useTranslation() {
  useLocale();
  return t;
}

if (typeof document !== 'undefined') document.documentElement.lang = locale;
