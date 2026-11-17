/** Small water drops resting on a jelly card, as in the owner's reference picture. Purely decorative. */
const DROPS = [['8%', '-6px', 9], ['84%', '12%', 6], ['92%', '78%', 11], ['18%', '96%', 5]] as const;

export function Drops({ n }: { n: number }) {
  return <>{DROPS.slice(0, n).map(([left, top, size], i) => <i key={i} className="water" aria-hidden="true" style={{ left, top, width: size, height: size }} />)}</>;
}
