// Faint drifting dust, used on pages without a particle piece of their own.
import { Dust, Scene, hexToRgb, type Env } from '../scene';

const N = 2400;
const COLORS = ['#ff4d2e', '#ffb020', '#3ddc97', '#3fa7ff', '#b57bff', '#ededed'];

export class AmbientScene extends Scene {
  readonly count = N;
  private dust = new Dust(0, N, (i) => (i % 7 === 0 ? i % 5 : 5));

  constructor() {
    super();
    this.alloc(N);
    this.rgb = COLORS.map(hexToRgb);
    this.glow = COLORS.map(() => 0);
    this.trail = 0.5;
  }

  update(env: Env) {
    this.dust.update(this, env);
  }
}
