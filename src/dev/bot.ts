/**
 * Bot de test (mode dev uniquement) : joue des runs complètes à travers les vraies entrées
 * (gobelet à la souris, touches, boutons HTML) pour vérifier la boucle et juger l'équilibrage.
 * Stratégie volontairement naïve : garder la valeur la plus fréquente, acheter ce qui passe.
 *
 * Console : `bot.run()` → { end, pacts, … } ; `bot.many(10)` → résumé de 10 runs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sim = (seconds: number) => void;

export function createBot(game: any, simulate: Sim, renderOnce: () => void) {
  const canvas = () => document.querySelector('#app canvas') as HTMLCanvasElement;
  const fire = (type: string, x: number, y: number) =>
    canvas().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
  const key = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));

  /** Saisit le gobelet, le secoue une seconde, le lâche, attend la révélation. */
  function roll() {
    const table = game.table;
    const cam = table.stage.camera;
    renderOnce();
    cam.updateMatrixWorld();
    table.stage.scene.updateMatrixWorld(true);
    const p = table.cup.position.clone();
    p.y += 1.7;
    p.project(cam);
    const sx = ((p.x + 1) / 2) * innerWidth;
    const sy = ((1 - p.y) / 2) * innerHeight;
    fire('pointermove', sx, sy);
    fire('pointerdown', sx, sy);
    for (let t = 0; t < 1; t += 1 / 60) {
      fire('pointermove', innerWidth * 0.6 + Math.sin(t * 18) * 60, innerHeight * 0.45 + Math.cos(t * 14) * 50);
      simulate(1 / 60);
    }
    for (let i = 0; i < 6; i++) {
      fire('pointermove', innerWidth * 0.6 - i * 15, innerHeight * 0.45 - i * 10);
      simulate(1 / 60);
    }
    fire('pointerup', 0, 0);
    for (let t = 0; t < 10 && !game.revealed; t += 0.1) simulate(0.1);
  }

  /** Une main : un lancer, jusqu'à deux relances en gardant la valeur la plus fréquente. */
  function hand() {
    roll();
    for (let r = 0; r < 2 && game.canRoll(); r++) {
      const faces = game.faces();
      const counts: Record<number, number> = {};
      for (const f of faces) counts[f.value] = (counts[f.value] ?? 0) + 1;
      const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1] || +b[0] - +a[0])[0];
      if (n >= 5) break;
      for (const f of faces) {
        const die = game.table.dice[f.die];
        if ((f.value === +best) !== die.kept) game.table.toggleKeepIndex(f.die);
        simulate(0.4);
      }
      if (!game.table.hasLooseDice()) break;
      roll();
    }
    key('Space');
    for (let t = 0; t < 25 && (game.phase === 'scoring' || game.validateAt !== null); t += 0.1) simulate(0.1);
  }

  /** Achète tout ce qui est abordable (en visant le premier dé et la première face), puis repart. */
  function shop() {
    // Attend que le marchand ait ouvert la valise.
    for (let t = 0; t < 4 && !game.suitcase.isOpen; t += 0.1) simulate(0.1);
    game.run.shop.forEach((_: unknown, i: number) => {
      if (game.run.canBuy(i)) game.complete(i, 0, 0);
    });
    simulate(0.8);
    game.suitcase.close(() => game.leaveShop());
    for (let t = 0; t < 4 && game.phase === 'shop'; t += 0.1) simulate(0.1);
  }

  function run(maxMs = 15000) {
    game.newRun();
    simulate(1);
    const pacts: string[] = [];
    const t0 = performance.now();
    for (let guard = 0; game.phase !== 'over' && guard < 300 && performance.now() - t0 < maxMs; guard++) {
      if (game.phase === 'play') hand();
      else if (game.phase === 'payout') simulate(2);
      else if (game.phase === 'shop') shop();
      else if (game.phase === 'pact') {
        // Attend que le contrat soit posé, puis signe la première silhouette.
        for (let t = 0; t < 5 && !game.pact.awaitingSignature; t += 0.1) simulate(0.1);
        const paper = game.pact.paper;
        if (paper) {
          pacts.push(paper.options[0]);
          game.pact.waiting = null;
          game.sign(paper.options[0]);
          simulate(4.5);
        }
      } else simulate(0.5);
    }
    simulate(2.5);
    const r = game.run;
    return {
      end: `N${r.night}E${r.echeance + 1}`,
      won: r.isFinal && r.score >= r.target,
      pacts: pacts.join(','),
      dice: r.dice.map((d: any) => d.type).join(','),
      relics: r.relics.map((x: any) => x.def.id).join(','),
    };
  }

  function many(n = 10, maxMs = 6000) {
    const ends: string[] = [];
    for (let i = 0; i < n; i++) ends.push(run(maxMs).end);
    const nights = ends.map((e) => Number(e[1]));
    return { ends, medianNight: nights.sort((a, b) => a - b)[Math.floor(n / 2)] };
  }

  return { roll, hand, shop, run, many };
}
