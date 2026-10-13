/**
 * Les fioles : des consommables qu'on garde sur la caisse, à côté des pièces (deux au plus),
 * et qu'on boit ou qu'on verse pendant une manche, au moment choisi.
 */

export type VialId = 'sang' | 'laudanum' | 'encre';

export interface VialDef {
  id: VialId;
  name: string;
  price: number;
  description: string;
  /** Couleur du liquide. */
  color: number;
}

export const VIALS: Record<VialId, VialDef> = {
  sang: { id: 'sang', name: 'Fiole de sang', price: 3, description: '+2 relances pour l’échéance.', color: 0x8a0a0a },
  laudanum: { id: 'laudanum', name: 'Laudanum', price: 4, description: 'La prochaine main jouée compte ×2 mult.', color: 0xc08a20 },
  encre: { id: 'encre', name: 'Encre de seiche', price: 3, description: 'Retourne un dé posé sur sa face opposée.', color: 0x101828 },
};

export const MAX_VIALS = 2;
export const VIAL_IDS = Object.keys(VIALS) as VialId[];
