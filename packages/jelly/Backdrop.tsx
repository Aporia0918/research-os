// The moving field behind the jelly: three large soft colour blobs (c2, lilac, accent) drifting slowly and a white light
// band. Jelly is clear, so without colour moving behind it there is nothing to see through.
export function Backdrop() {
  return <div className="jl-bg" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="band" /></div>;
}
