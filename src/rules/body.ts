// Le corps est la seule jauge : chaque pacte en retire un morceau, pour toute la run.

export type BodyPartId = 'doigt' | 'dent' | 'oreille' | 'langue' | 'oeil' | 'main' | 'coeur';

export interface BodyPart {
  id: BodyPartId;
  name: string;
  /** Effet en jeu, tel qu'il est montré sur le contrat. */
  effect: string;
  tool: string;
}

export const BODY_PARTS: Record<BodyPartId, BodyPart> = {
  doigt: { id: 'doigt', name: 'Un doigt', effect: '−1 relance par échéance', tool: 'sécateur' },
  dent: { id: 'dent', name: 'Une dent', effect: '+8 pièces, un Dé dent en boutique', tool: 'pince' },
  oreille: { id: 'oreille', name: 'Une oreille', effect: 'Son étouffé, d’un seul côté', tool: 'rasoir' },
  langue: { id: 'langue', name: 'La langue', effect: 'Boutique 30 % plus chère', tool: 'ciseaux' },
  oeil: { id: 'oeil', name: 'Un œil', effect: 'Moitié de la vue perdue', tool: 'cuillère' },
  main: { id: 'main', name: 'La main gauche', effect: '−1 dé', tool: 'hachoir' },
  coeur: { id: 'coeur', name: 'Le cœur', effect: 'Paie tout, mais la run finit avec la nuit', tool: 'ses mains' },
};

export const MAX_FINGERS = 8;
export const MAX_TEETH = 6;

/** Ce qu'il reste du joueur. */
export class Body {
  fingers = 0;
  teeth = 0;
  ear = false;
  tongue = false;
  eyes = 0;
  hand = false;
  heart = false;
  /** Pactes signés (tous types confondus). */
  pacts = 0;
  /** Doigts déjà perdus quand la main gauche a été prise : ils étaient sur elle. */
  fingersAtHand = 0;

  /** Les doigts partent d'abord de la main gauche, de l'auriculaire vers l'index. */
  get leftFingersLost() {
    return this.hand ? 4 : Math.min(this.fingers, 4);
  }

  get rightFingersLost() {
    return this.hand ? this.fingers - Math.min(this.fingersAtHand, 4) : Math.max(0, this.fingers - 4);
  }

  /** Nombre total de morceaux perdus. */
  get lost() {
    return this.fingers + this.teeth + (this.ear ? 1 : 0) + (this.tongue ? 1 : 0) + this.eyes + (this.hand ? 1 : 0);
  }

  get blind() {
    return this.eyes >= 2;
  }

  /** Ce qui peut encore être pris. Le cœur n'est proposé qu'en tout dernier recours. */
  available(): BodyPartId[] {
    const list: BodyPartId[] = [];
    if (this.fingers < MAX_FINGERS && this.rightFingersLost < 4) list.push('doigt');
    if (this.teeth < MAX_TEETH) list.push('dent');
    if (!this.ear) list.push('oreille');
    if (!this.tongue) list.push('langue');
    if (this.eyes < 2) list.push('oeil');
    if (!this.hand) list.push('main');
    if (list.length === 0 && !this.heart) list.push('coeur');
    return list;
  }

  take(part: BodyPartId) {
    this.pacts++;
    switch (part) {
      case 'doigt':
        this.fingers++;
        break;
      case 'dent':
        this.teeth++;
        break;
      case 'oreille':
        this.ear = true;
        break;
      case 'langue':
        this.tongue = true;
        break;
      case 'oeil':
        this.eyes++;
        break;
      case 'main':
        this.fingersAtHand = this.fingers;
        this.hand = true;
        break;
      case 'coeur':
        this.heart = true;
        break;
    }
  }
}
