import type { BodyPartId } from './body';

export type BossId = 'aveugle' | 'comptable' | 'mere' | 'boucher' | 'horloger' | 'jumeau' | 'pretre' | 'sangsue' | 'creancier';

export interface Boss {
  id: BossId;
  name: string;
  /** Objet que le créancier pose sur la table pour annoncer le boss. */
  object: string;
  rule: string;
  /** Partie imposée par le pacte en cas d'échec ; `null` = au choix ; `'mort'` = aucun pacte. */
  pact: BodyPartId | null | 'mort';
}

export const BOSSES: Record<BossId, Boss> = {
  aveugle: { id: 'aveugle', name: "L'Aveugle", object: 'un bandeau', rule: 'Les dés retombent face cachée ; les valeurs ne se révèlent qu’au scoring.', pact: 'oeil' },
  comptable: { id: 'comptable', name: 'Le Comptable', object: 'un boulier', rule: 'Seules les paires et doubles paires rapportent.', pact: 'dent' },
  mere: { id: 'mere', name: 'La Mère', object: 'une alliance', rule: 'Chaque relance coûte 1 pièce.', pact: null },
  boucher: { id: 'boucher', name: 'Le Boucher', object: 'un hachoir planté', rule: 'Un dé est confisqué pour toute l’échéance.', pact: 'doigt' },
  horloger: { id: 'horloger', name: "L'Horloger", object: 'une montre à gousset', rule: '8 secondes pour décider après chaque lancer, sinon la main est jouée.', pact: null },
  jumeau: { id: 'jumeau', name: 'Le Jumeau', object: 'un miroir', rule: 'Une combinaison déjà jouée dans l’échéance ne rapporte que la moitié.', pact: 'oreille' },
  pretre: { id: 'pretre', name: 'Le Prêtre', object: 'un crucifix inversé', rule: 'À chaque main, une relique de plus s’éteint, de gauche à droite.', pact: 'langue' },
  sangsue: { id: 'sangsue', name: 'La Sangsue', object: 'un bocal de sangsues', rule: 'Les faces dorées coûtent 3 pièces au lieu d’en rapporter.', pact: null },
  creancier: {
    id: 'creancier',
    name: 'Le Créancier',
    object: 'sa propre main, paume ouverte',
    rule: 'Toutes les deux mains, il retourne ton meilleur dé sur sa pire face. Aucun pacte possible.',
    pact: 'mort',
  },
};

/** Boss tirés au hasard pour les nuits 1 à 6 ; la nuit 7 est toujours le créancier. */
export const BOSS_POOL: BossId[] = ['aveugle', 'comptable', 'mere', 'boucher', 'horloger', 'jumeau', 'pretre', 'sangsue'];

export const CLOCKMAKER_SECONDS = 8;
